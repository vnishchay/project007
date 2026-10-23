import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { pushState, turnOnReminders, type PushState } from '../../lib/push';
import { recoveryError } from '../../lib/recovery';
import { Icon } from '../ui';

interface AlertState { enabled: boolean; subscribed: boolean; worker_seen_at: string | null; failed: number; last_delivered_at: string | null }

export function RecoveryAlerts({ placeId }: { placeId: string }) {
  const [state, setState] = useState<AlertState | null>(null);
  const [device, setDevice] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const [r, p] = await Promise.all([supabase.rpc('recovery_alert_state', { p_place: placeId }), pushState()]);
        if (r.error) throw r.error;
        if (alive) { setState(r.data as AlertState); setDevice(p); setError(''); }
      } catch (e) { if (alive) setError(recoveryError(e)); }
    };
    void load(); const timer = window.setInterval(() => void load(), 30000);
    document.addEventListener('visibilitychange', load);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [placeId, reload]);

  async function toggle(enable: boolean) {
    setBusy(true); setError('');
    try {
      if (enable) {
        const p = await turnOnReminders(); setDevice(p);
        if (p !== 'on') return;
      }
      const { error } = await supabase.rpc('set_recovery_alerts', { p_place: placeId, p_enabled: enable });
      if (error) throw error;
      setReload((x) => x + 1);
    } catch (e) { setError(recoveryError(e)); }
    finally { setBusy(false); }
  }
  const recentWorker = state?.worker_seen_at && Date.now() - Date.parse(state.worker_seen_at) < 5 * 60000;
  return <details className="recovery-money recovery-alerts">
    <summary className="row wrap"><Icon name="bell" size={18} /><strong className="grow">Background help alerts</strong><span className="badge gray">{error ? 'Check status' : !state ? 'Checking…' : state.enabled ? recentWorker && device === 'on' && state.subscribed ? 'Enabled' : 'Check delivery' : 'Off'}</span><Icon name="down" size={16} /></summary>
    <p className="small muted">Opt in to notifications for new requests, reopened problems and missed follow-up targets. Messages contain no customer contact details. Staff assignment names do not enroll other people.</p>
    {device === 'unset' && <p className="small">Background notifications have not been configured for this app. Keep the help queue open during service.</p>}
    {device === 'install' && <p className="small">On iPhone, add this app to your home screen and open it there to enable notifications.</p>}
    {device === 'denied' && <p className="small">Notifications are blocked in your browser settings. Keep the queue open or allow notifications for this site.</p>}
    {device === 'unsupported' && <p className="small">This browser cannot receive background notifications. Keep the help queue open.</p>}
    {state?.enabled && <p className={`notice ${recentWorker ? '' : 'warn'} small`} role="status">{recentWorker ? 'The delivery worker checked in recently. Push delivery still depends on your browser and network.' : 'No recent delivery-worker check-in. Background delivery is not confirmed; keep the queue open.'}{device !== 'on' ? ' Notifications are not enabled on this device.' : ''}</p>}
    {state?.enabled && !state.subscribed && <p className="notice warn">No active notification subscription was found. Connect this device again.</p>}
    {state && state.failed > 0 && <p className="notice warn" role="alert">{state.failed} alerts exhausted their retries. Check the help queue directly.</p>}
    {state?.last_delivered_at && <p className="tiny muted">Last push accepted by the notification service: {new Date(state.last_delivered_at).toLocaleString()}. This does not confirm someone read it.</p>}
    {error && <p className="notice err" role="alert">{error}</p>}
    <div className="row wrap">{state && (device === 'off' || device === 'on') && <button type="button" className="btn ghost" disabled={busy} onClick={() => void toggle(true)}>{busy ? 'Updating…' : state.enabled ? 'Connect this device again' : 'Enable help alerts'}</button>}{state?.enabled && <button type="button" className="btn ghost" disabled={busy} onClick={() => void toggle(false)}>Turn off for this shop</button>}<button type="button" className="btn ghost" disabled={busy} onClick={() => setReload((x) => x + 1)}>Check status</button></div>
    <p className="tiny muted">The shop preference applies to your subscribed devices. Dispatch runs about once a minute when configured; failed delivery is retried up to five times. Check the queue during service even when alerts are on.</p>
  </details>;
}
