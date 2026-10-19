import React, { useEffect, useState } from 'react';
import { Clock3, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react';
import { circulationApi, reservationsApi } from '../utils/api';

const dateTime = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export default function ReservationDesk() {
  const [reservations, setReservations] = useState([]);
  const [status, setStatus] = useState('Active');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { const result = await reservationsApi.getQueue({ status, q: query }); setReservations(result.reservations || []); }
    catch (err) { setError(err.message || 'Unable to load reservation queue.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [status]);

  const cancel = async (id) => {
    if (!window.confirm('Cancel this reservation and pass any held copy to the next patron?')) return;
    try { await circulationApi.cancelReservation(id); setSuccess('Reservation cancelled and any held copy was released or reassigned.'); await load(); }
    catch (err) { setError(err.message || 'Could not cancel reservation.'); }
  };

  return <div className="page-shell">
    <section className="page-heading-row"><div><div className="eyebrow">CIRCULATION CONTROL</div><h1 className="page-title">Reservation queue</h1><p className="page-subtitle">First-come-first-served reservations, held copy assignment and expiry tracking. Expired holds are automatically released or reassigned by the backend.</p></div><div className="heading-mark"><Clock3 size={22} /><span>FIFO QUEUE</span></div></section>
    {error && <div className="notice notice-error">{error}</div>}{success && <div className="notice notice-success">{success}</div>}
    <section className="surface"><div className="surface-heading request-desk-heading"><div><div className="eyebrow">REGISTER</div><h2>Reservation records</h2></div><div className="toolbar-actions"><form className="ledger-search-mini" onSubmit={(e) => { e.preventDefault(); load(); }}><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ISBN, title, member" /></form><select className="field-control compact-control" value={status} onChange={(e) => setStatus(e.target.value)}><option>Active</option><option>All</option><option>Fulfilled</option><option>Cancelled</option><option>Expired</option></select><button className="button button-light button-small" onClick={load} type="button"><RefreshCw size={14} /> Refresh</button></div></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>Queue</th><th>Book</th><th>Patron</th><th>Requested</th><th>Held copy / expiry</th><th>Status</th><th>Action</th></tr></thead><tbody>{loading ? <tr><td colSpan="7" className="table-empty">Loading queue…</td></tr> : !reservations.length ? <tr><td colSpan="7" className="table-empty">No reservation records match this filter.</td></tr> : reservations.map((r) => <tr key={r.reservation_id}><td><div className="table-primary">{r.status === 'Active' ? (r.live_queue_position || (r.held_accession_number ? 'Held' : '—')) : '—'}</div><div className="table-secondary">RES-{r.reservation_id}</div></td><td><div className="table-primary">{r.book_title}</div><div className="table-secondary mono">{r.isbn}</div></td><td><div className="table-primary">{r.member_name}</div><div className="table-secondary">{r.membership_id} · {r.member_type}</div><div className="table-secondary">{r.email}</div></td><td>{dateTime(r.reservation_date)}</td><td>{r.held_accession_number ? <><div className="table-primary mono">{r.held_accession_number}</div><div className="table-secondary">Expires {dateTime(r.hold_expires_at)}</div></> : <span className="text-muted">Waiting for return</span>}</td><td><span className={`status-pill ${r.status === 'Active' ? 'status-live' : r.status === 'Expired' || r.status === 'Cancelled' ? 'status-muted' : 'status-complete'}`}>{r.status}</span></td><td>{r.status === 'Active' ? <button className="button button-danger-outline button-small" type="button" onClick={() => cancel(r.reservation_id)}><XCircle size={13} /> Cancel</button> : <span className="table-secondary"><ShieldCheck size={13} className="inline-icon" /> Closed</span>}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
