import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { deviceId } from '../lib/device';
import { categoryLabel, HELP_CATEGORIES, HELP_STATUS, recoveryError, type HelpRequest } from '../lib/recovery';
import { Icon } from './ui';
import '../styles/recovery.css';

/** A help request is deliberately separate from public reviews and marketing consent. */
export function CustomerHelp({ placeId, prepareVisit, onSent }: { placeId: string; prepareVisit?: () => Promise<boolean>; onSent?: () => void }) {
  const { session } = useAuth();
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('order');
  const [contact, setContact] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  // Stable across retries: a timeout after commit must not create a second request.
  const request = useRef(crypto.randomUUID());
  const inFlight = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (prepareVisit && !(await prepareVisit())) throw new Error('Could not open your visit. Please try again, sign in if asked, or speak to the staff.');
      const { error: failure } = await supabase.rpc('request_customer_help', {
        p_place: placeId, p_request: request.current, p_body: body.trim(), p_category: category,
        p_contact: contact.trim() || null, p_allow_contact: consent, p_device: deviceId(),
      });
      if (failure) throw failure;
      setSent(true); onSent?.();
    } catch (e) { setError(recoveryError(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  if (sent) return <div className="help-receipt" role="status"><Icon name="checkCircle" size={24} /><h3>Your request is saved</h3><p>The shop can see it in its help queue. This is not a guarantee of an immediate response. For urgent help, speak to the staff.</p><Link className="btn green" to={`/help/${placeId}`}>Track your request<Icon name="chev" size={16} /></Link><p className="small muted">Keep this browser signed in to check the response. Saving a link alone does not restore a guest session.</p></div>;

  return <form className="help-form" onSubmit={(e) => void submit(e)}>
    <p className="small muted">Tell the shop what needs attention. You do not need to leave a public review.</p>
    <label className="field"><span id={`help-category-${placeId}`} className="strong small">What do you need help with?</span><select className="input" aria-labelledby={`help-category-${placeId}`} value={category} onChange={(e) => setCategory(e.target.value)}>{HELP_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    <label className="field"><span className="strong small">What happened?</span><textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} required minLength={1} maxLength={1000} rows={3} placeholder="For example: my order arrived cold. Could someone help?" /><span className="tiny muted">{body.length}/1,000 characters</span></label>
    <label className="field"><span className="strong small">Phone or email for a reply (optional)</span><input className="input" type="text" autoComplete="off" value={contact} maxLength={200} onChange={(e) => { setContact(e.target.value); if (!e.target.value.trim()) setConsent(false); }} /></label>
    {contact.trim() && <label className="help-check"><input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>I allow this shop to use these details to respond to this request.</span></label>}
    <p className="small muted"><Icon name="lock" size={14} /> The shop sees this message and any contact details you choose to share. Your account identity and public reviews are not attached. You can check its response here without sharing contact details.</p>
    {error && <div className="notice err" role="alert">{error}</div>}
    {!session && !prepareVisit ? <Link className="btn green" to={`/signin?next=${encodeURIComponent(`/help/${placeId}`)}`}>Sign in to request help</Link> : <button className="btn green" disabled={busy || !body.trim() || (Boolean(contact.trim()) && !consent)}>{busy ? 'Sending…' : 'Send help request'}<Icon name="send" size={16} /></button>}
    <p className="tiny muted">For immediate assistance, speak to the staff. This request does not subscribe you to offers.</p>
  </form>;
}

/** Request history remains accessible after the visit's review window closes. */
export function MyHelpRequests({ placeId, refresh = 0 }: { placeId?: string; refresh?: number }) {
  const { session } = useAuth();
  const [rows, setRows] = useState<HelpRequest[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_help_requests', { p_place: placeId || null, p_offset: page * 25 });
    if (error) throw error;
    return (data || []) as HelpRequest[];
  }, [placeId, page]);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    setRows(null); setError('');
    const update = () => { if (document.visibilityState === 'visible') void load().then((r) => { if (alive) { setRows(r); setError(''); } }, (e) => { if (alive) setError(recoveryError(e)); }); };
    update();
    const timer = window.setInterval(update, 30000);
    document.addEventListener('visibilitychange', update);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [session?.user.id, load, refresh, reload]);

  async function answer(r: HelpRequest, fixed: boolean) {
    if (busy) return;
    setBusy(r.id); setError('');
    try {
      const { error } = await supabase.rpc('confirm_help_resolution', { p_case: r.id, p_version: r.version, p_fixed: fixed });
      if (error) throw error;
      setRows(await load());
    } catch (e) { setError(recoveryError(e)); }
    finally { setBusy(null); }
  }

  if (!session) return <p className="small muted">Use the same browser or sign in to see your help requests.</p>;
  return <section className="help-history" aria-label="Your help requests">
    <div className="row"><h2 className="grow">Your help requests</h2><button type="button" className="btn ghost small" onClick={() => setReload((x) => x + 1)}><Icon name="refresh" size={16} />Refresh</button></div>
    <p className="small muted">Responses update every 30 seconds while this page is open.</p>
    {error && <p className="notice err" role="alert">{error}</p>}
    {!rows && !error && <p role="status">Loading requests…</p>}
    {rows?.length === 0 && <p className="small muted">No requests on this page. To ask for help, scan the shop’s QR code.</p>}
    {rows?.map((r) => <article className="help-case" key={r.id}>
      <div className="row wrap"><strong className="grow">{r.place_name}</strong><span className="badge">{r.confirmation === 'fixed' ? 'You confirmed it was fixed' : HELP_STATUS[r.status]}</span></div>
      <p className="tiny muted">{categoryLabel(r.category)} · {new Date(r.created_at).toLocaleString()}</p><p className="help-body">{r.body}</p>
      {r.resolution && <div className="help-response"><strong>Shop’s response</strong><p className="help-body">{r.resolution}</p></div>}
      {r.confirmation === 'not_fixed' && <p className="notice warn">You said it was not fixed. The request is open again.</p>}
      {r.status === 'resolved' && r.confirmation !== 'fixed' && <div><p className="strong small">Did this solve the problem?</p><div className="row wrap"><button className="btn green" disabled={busy !== null} onClick={() => void answer(r, true)}>Yes, it’s fixed</button><button className="btn ghost" disabled={busy !== null} onClick={() => void answer(r, false)}>No, I still need help</button></div></div>}
    </article>)}
    <div className="row"><button type="button" className="btn ghost" disabled={page === 0 || Boolean(busy)} onClick={() => setPage((x) => x - 1)}>Previous</button><span className="small">Page {page + 1}</span><button type="button" className="btn ghost" disabled={rows?.length !== 25 || Boolean(busy)} onClick={() => setPage((x) => x + 1)}>Next</button></div>
  </section>;
}
