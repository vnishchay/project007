import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { formatPrice } from '../../lib/money';
import { categoryLabel, recoveryError, type HelpStatus, type RecoveryCase, type RecoveryQueueData } from '../../lib/recovery';
import { Icon } from '../ui';
import { RecoveryAlerts } from './RecoveryAlerts';
import '../../styles/recovery.css';

export function RecoveryQueue({ placeId, onChanged }: { placeId: string; onChanged?: () => void }) {
  const [filter, setFilter] = useState('active');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<RecoveryQueueData | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<RecoveryCase | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null); setError('');
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const { data, error } = await supabase.rpc('shop_recovery_cases', { p_place: placeId, p_filter: filter, p_offset: page * 25 });
        if (error) throw error;
        if (alive) { setData(data as RecoveryQueueData); setError(''); }
      } catch (e) { if (alive) setError(recoveryError(e)); }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    document.addEventListener('visibilitychange', load);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [placeId, filter, page, reload]);
  const refresh = () => { setReload((x) => x + 1); onChanged?.(); };

  return <section className="recovery-queue" aria-labelledby="recovery-title">
    <div className="row wrap"><span className="icon-chip coral"><Icon name="message" size={20} /></span><h2 className="grow" id="recovery-title">Customer help</h2><button type="button" className="btn ghost small" onClick={refresh}><Icon name="refresh" size={16} />Refresh</button></div>
    <p className="small muted">Handle the request, record what you did, and let the customer confirm. Available on every plan. Updates every 30 seconds while open.</p>
    {error && <div className="notice err" role="alert">{error}</div>}
    {!data && !error && <p role="status">Loading help requests…</p>}
    {data && <>
      <div className="recovery-summary" aria-label="Help request outcomes">
        <Stat label="Open requests" value={data.open} /><Stat label="Past 30-minute target" value={data.overdue} />
        <Stat label="Shop resolved · 30 days" value={data.resolved_30d} /><Stat label="Customer confirmed · 30 days" value={data.confirmed_30d} />
      </div>
      <p className="tiny muted">The 30-minute target is an internal follow-up target, not a promised response time. Resolved counts use the resolution date; confirmation is the customer’s answer.</p>
      {data.money.length > 0 && <div className="recovery-money"><strong>Recorded costs and purchases</strong>{data.money.map((m) => <span key={m.currency} className="small">{m.currency}: {formatPrice(Number(m.cost), m.currency)} recovery cost · {formatPrice(Number(m.recorded_sales), m.currency)} recorded purchases across {m.purchases} bills</span>)}<span className="tiny muted">For requests created in the last 30 days. Purchases are entered by the owner with a bill reference; they are not independently verified. These are not additional revenue or profit. No purchases are inferred from scans.</span></div>}
    </>}
    <div className="chips" role="group" aria-label="Help queue filter">{[['active', 'Needs action'], ['resolved', 'Resolved'], ['all', 'All requests']].map(([id, label]) => <button key={id} className={`chip ${filter === id ? 'on' : ''}`} aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(0); setEditing(null); }}>{label}</button>)}</div>
    <RecoveryAlerts key={placeId} placeId={placeId} />
    {data?.cases.length === 0 && <div className="notice"><Icon name="checkCircle" size={18} /> {filter === 'active' ? 'No open help requests. Customers can ask for help from your shop QR page.' : 'No requests on this page.'}</div>}
    {data?.cases.map((c) => <article className="help-case" key={c.id}>
      <div className="recovery-case-header"><strong className="grow">{categoryLabel(c.category)} · {c.id.slice(0, 8)}</strong><span className={`badge ${c.status !== 'resolved' && Date.parse(c.due_at) < Date.now() ? 'coral' : 'gray'}`}>{c.status === 'resolved' ? c.confirmation === 'fixed' ? 'Customer confirmed' : 'Awaiting confirmation' : Date.parse(c.due_at) < Date.now() ? 'Past target' : c.status === 'in_progress' ? 'Being handled' : 'New request'}</span></div>
      <p className="small muted">{new Date(c.created_at).toLocaleString()} · {c.assigned_to ? `Responsible: ${c.assigned_to}` : 'Nobody assigned yet'}</p>
      <p className="help-body">{c.body}</p>
      {c.contact && <p className="small"><strong>Customer allowed contact:</strong> <span className="help-body">{c.contact}</span></p>}
      {c.confirmation === 'not_fixed' && <p className="notice warn">Customer said the problem is not fixed. Follow up again.</p>}
      {c.resolution && <div className="help-response"><strong className="small">{c.status === 'resolved' || c.confirmation === 'not_fixed' ? 'Response visible to customer' : 'Response draft'}</strong><p className="help-body small">{c.resolution}</p></div>}
      {editing?.id === c.id ? <CaseEditor key={`${editing.id}:${editing.version}`} item={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} /> : <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing(c)}><Icon name="edit" size={16} />{c.status === 'resolved' ? 'Review outcome' : 'Handle request'}</button>}
    </article>)}
    {data && <div className="row wrap"><button className="btn ghost" disabled={page === 0} onClick={() => { setPage((x) => x - 1); setEditing(null); }}>Previous</button><span className="small grow">{data.total} {data.total === 1 ? 'request' : 'requests'} · page {page + 1}</span><button className="btn ghost" disabled={(page + 1) * 25 >= data.total} onClick={() => { setPage((x) => x + 1); setEditing(null); }}>Next</button></div>}
  </section>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="recovery-stat"><strong>{value.toLocaleString()}</strong><span>{label}</span></div>;
}

function CaseEditor({ item: c, onCancel, onSaved }: { item: RecoveryCase; onCancel: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const [status, setStatus] = useState<HelpStatus>(c.status);
  const [assigned, setAssigned] = useState(c.assigned_to);
  const [resolution, setResolution] = useState(c.resolution);
  const [internal, setInternal] = useState(c.internal_note);
  const [cost, setCost] = useState(String(c.recovery_cost));
  const [amount, setAmount] = useState(c.purchase_amount == null ? '' : String(c.purchase_amount));
  const [bill, setBill] = useState(c.bill_reference || '');
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const changedPurchase = amount !== (c.purchase_amount == null ? '' : String(c.purchase_amount)) || bill !== (c.bill_reference || '');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    if (amount.trim() && changedPurchase && !attest) { setError('Confirm that you checked the bill before recording a purchase.'); return; }
    saving.current = true; setBusy(true); setError('');
    try {
      const { error } = await supabase.rpc('update_recovery_case', {
        p_case: c.id, p_version: c.version, p_status: status, p_assigned_to: assigned.trim(), p_resolution: resolution.trim(),
        p_internal_note: internal.trim(), p_recovery_cost: Number(cost), p_purchase_amount: amount.trim() ? Number(amount) : null,
        p_bill_reference: bill.trim() || null,
      });
      if (error) throw error;
      onSaved();
    } catch (e) { setError(recoveryError(e)); }
    finally { saving.current = false; setBusy(false); }
  }

  return <form className="recovery-editor" onSubmit={(e) => void save(e)}>
    <div className="recovery-fields">
      <label className="field"><span id={`help-status-${c.id}`} className="strong small">Status</span><select className="input" aria-labelledby={`help-status-${c.id}`} value={status} onChange={(e) => setStatus(e.target.value as HelpStatus)}><option value="open">Open</option><option value="in_progress">Being handled</option><option value="resolved">Resolved by shop</option></select></label>
      <label className="field"><span className="strong small">Person responsible</span><input className="input" value={assigned} onChange={(e) => setAssigned(e.target.value)} maxLength={80} required={status !== 'open'} placeholder="Manager’s name" /><button className="link-btn small" type="button" onClick={() => setAssigned(profile?.display_name || 'Owner')}>Assign to me</button></label>
    </div>
    <p className="tiny muted">The responsible name is an internal label. It does not invite staff or send them a message.</p>
    <label className="field"><span className="strong small">What did you do? Shared with the customer when resolved.</span><textarea className="textarea" rows={3} maxLength={1000} value={resolution} onChange={(e) => setResolution(e.target.value)} required={status === 'resolved'} placeholder="Describe the action taken and any next step." /></label>
    <label className="field"><span className="strong small">Internal follow-up note</span><textarea className="textarea" rows={2} maxLength={1000} value={internal} onChange={(e) => setInternal(e.target.value)} placeholder="For the owner only. Do not put this in the customer response." /></label>
    <div className="recovery-fields">
      <label className="field"><span className="strong small">Recovery cost ({c.currency})</span><input className="input" type="number" inputMode="decimal" min="0" max="10000000" step="0.01" required value={cost} onChange={(e) => setCost(e.target.value)} /><span className="tiny muted">Actual cost of refunds, replacements or compensation. Include each cost once.</span></label>
      <label className="field"><span className="strong small">Recorded purchase amount ({c.currency}, optional)</span><input className="input" type="number" inputMode="decimal" min="0.01" max="10000000" step="0.01" value={amount} onChange={(e) => { setAmount(e.target.value); setAttest(false); }} /><span className="tiny muted">Only a purchase you checked. Leave blank when unknown.</span></label>
    </div>
    <label className="field"><span className="strong small">Bill reference {amount ? '(required)' : '(only for a recorded purchase)'}</span><input className="input" maxLength={100} required={Boolean(amount)} value={bill} onChange={(e) => { setBill(e.target.value); setAttest(false); }} placeholder="Date + bill number, unique at this outlet" /></label>
    {amount && changedPurchase && <label className="help-check"><input type="checkbox" required checked={attest} onChange={(e) => setAttest(e.target.checked)} /><span>I checked this purchase against a bill. This does not establish additional revenue or profit.</span></label>}
    {c.confirmation === 'fixed' && <p className="notice">The customer confirmed the current response. Reopen the request before changing that response.</p>}
    {error && <div className="notice err" role="alert">{error}<button type="button" className="link-btn" onClick={onSaved}>Reload request</button></div>}
    <div className="row wrap"><button className="btn green" disabled={busy}>{busy ? 'Saving…' : 'Save request'}</button><button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}

/** A decision aid, not an attribution model. No inferred sales or fabricated ROI. */
export function ProfitCheck({ currency }: { currency?: string | null }) {
  const [fee, setFee] = useState('');
  const [contribution, setContribution] = useState('');
  const [costs, setCosts] = useState('0');
  const valid = [fee, contribution, costs].every((x) => x.trim() !== '' && Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) <= 10000000) && Number(contribution) > 0;
  const visits = valid ? Math.ceil((Number(fee) + Number(costs)) / Number(contribution)) : null;
  return <section className="mg-section" aria-label="Break-even estimate"><h2>What would make this worthwhile?</h2><p className="small muted">Estimate how many additional purchases would cover your monthly spend. Use contribution after variable costs, not the full bill value.</p><div className="recovery-fields">{[
    { label: 'Monthly plan and messaging cost', value: fee, change: setFee },
    { label: 'Contribution per additional purchase', value: contribution, change: setContribution },
    { label: 'Monthly recovery and reward costs', value: costs, change: setCosts },
  ].map((f) => <label className="field" key={f.label}><span className="small strong">{f.label} ({currency || 'INR'})</span><input className="input" type="number" min="0" max="10000000" step="0.01" inputMode="decimal" value={f.value} onChange={(e) => f.change(e.target.value)} /></label>)}</div>{visits !== null && <p className="notice" role="status">You would need at least <strong>{visits.toLocaleString()} additional purchases per month</strong> to cover these costs.</p>}<p className="tiny muted">Estimate = (monthly plan + recovery costs) ÷ contribution per additional purchase, rounded up. Do not count recovery costs again if already deducted from contribution. This estimate does not measure purchases caused by Trusted Picks. Inputs are not saved.</p></section>;
}
