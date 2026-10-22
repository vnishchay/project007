-- Trusted Picks: NFC table tags (NXP NTAG 424 DNA with Secure Unique NFC, "SUN").
-- A tag sits next to a table QR. Every tap makes the phone open a fresh link to the same /q/<token> page
-- with two extra values: picc (the tag's id and tap counter, encrypted) and cmac (a signature). The tag's
-- secret key never leaves the tag or this database, so a link can't be made up, and because the counter
-- must go up, a copied or photographed link works only once. A verified tap counts as "at the shop",
-- like a scan with the phone's location nearby, without asking for or keeping any location.
-- The checks follow NXP AN12196 (AES-128: PICC data decrypted with the meta read key, SDMMAC from a
-- session key derived with CMAC). One key per tag serves as both the meta read and file read key.

create table if not exists public.nfc_tags (
  qr_code_id   uuid primary key references public.qr_codes (id) on delete cascade,
  key          bytea not null default extensions.gen_random_bytes(16) check (length(key) = 16),
  uid          bytea check (uid is null or length(uid) = 7),      -- learned from the first good tap
  last_counter integer not null default -1,
  last_user    uuid references public.profiles (id) on delete set null,
  last_tap_at  timestamptz,
  created_at   timestamptz not null default now()
);
-- No policies: nobody reads keys directly. Owners get their tag's key through nfc_tag_setup().
alter table public.nfc_tags enable row level security;
revoke all on public.nfc_tags from anon, authenticated;

alter table public.visits add column if not exists tapped boolean not null default false;

-- AES-128 on one 16-byte block.
create or replace function public._aes_block(p_key bytea, p_block bytea)
returns bytea language sql immutable strict set search_path = public, extensions as $$
  select extensions.encrypt(p_block, p_key, 'aes-ecb/pad:none');
$$;

-- One bit to the left across a 16-byte block, for the CMAC subkeys.
create or replace function public._shift1(p bytea)
returns bytea language plpgsql immutable strict as $$
declare r bytea := p; i integer; carry integer := 0; b integer;
begin
  for i in reverse 15..0 loop
    b := get_byte(p, i);
    r := set_byte(r, i, ((b << 1) & 255) | carry);
    carry := (b >> 7) & 1;
  end loop;
  return r;
end $$;

create or replace function public._xor16(a bytea, b bytea)
returns bytea language plpgsql immutable strict as $$
declare r bytea := a; i integer;
begin
  for i in 0..15 loop r := set_byte(r, i, get_byte(a, i) # get_byte(b, i)); end loop;
  return r;
end $$;

-- AES-CMAC (RFC 4493) of any message, using AES-128.
create or replace function public._aes_cmac(p_key bytea, p_msg bytea)
returns bytea language plpgsql immutable strict set search_path = public as $$
declare
  zero bytea := '\x00000000000000000000000000000000';
  rb   bytea := '\x00000000000000000000000000000087';
  l bytea; k1 bytea; k2 bytea; n integer; last bytea; x bytea := zero; i integer;
begin
  l := public._aes_block(p_key, zero);
  k1 := public._shift1(l);
  if get_byte(l, 0) >= 128 then k1 := public._xor16(k1, rb); end if;
  k2 := public._shift1(k1);
  if get_byte(k1, 0) >= 128 then k2 := public._xor16(k2, rb); end if;
  n := greatest(1, (length(p_msg) + 15) / 16);
  if length(p_msg) > 0 and length(p_msg) % 16 = 0 then
    last := public._xor16(substring(p_msg from (n - 1) * 16 + 1 for 16), k1);
  else
    last := substring(p_msg from (n - 1) * 16 + 1) || '\x80'::bytea;
    last := last || substring(zero from 1 for 16 - length(last));
    last := public._xor16(last, k2);
  end if;
  for i in 0..n - 2 loop
    x := public._aes_block(p_key, public._xor16(x, substring(p_msg from i * 16 + 1 for 16)));
  end loop;
  return public._aes_block(p_key, public._xor16(x, last));
end $$;

-- Checks one tap's picc + cmac against a key. Returns the tag id and counter, or nothing if it's not genuine.
create or replace function public._sun_check(p_key bytea, p_picc text, p_cmac text)
returns table (uid bytea, counter integer)
language plpgsql immutable set search_path = public, extensions as $$
declare picc bytea; plain bytea; v_uid bytea; ctr bytea; ses bytea; full_mac bytea; mac bytea := ''; i integer;
begin
  if p_picc !~* '^[0-9a-f]{32}$' or p_cmac !~* '^[0-9a-f]{16}$' then return; end if;
  picc := decode(p_picc, 'hex');
  plain := extensions.decrypt(picc, p_key, 'aes-cbc/pad:none');
  -- 0xC7: the tag mirrors its 7-byte id and its 3-byte counter.
  if get_byte(plain, 0) <> 199 then return; end if;
  v_uid := substring(plain from 2 for 7);
  ctr := substring(plain from 9 for 3);
  ses := public._aes_cmac(p_key, '\x3cc300010080'::bytea || v_uid || ctr);
  full_mac := public._aes_cmac(ses, ''::bytea);
  for i in 0..7 loop mac := mac || substring(full_mac from i * 2 + 2 for 1); end loop;
  if mac <> decode(p_cmac, 'hex') then return; end if;
  return query select v_uid, get_byte(ctr, 0) + (get_byte(ctr, 1) << 8) + (get_byte(ctr, 2) << 16);
end $$;

revoke execute on function public._aes_block(bytea, bytea) from public, anon, authenticated;
revoke execute on function public._aes_cmac(bytea, bytea) from public, anon, authenticated;
revoke execute on function public._sun_check(bytea, text, text) from public, anon, authenticated;

-- A tap on a table's NFC tag: checks the tag, then opens (or reuses) the visit exactly like scan_qr does,
-- marked as at the shop. Opening the same tap link again on the same phone is fine; anyone else is refused.
create or replace function public.tap_nfc(p_token text, p_picc text, p_cmac text)
returns table (visit_id uuid, place_id uuid, place_name text, area text, table_label text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare t public.nfc_tags; chk record; s record;
begin
  if auth.uid() is null then raise exception 'sign in to scan'; end if;
  select nt.* into t from public.nfc_tags nt join public.qr_codes qc on qc.id = nt.qr_code_id
  where qc.token = p_token and qc.active;
  if not found then raise exception 'this tag isn''t set up yet. Scan the QR code instead'; end if;

  select * into chk from public._sun_check(t.key, p_picc, p_cmac);
  if chk.uid is null or (t.uid is not null and t.uid <> chk.uid) then
    raise exception 'this tag link isn''t genuine. Scan the QR code instead';
  end if;
  if chk.counter < t.last_counter or (chk.counter = t.last_counter and t.last_user is distinct from auth.uid()) then
    raise exception 'this tap link was already used. Tap the tag again';
  end if;
  update public.nfc_tags
     set uid = coalesce(nfc_tags.uid, chk.uid), last_counter = chk.counter, last_user = auth.uid(), last_tap_at = now()
   where qr_code_id = t.qr_code_id and nfc_tags.last_counter <= chk.counter;
  if not found then raise exception 'this tap link was already used. Tap the tag again'; end if;

  select * into s from public.scan_qr(p_token) limit 1;
  update public.visits set near = true, tapped = true where id = s.visit_id;
  return query select s.visit_id, s.place_id, s.place_name, s.area, s.table_label, s.expires_at;
end $$;
revoke execute on function public.tap_nfc(text, text, text) from public, anon;
grant execute on function public.tap_nfc(text, text, text) to authenticated;

-- For the owner (or an admin): the key and status of one table's tag, made on first ask.
create or replace function public.nfc_tag_setup(p_qr uuid, p_new_key boolean default false)
returns table (qr_code_id uuid, key_hex text, linked boolean, taps integer, last_tap_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare v_place uuid;
begin
  select qc.place_id into v_place from public.qr_codes qc where qc.id = p_qr and qc.active;
  if v_place is null then raise exception 'unknown table code'; end if;
  if not (public.is_admin() or public.is_place_owner(v_place)) then raise exception 'not your shop'; end if;
  insert into public.nfc_tags (qr_code_id) values (p_qr) on conflict on constraint nfc_tags_pkey do nothing;
  if p_new_key then
    update public.nfc_tags set key = extensions.gen_random_bytes(16), uid = null, last_counter = -1, last_user = null, last_tap_at = null
    where nfc_tags.qr_code_id = p_qr;
  end if;
  return query select nt.qr_code_id, upper(encode(nt.key, 'hex')), nt.uid is not null, greatest(nt.last_counter, 0), nt.last_tap_at
  from public.nfc_tags nt where nt.qr_code_id = p_qr;
end $$;
revoke execute on function public.nfc_tag_setup(uuid, boolean) from public, anon;
grant execute on function public.nfc_tag_setup(uuid, boolean) to authenticated;
