import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, BookMarked, BookOpen, CalendarClock, CheckCircle2, Clock3, CreditCard, Receipt, RefreshCw, XCircle } from 'lucide-react';
import { circulationApi, ledgerApi } from '../utils/api';
import { useAuth } from '../context/AuthContext';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value) => value ? String(value).slice(0, 10) : '—';

export default function PatronDashboard() {
  const { user } = useAuth();
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchLedger = async () => {
    setLoading(true); setError('');
    try { setLedger(await ledgerApi.me()); }
    catch (err) { setError(err.message || 'Unable to load your account.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetchLedger(); }, []);

  const cancelReservation = async (reservationId) => {
    if (!window.confirm('Cancel this reservation?')) return;
    try { await circulationApi.cancelReservation(reservationId); await fetchLedger(); }
    catch (err) { setError(err.message || 'Could not cancel reservation.'); }
  };

  const member = ledger?.member;
  const summary = ledger?.summary;
  const activeLoans = (ledger?.loans || []).filter((loan) => loan.loan_status === 'Issued');
  const pendingRequests = (ledger?.requests || []).filter((request) => request.request_status === 'Pending');
  const overdueLoans = activeLoans.filter((loan) => Number(loan.days_overdue) > 0);

  return (
    <div className="page-shell">
      <section className="account-hero">
        <div className="account-hero-copy"><div className="eyebrow eyebrow-light">MY LIBRARY</div><h1>Welcome back, {member?.name || user?.name || 'Reader'}.</h1><p>Your borrowing, requests, reservations and fine receipts in one reliable record.</p><div className="account-hero-meta"><span>{member?.membership_id || user?.membershipId}</span><span>{member?.member_type || user?.memberType || 'Patron'}</span><span>{member?.department || user?.department || 'Library member'}</span></div></div>
        <div className="account-hero-side"><div className="hero-open-book"><BookOpen size={28} /></div><span>SPIT CENTRAL LIBRARY</span><small>Self-service account</small></div>
      </section>

      {error && <div className="notice notice-error" role="alert"><AlertCircle size={16} />{error}</div>}
      {loading ? <div className="empty-state"><RefreshCw size={19} className="spin" /> Loading your account ledger…</div> : ledger && <>
        <div className="ledger-stat-grid account-stat-grid">
          <div className="ledger-stat"><span>Currently borrowed</span><strong>{summary.activeLoans}</strong><small>Borrowing limit: {member.borrowing_limit}</small></div>
          <div className="ledger-stat"><span>Overdue items</span><strong className={overdueLoans.length ? 'bad-amount' : ''}>{overdueLoans.length}</strong><small>{overdueLoans.length ? 'Please return or contact the desk' : 'Nothing overdue at the moment'}</small></div>
          <div className="ledger-stat"><span>Fine collected</span><strong className="good-amount">{money(summary.finesCollected)}</strong><small>Recorded payments to date</small></div>
          <div className="ledger-stat"><span>Fine due</span><strong className={summary.finesOutstanding > 0 ? 'bad-amount' : 'good-amount'}>{money(summary.finesOutstanding)}</strong><small>Includes live overdue estimate</small></div>
        </div>

        <div className="account-columns">
          <section className="surface account-current-loans"><div className="surface-heading"><div><div className="eyebrow">ON YOUR DESK</div><h2>Current borrowing</h2></div><span className="record-count">{activeLoans.length} active</span></div>
            {!activeLoans.length ? <div className="empty-state empty-compact"><BookOpen size={24} /><strong>No books currently issued</strong><span>Browse the catalogue when you are ready for your next read.</span><Link className="inline-link" to="/catalog">Explore catalogue <ArrowRight size={14} /></Link></div> : <div className="borrowed-book-list">{activeLoans.map((loan) => <article className="borrowed-book-row" key={loan.loan_id}><div className="book-spine"><BookOpen size={18} /></div><div className="borrowed-book-main"><h3>{loan.title}</h3><p>{loan.author} · <span className="mono">{loan.accession_number}</span></p><div className="borrow-progress-row"><span>Issued {date(loan.issue_date)}</span><span>Due {date(loan.due_date)}</span></div><div className="borrow-progress"><span style={{ width: `${Math.min(100, Math.max(5, (Number(loan.days_elapsed) / Math.max(1, Number(loan.days_elapsed) + Number(loan.days_remaining))) * 100))}%` }} /></div></div><div className={`days-left ${Number(loan.days_overdue) > 0 ? 'days-left-overdue' : ''}`}><strong>{Number(loan.days_overdue) > 0 ? loan.days_overdue : loan.days_remaining}</strong><small>{Number(loan.days_overdue) > 0 ? 'days overdue' : 'days left'}</small></div></article>)}</div>}
          </section>

          <section className="surface account-shortcuts"><div className="surface-heading"><div><div className="eyebrow">SELF-SERVICE</div><h2>Library services</h2></div></div>
            <Link className="service-link" to="/requests"><span className="service-icon"><BookMarked size={18} /></span><span><strong>Request a book</strong><small>Submit an ISBN and preferred loan duration</small></span><ArrowRight size={16} /></Link>
            <Link className="service-link" to="/catalog"><span className="service-icon"><BookOpen size={18} /></span><span><strong>Search the catalogue</strong><small>Check copies and book availability</small></span><ArrowRight size={16} /></Link>
            <Link className="service-link" to="/help"><span className="service-icon"><CalendarClock size={18} /></span><span><strong>Library rules & help</strong><small>Loan periods, fines and reservations</small></span><ArrowRight size={16} /></Link>
            <div className="account-policy-note"><CheckCircle2 size={16} /><span>Your borrowing limit is {member.borrowing_limit} books. Loan periods, fines and limits follow the library's current policy, which the server enforces. See Library rules for details.</span></div>
          </section>
        </div>

        <section className="surface account-history"><div className="surface-heading"><div><div className="eyebrow">BORROWING RECORD</div><h2>Loan ledger</h2><p className="surface-description">Each issue and return stays in your account history.</p></div><span className="record-count">{ledger.loans.length} lifetime records</span></div>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Book / accession</th><th>Issue date</th><th>Due date</th><th>Return date</th><th>Days held</th><th>Overdue</th><th>Fine charged</th><th>Fine paid</th><th>Fine due</th><th>Status</th></tr></thead><tbody>{!ledger.loans.length ? <tr><td colSpan="10" className="table-empty">Your borrowing history will appear here.</td></tr> : ledger.loans.map((loan) => <tr key={loan.loan_id}><td><div className="table-primary">{loan.title}</div><div className="table-secondary mono">{loan.accession_number}</div></td><td>{date(loan.issue_date)}</td><td>{date(loan.due_date)}</td><td>{date(loan.return_date)}</td><td>{loan.days_elapsed}</td><td className={Number(loan.days_overdue) > 0 ? 'bad-amount' : ''}>{loan.days_overdue || 0}</td><td>{money(loan.fine_charged)}</td><td className="good-amount">{money(loan.fine_paid)}</td><td className={(Number(loan.fine_outstanding || 0) + Number(loan.fine_accrued_now || 0)) > 0 ? 'bad-amount' : 'good-amount'}>{money(Number(loan.fine_outstanding || 0) + Number(loan.fine_accrued_now || 0))}{Number(loan.fine_accrued_now || 0) > 0 && <div className="table-secondary">incl. {money(loan.fine_accrued_now)} accruing</div>}</td><td><span className={`status-pill ${loan.loan_status === 'Issued' ? 'status-live' : 'status-complete'}`}>{loan.loan_status}</span></td></tr>)}</tbody></table></div>
        </section>

        <div className="account-columns account-columns-bottom">
          <section className="surface"><div className="surface-heading"><div><div className="eyebrow">RESERVATION QUEUE</div><h2>Your reservations</h2></div><span className="record-count">{ledger.reservations.filter((r) => r.status === 'Active').length} active</span></div>
            {!ledger.reservations.length ? <div className="empty-state empty-compact"><Clock3 size={23} /><span>You have no reservations yet.</span></div> : <div className="simple-record-list">{ledger.reservations.map((reservation) => <article className="simple-record" key={reservation.reservation_id}><div><strong>{reservation.title}</strong><small>ISBN {reservation.isbn}</small>{reservation.held_accession_number && <small className="good-amount">Held copy {reservation.held_accession_number} until {date(reservation.hold_expires_at)}</small>}</div><div className="simple-record-actions"><span className={`status-pill ${reservation.status === 'Active' ? 'status-live' : 'status-complete'}`}>{reservation.status}{reservation.status === 'Active' && !reservation.held_accession_number ? ` · queue ${reservation.live_queue_position ?? reservation.queue_position}` : ''}{reservation.status === 'Active' && reservation.held_accession_number ? ' · ready to collect' : ''}</span>{reservation.status === 'Active' && <button className="button button-quiet button-small" onClick={() => cancelReservation(reservation.reservation_id)} type="button"><XCircle size={13} /> Cancel</button>}</div></article>)}</div>}
          </section>
          <section className="surface"><div className="surface-heading"><div><div className="eyebrow">FINE RECEIPTS</div><h2>Payments & dues</h2></div><CreditCard size={19} /></div>
            {!ledger.fines.length ? <div className="empty-state empty-compact"><Receipt size={23} /><strong>No fines on record</strong><span>Any overdue charge and payment will appear here.</span></div> : <div className="simple-record-list">{ledger.fines.map((fine) => <article className="simple-record" key={fine.fine_id}><div><strong>{fine.title}</strong><small>Fine #{fine.fine_id} · assessed {date(fine.date_charged)}{Number(fine.waived_amount) > 0 ? ` · ${money(fine.waived_amount)} waived` : ''}</small></div><div className="fine-figures"><strong>{money(fine.amount_charged)}</strong><small className={Number(fine.outstanding) > 0 ? 'bad-amount' : 'good-amount'}>{money(fine.outstanding)} due</small></div></article>)}</div>}
            {ledger.payments.length > 0 && <div className="simple-record-list" aria-label="Payment history"><div className="eyebrow">PAYMENTS MADE</div>{ledger.payments.map((payment) => <article className="simple-record" key={payment.payment_id}><div><strong className="mono">{payment.receipt_number}</strong><small>{payment.title} · {date(payment.payment_date)}</small></div><div className="fine-figures"><strong className="good-amount">{money(payment.amount)}</strong></div></article>)}</div>}
          </section>
        </div>

        <section className="surface account-request-section"><div className="surface-heading"><div><div className="eyebrow">REQUEST STATUS</div><h2>Book requests</h2></div><Link to="/requests" className="button button-light button-small">Manage requests <ArrowRight size={14} /></Link></div>
          {!ledger.requests.length ? <div className="empty-state empty-compact"><BookMarked size={22} /><span>No book requests submitted.</span></div> : <div className="request-mini-grid">{ledger.requests.slice(0, 3).map((request) => <article key={request.request_id} className="request-mini-card"><span className={`status-pill ${request.request_status === 'Approved' || request.request_status === 'Fulfilled' ? 'status-complete' : request.request_status === 'Rejected' ? 'status-overdue' : 'status-live'}`}>{request.request_status}</span><strong>{request.requested_title}</strong><small className="mono">{request.requested_isbn}</small><small>{request.requested_days}-day duration · {date(request.created_at)}</small></article>)}</div>}
        </section>
      </>}
    </div>
  );
}
