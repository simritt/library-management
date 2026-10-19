import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, BookMarked, CheckCircle2, Clock3, FileText, RefreshCw, Search, Send, ShieldAlert, XCircle } from 'lucide-react';
import { catalogApi, requestsApi } from '../utils/api';
import Autocomplete from '../components/Autocomplete';
import { useAuth } from '../context/AuthContext';

const statusStyles = {
  Pending: 'bg-amber-50 text-amber-800 border-amber-200',
  Approved: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Rejected: 'bg-rose-50 text-rose-800 border-rose-200',
  Cancelled: 'bg-stone-100 text-stone-600 border-stone-200',
  Fulfilled: 'bg-[#e9eff5] text-[#243e51] border-[#ccd9e5]',
};

const formatDate = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium' }) : '—';

export default function BookRequests() {
  const { user } = useAuth();
  const isPatron = user?.role === 'Patron';
  const navigate = useNavigate();
  const [policy, setPolicy] = useState(null);
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('Pending');
  const [title, setTitle] = useState('');
  const [isbn, setIsbn] = useState('');
  const [picked, setPicked] = useState(null); // catalogue book chosen from the suggestions
  const [requestedDays, setRequestedDays] = useState('');
  const [note, setNote] = useState('');
  const [staffNotes, setStaffNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const maxDays = policy?.maxDays || (user?.memberType === 'Faculty' ? 30 : 14);
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (isPatron) {
        const [policyResult, requestResult] = await Promise.all([requestsApi.getPolicy(), requestsApi.getMine()]);
        setPolicy(policyResult);
        setRequestedDays((current) => current || String(policyResult.maxDays));
        setRequests(requestResult.requests || []);
      } else {
        const requestResult = await requestsApi.getAll(statusFilter);
        setRequests(requestResult.requests || []);
      }
    } catch (err) {
      setError(err.message || 'Could not load book requests.');
    } finally {
      setLoading(false);
    }
  }, [isPatron, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const counts = useMemo(() => requests.reduce((acc, request) => {
    acc[request.request_status] = (acc[request.request_status] || 0) + 1;
    return acc;
  }, {}), [requests]);

  const searchCatalogue = async (query) => (await catalogApi.getBooks({ q: query, limit: 6 })).data || [];

  const handleTitleChange = (value) => {
    setTitle(value);
    if (picked && value !== picked.title) {
      if (isbn === picked.isbn) setIsbn('');
      setPicked(null);
    }
  };

  const pickBook = (book) => { setTitle(book.title); setIsbn(book.isbn); setPicked(book); };

  // Typing a known ISBN fills the title (and vice versa), so staff never retype both.
  const lookupIsbn = async () => {
    const cleaned = isbn.replace(/[-\s]/g, '');
    if (title.trim() || !/^(\d{13}|\d{9}[\dXx])$/.test(cleaned)) return;
    try {
      const result = await catalogApi.getBookByIsbn(cleaned.toUpperCase());
      if (result.book) { setTitle(result.book.title); setPicked(result.book); }
    } catch { /* not in the catalogue: the patron is requesting a new title */ }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const result = await requestsApi.create({ title, isbn, requestedDays: Number(requestedDays), note });
      setSuccess(result.message || 'Request submitted for review.');
      setTitle(''); setIsbn(''); setNote(''); setPicked(null);
      setRequestedDays(String(maxDays));
      await fetchData();
    } catch (err) {
      setError(err.message || 'Could not submit this request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (request, status) => {
    setError(''); setSuccess(''); setBusyId(request.request_id);
    try {
      const result = await requestsApi.review(request.request_id, status, staffNotes[request.request_id] || '');
      setSuccess(result.message || `Request ${status.toLowerCase()}.`);
      await fetchData();
    } catch (err) {
      setError(err.message || 'Could not review request.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (requestId) => {
    if (!window.confirm('Cancel this pending request?')) return;
    setError(''); setSuccess(''); setBusyId(requestId);
    try {
      await requestsApi.cancel(requestId);
      setSuccess('Request cancelled.');
      await fetchData();
    } catch (err) {
      setError(err.message || 'Could not cancel request.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page-shell">
      <section className="page-heading-row">
        <div>
          <div className="eyebrow">COLLECTION SERVICES</div>
          <h1 className="page-title">{isPatron ? 'Request a book' : 'Book request desk'}</h1>
          <p className="page-subtitle">{isPatron ? 'Ask the library to acquire or make a title available. Your request and chosen loan duration remain visible in your account.' : 'Review requests submitted by patrons and move each request through a traceable decision.'}</p>
        </div>
        <div className="heading-mark"><BookMarked size={22} /><span>{isPatron ? 'PATRON SERVICES' : 'LIBRARY OPERATIONS'}</span></div>
      </section>

      {error && <div className="notice notice-error" role="alert"><ShieldAlert size={17} />{error}</div>}
      {success && <div className="notice notice-success" role="status"><CheckCircle2 size={17} />{success}</div>}

      {isPatron ? (
        <div className="request-layout">
          <section className="surface request-form-panel">
            <div className="surface-heading">
              <div><div className="eyebrow">NEW REQUEST</div><h2>Tell us what you need</h2></div>
              <span className="icon-tile"><FileText size={19} /></span>
            </div>
            <form onSubmit={handleSubmit} className="form-stack">
              <div className="field-label"><label htmlFor="request-title">Book title <span className="required">*</span></label>
                <Autocomplete
                  id="request-title"
                  value={title}
                  onChange={handleTitleChange}
                  onSelect={pickBook}
                  fetchOptions={searchCatalogue}
                  getKey={(book) => book.isbn}
                  renderOption={(book) => (
                    <div>
                      <div className="font-semibold text-stone-900">{book.title}</div>
                      <div className="text-[11px] text-stone-500">{book.author} · <span className="font-mono">{book.isbn}</span> · {Number(book.available_copies) > 0 ? `${book.available_copies} of ${book.total_copies} available` : 'all copies issued'}</div>
                    </div>
                  )}
                  className="field-control"
                  maxLength={255}
                  required
                  placeholder="Start typing a title or author, e.g. Clean Code"
                  emptyText="Not in our catalogue yet. Enter the ISBN below and we will review it as a new title."
                />
                <span className="field-hint">Pick a suggestion to fill the ISBN for you, or type the title of a book we do not hold yet.</span>
              </div>
              <label className="field-label">ISBN-10 or ISBN-13 <span className="required">*</span>
                <input className="field-control mono" value={isbn} onChange={(e) => { setIsbn(e.target.value); if (picked && e.target.value !== picked.isbn) setPicked(null); }} onBlur={lookupIsbn} required maxLength={20} placeholder="978-1-4919-1986-3" />
                <span className="field-hint">ISBN is checksum-validated before the request is saved.</span>
              </label>
              {picked && <div className="notice notice-success" role="status">In the catalogue: <strong>{picked.title}</strong>, {Number(picked.available_copies) > 0 ? `${picked.available_copies} of ${picked.total_copies} copies available now. You can also borrow it at the desk without a request.` : 'all copies are currently issued. A reservation from the book page keeps your place in the queue.'}</div>}
              <div className="duration-panel">
                <div><label className="field-label" htmlFor="requested-days">Loan duration requested</label><p className="field-hint">Maximum for your account: {maxDays} days ({policy?.memberType || user?.memberType || 'Student'} policy).</p></div>
                <div className="duration-input-wrap"><input id="requested-days" className="field-control" type="number" min="1" max={maxDays} required value={requestedDays} onChange={(e) => setRequestedDays(e.target.value)} /><span>days</span></div>
              </div>
              <label className="field-label">Note to librarian <span className="muted-inline">(optional)</span>
                <textarea className="field-control field-textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="Edition, course requirement, or any context that helps the library." />
              </label>
              {policy?.accountStatus === 'Inactive' && <div className="notice notice-error">Your library account is inactive. Contact the library desk before requesting a book.</div>}
              <button className="button button-primary button-wide" type="submit" disabled={submitting || policy?.accountStatus === 'Inactive'}><Send size={16} />{submitting ? 'Submitting request…' : 'Submit book request'}</button>
              <p className="micro-copy">A request is not an issue receipt. Approved requests are completed by the librarian when a copy is available.</p>
            </form>
          </section>

          <section className="surface request-history-panel">
            <div className="surface-heading">
              <div><div className="eyebrow">YOUR RECORD</div><h2>Request history</h2></div>
              <button className="button button-quiet button-small" onClick={fetchData} type="button"><RefreshCw size={14} /> Refresh</button>
            </div>
            <div className="request-list">
              {loading ? <div className="empty-state"><RefreshCw className="spin" size={20} />Loading your requests…</div> : requests.length === 0 ? <div className="empty-state"><BookMarked size={28} /><strong>No requests yet</strong><span>Your submitted book requests will appear here.</span></div> : requests.map((request) => (
                <article className="request-record" key={request.request_id}>
                  <div className="request-record-top"><span className="record-id">REQ-{String(request.request_id).padStart(4, '0')}</span><span className={`status-pill ${statusStyles[request.request_status] || ''}`}>{request.request_status}</span></div>
                  <h3>{request.requested_title}</h3>
                  <div className="record-meta mono">ISBN {request.requested_isbn}</div>
                  <div className="record-stats"><span><Clock3 size={14} /> {request.requested_days} day request</span><span>{request.catalog_exists ? `${request.available_copies} available` : 'Not in catalogue'}</span></div>
                  <div className="record-date">Submitted {formatDate(request.created_at)}</div>
                  {request.staff_note && <p className="staff-note">Library note: {request.staff_note}</p>}
                  {request.request_status === 'Pending' && <button className="button button-light button-small" type="button" disabled={busyId === request.request_id} onClick={() => handleCancel(request.request_id)}><XCircle size={14} /> Cancel request</button>}
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <>
          <div className="request-metrics">
            <div className="mini-metric"><span>Total shown</span><strong>{loading ? '—' : requests.length}</strong></div>
            <div className="mini-metric"><span>Pending review</span><strong>{loading ? '—' : (statusFilter === 'All' ? (counts.Pending || 0) : statusFilter === 'Pending' ? requests.length : counts.Pending || 0)}</strong></div>
            <div className="mini-metric"><span>Approved</span><strong>{statusFilter === 'All' ? (counts.Approved || 0) : '—'}</strong></div>
            <div className="mini-metric"><span>Fulfilled</span><strong>{statusFilter === 'All' ? (counts.Fulfilled || 0) : '—'}</strong></div>
          </div>
          <section className="surface">
            <div className="surface-heading request-desk-heading">
              <div><div className="eyebrow">REVIEW QUEUE</div><h2>Patron submissions</h2><p className="surface-description">Approval records who reviewed the request. Fulfillment happens when the actual copy is issued.</p></div>
              <div className="toolbar-actions"><label className="filter-label">Status <select className="field-control compact-control" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option>Pending</option><option>All</option><option>Approved</option><option>Rejected</option><option>Fulfilled</option><option>Cancelled</option></select></label><button className="button button-light button-small" type="button" onClick={fetchData}><RefreshCw size={14} /> Refresh</button></div>
            </div>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Request</th><th>Patron</th><th>Duration</th><th>Catalogue</th><th>Submitted</th><th>Review / action</th></tr></thead><tbody>
              {loading ? <tr><td colSpan="6" className="table-empty">Loading requests…</td></tr> : requests.length === 0 ? <tr><td colSpan="6" className="table-empty">No requests found for this filter.</td></tr> : requests.map((request) => (
                <tr key={request.request_id}>
                  <td><div className="table-primary">{request.requested_title}</div><div className="table-secondary mono">REQ-{String(request.request_id).padStart(4, '0')} · {request.requested_isbn}</div>{request.request_note && <div className="table-secondary note-truncate">{request.request_note}</div>}</td>
                  <td><div className="table-primary">{request.member_name}</div><div className="table-secondary">{request.membership_id} · {request.member_type}</div></td>
                  <td><strong>{request.requested_days} days</strong><div className="table-secondary">Policy max {request.member_type === 'Faculty' ? '30' : '14'} days</div></td>
                  <td>{request.catalog_exists ? <><span className="status-dot status-dot-green" /> <span className="table-primary">{request.available_copies} available</span><div className="table-secondary">of {request.total_copies} copies</div></> : <span className="text-muted">Needs acquisition</span>}</td>
                  <td className="table-secondary">{formatDate(request.created_at)}</td>
                  <td className="request-action-cell">
                    <span className={`status-pill ${statusStyles[request.request_status] || ''}`}>{request.request_status}</span>
                    {request.request_status === 'Pending' && <div className="review-controls"><input className="field-control review-note" value={staffNotes[request.request_id] || ''} onChange={(e) => setStaffNotes((old) => ({ ...old, [request.request_id]: e.target.value }))} placeholder="Optional note" maxLength={500} aria-label={`Review note for request ${request.request_id}`} /><div className="review-buttons"><button className="button button-approve button-small" type="button" disabled={busyId === request.request_id} onClick={() => handleReview(request, 'Approved')}><CheckCircle2 size={13} /> Approve</button><button className="button button-danger-outline button-small" type="button" disabled={busyId === request.request_id} onClick={() => handleReview(request, 'Rejected')}><XCircle size={13} /> Decline</button></div></div>}
                    {request.request_status === 'Approved' && request.catalog_exists && request.available_copies > 0 && <button className="button button-primary button-small issue-request-button" type="button" onClick={() => navigate(`/circulation?membershipId=${encodeURIComponent(request.membership_id)}&isbn=${encodeURIComponent(request.requested_isbn)}&requestedDays=${request.requested_days}&requestId=${request.request_id}`)}>Issue approved request <ArrowUpRight size={14} /></button>}
                    {request.request_status === 'Approved' && request.catalog_exists && Number(request.available_copies) === 0 && <div className="table-secondary">Approved. Waiting for a copy or reservation fulfilment.</div>}
                    {request.request_status === 'Approved' && !request.catalog_exists && <div className="table-secondary">Add this ISBN to the catalogue before issuing.</div>}
                    {request.staff_note && <div className="table-secondary note-truncate">{request.staff_note}</div>}
                  </td>
                </tr>
              ))}
            </tbody></table></div>
          </section>
        </>
      )}
    </div>
  );
}
