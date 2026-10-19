import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { catalogApi, circulationApi, membersApi } from '../utils/api';
import Autocomplete from '../components/Autocomplete';
import { BookOpen, CheckCircle, AlertTriangle, Bookmark, Receipt, RotateCcw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';

const rupees = (value) => `Rs. ${Number(value || 0).toFixed(2)}`;

export default function CirculationDesk() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState('issue'); // 'issue', 'return', 'activeLoans', 'fines'
  const [activeLoans, setActiveLoans] = useState([]);
  const [loadingLoans, setLoadingLoans] = useState(false);

  // Issue Form State
  const [issueMembershipId, setIssueMembershipId] = useState('');
  const [issueAccessionNumber, setIssueAccessionNumber] = useState('');
  const [issueIsbn, setIssueIsbn] = useState('');
  const [issueBookQuery, setIssueBookQuery] = useState('');
  const [issueBookPick, setIssueBookPick] = useState(null);
  const [issueRequestedDays, setIssueRequestedDays] = useState('');
  const [issueReceipt, setIssueReceipt] = useState(null);
  const [issueError, setIssueError] = useState('');
  const [issueLoading, setIssueLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [canReserve, setCanReserve] = useState(false);
  const [reserveMessage, setReserveMessage] = useState('');

  // Return Form State
  const [returnAccessionNumber, setReturnAccessionNumber] = useState('');
  const [flagDamaged, setFlagDamaged] = useState(false);
  const [flagLost, setFlagLost] = useState(false);
  const [payFineNow, setPayFineNow] = useState(false);
  const [returnSummary, setReturnSummary] = useState(null);
  const [returnError, setReturnError] = useState('');
  const [returnLoading, setReturnLoading] = useState(false);

  // Fine collection (return summary + Fines tab)
  const [fineMemberQuery, setFineMemberQuery] = useState('');
  const [fineMember, setFineMember] = useState(null);
  const [fineLookupError, setFineLookupError] = useState('');
  const [fineAmounts, setFineAmounts] = useState({});
  const [fineReceipt, setFineReceipt] = useState(null);
  const [fineError, setFineError] = useState('');
  const [fineBusy, setFineBusy] = useState(false);

  // Search Loans State
  const [loanSearchTerm, setLoanSearchTerm] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);

  const fetchActiveLoans = async () => {
    setLoadingLoans(true);
    try {
      const res = await circulationApi.getActiveLoans({
        q: loanSearchTerm,
        overdueOnly: overdueOnly ? 'true' : 'false'
      });
      if (res.success) {
        setActiveLoans(res.loans);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingLoans(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'activeLoans') {
      fetchActiveLoans();
    }
  }, [activeTab, loanSearchTerm, overdueOnly]);

  // Live eligibility + due-date preview shown BEFORE the Librarian confirms (FR-Issue.DueDate-01, Eligibility-01..03).
  useEffect(() => {
    const id = issueMembershipId.trim();
    if (id.length < 4 || !/^MEM-/i.test(id)) { setPreview(null); setPreviewError(''); return undefined; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await circulationApi.previewIssue(id, issueRequestedDays);
        if (!cancelled) { setPreview(res); setPreviewError(''); }
      } catch (err) {
        if (!cancelled) { setPreview(null); setPreviewError(err.message || 'Could not look up member.'); }
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [issueMembershipId, issueRequestedDays]);

  const loadFineMember = async (event) => {
    event?.preventDefault();
    setFineLookupError(''); setFineMember(null); setFineReceipt(null); setFineError('');
    try {
      const res = await membersApi.getMemberDetails(fineMemberQuery.trim());
      setFineMember(res);
      setFineAmounts({});
    } catch (err) {
      setFineLookupError(err.message || 'Member not found.');
    }
  };

  const collectFine = async (fineId, amount, refreshMember = true) => {
    setFineError(''); setFineBusy(true);
    try {
      const res = await circulationApi.payFine({ fineId, amount: Number(amount) });
      setFineReceipt(res.receipt);
      if (refreshMember && fineMember) {
        const updated = await membersApi.getMemberDetails(fineMember.member.membership_id);
        setFineMember(updated);
      }
      return res.receipt;
    } catch (err) {
      setFineError(err.message || 'Payment failed.');
      return null;
    } finally {
      setFineBusy(false);
    }
  };

  const placeReservation = async () => {
    setReserveMessage('');
    try {
      const res = await circulationApi.reserveBook({ isbn: issueIsbn.trim(), membershipId: issueMembershipId.trim() });
      setReserveMessage(`Reservation placed for ${res.reservation.bookTitle}: queue position #${res.reservation.queuePosition}.`);
      setCanReserve(false); setIssueError('');
    } catch (err) {
      setReserveMessage(err.message || 'Could not place reservation.');
    }
  };

  // Deep-link approved patron requests directly into the issue workflow.
  useEffect(() => {
    const requestId = searchParams.get('requestId');
    if (requestId) {
      setActiveTab('issue');
      setIssueMembershipId(searchParams.get('membershipId') || '');
      setIssueIsbn(searchParams.get('isbn') || '');
      setIssueRequestedDays(searchParams.get('requestedDays') || '');
      setIssueError('');
      setIssueReceipt(null);
    }
  }, [searchParams]);

  // Handle Book Issue (FR-Issue)
  const handleIssueSubmit = async (e) => {
    e.preventDefault();
    setIssueError('');
    setIssueReceipt(null);
    setCanReserve(false);
    setReserveMessage('');
    setIssueLoading(true);

    try {
      const res = await circulationApi.issueBook({
        membershipId: issueMembershipId.trim(),
        accessionNumber: issueAccessionNumber.trim() || undefined,
        isbn: issueIsbn.trim() || undefined,
        requestedDays: issueRequestedDays ? Number(issueRequestedDays) : undefined,
        requestId: searchParams.get('requestId') || undefined
      });

      if (res.success) {
        setIssueReceipt(res.receipt);
        setIssueAccessionNumber('');
        setIssueIsbn('');
        setIssueBookQuery('');
        setIssueBookPick(null);
        setIssueRequestedDays('');
        setIssueMembershipId('');
        setPreview(null);
        setSearchParams({}, { replace: true });
      }
    } catch (err) {
      setIssueError(err.message || 'Error executing book issue');
      setCanReserve(Boolean(err.data?.canReserve) && Boolean(issueIsbn.trim()));
    } finally {
      setIssueLoading(false);
    }
  };

  // Handle Book Return (FR-Return)
  const handleReturnSubmit = async (e) => {
    e.preventDefault();
    setReturnError('');
    setReturnSummary(null);
    setReturnLoading(true);

    try {
      const res = await circulationApi.returnBook({
        accessionNumber: returnAccessionNumber.trim(),
        flagAsDamaged: flagDamaged,
        flagAsLost: flagLost,
        payFineNow: payFineNow
      });

      if (res.success) {
        setReturnSummary(res.returnSummary);
        setReturnAccessionNumber('');
        setFlagDamaged(false);
        setFlagLost(false);
        setPayFineNow(false);
        setFineReceipt(null);
        setFineError('');
      }
    } catch (err) {
      setReturnError(err.message || 'Error processing book return');
    } finally {
      setReturnLoading(false);
    }
  };

  // Quick Return from active loans table
  const handleQuickReturn = (accessionNumber) => {
    setActiveTab('return');
    setReturnAccessionNumber(accessionNumber);
    setReturnSummary(null);
    setReturnError('');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Title */}
      <div className="border-b border-stone-200 pb-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-navy-900 tracking-tight">
            Circulation Desk
          </h1>
          <p className="text-xs sm:text-sm text-stone-600 mt-1">
            Perform physical book issues, process returns, calculate overdue fines and verify member eligibility.
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="inline-flex rounded border border-stone-300 bg-stone-100 p-0.5 self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('issue')}
            className={`px-4 py-1.5 text-xs font-semibold rounded transition ${
              activeTab === 'issue'
                ? 'bg-white text-navy-900 shadow-sm'
                : 'text-stone-600 hover:text-navy-900'
            }`}
          >
            Issue Book
          </button>
          <button
            onClick={() => setActiveTab('return')}
            className={`px-4 py-1.5 text-xs font-semibold rounded transition ${
              activeTab === 'return'
                ? 'bg-white text-navy-900 shadow-sm'
                : 'text-stone-600 hover:text-navy-900'
            }`}
          >
            Return Book
          </button>
          <button
            onClick={() => setActiveTab('activeLoans')}
            className={`px-4 py-1.5 text-xs font-semibold rounded transition ${
              activeTab === 'activeLoans'
                ? 'bg-white text-navy-900 shadow-sm'
                : 'text-stone-600 hover:text-navy-900'
            }`}
          >
            Active Loans
          </button>
          <button
            onClick={() => setActiveTab('fines')}
            className={`px-4 py-1.5 text-xs font-semibold rounded transition ${
              activeTab === 'fines'
                ? 'bg-white text-navy-900 shadow-sm'
                : 'text-stone-600 hover:text-navy-900'
            }`}
          >
            Fines
          </button>
        </div>
      </div>

      {/* 1. ISSUE TAB */}
      {activeTab === 'issue' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 bg-white border border-stone-200 rounded p-6 shadow-sm">
            <h2 className="text-lg font-serif font-bold text-navy-900 mb-2">
              Book Issue Terminal
            </h2>
            <p className="text-xs text-stone-500 mb-6">
              Validates member account status, borrowing limit and fine threshold using the current library policy, and shows the due date before you confirm.
            </p>
            {searchParams.get('requestId') && (
              <div className="mb-5 p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">
                Issuing approved request <strong>REQ-{String(searchParams.get('requestId')).padStart(4, '0')}</strong>. The approved duration is linked to the loan and the request will be marked Fulfilled after the transaction succeeds.
              </div>
            )}

            {issueError && (
              <div className="mb-6 p-4 rounded bg-red-50 border border-red-200 text-red-900 text-xs flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                <div>
                  <strong className="block font-semibold">Eligibility Verification Refusal:</strong>
                  <span>{issueError}</span>
                  {canReserve && (
                    <div className="mt-2">
                      <button type="button" onClick={placeReservation} className="inline-flex items-center px-3 py-1.5 bg-white border border-red-300 rounded text-red-900 font-semibold hover:bg-red-100">
                        <Bookmark className="w-3.5 h-3.5 mr-1.5" /> Place {issueMembershipId.trim()} in the reservation queue
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {reserveMessage && (
              <div className="mb-6 p-3 rounded bg-purple-50 border border-purple-200 text-purple-900 text-xs" role="status">{reserveMessage}</div>
            )}

            <form onSubmit={handleIssueSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Member Identification (Required)
                </label>
                <Autocomplete
                  required
                  placeholder="Type a name or Membership ID, e.g. MEM-2026-0001"
                  value={issueMembershipId}
                  onChange={setIssueMembershipId}
                  onSelect={(member) => setIssueMembershipId(member.membership_id)}
                  fetchOptions={async (query) => (await membersApi.getMembers({ q: query, status: 'All', page: 1, limit: 6 })).data || []}
                  getKey={(member) => member.membership_id}
                  renderOption={(member) => (
                    <div>
                      <div className="font-semibold text-stone-900">{member.name}</div>
                      <div className="text-[11px] text-stone-500"><span className="font-mono">{member.membership_id}</span> · {member.member_type} · {member.account_status}</div>
                    </div>
                  )}
                  emptyText="No member matches that name or ID"
                  className="w-full px-3 py-2 border border-stone-300 rounded text-sm font-mono focus:ring-1 focus:ring-navy-700 focus:outline-none"
                />
                <span className="text-[11px] text-stone-500 mt-1 block">
                  Search by name or Membership ID and pick the member.
                </span>
                {previewError && /^MEM-/i.test(issueMembershipId.trim()) && issueMembershipId.trim().length >= 4 && (
                  <div className="mt-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded px-3 py-2">{previewError}</div>
                )}
                {preview && (
                  <div className={`mt-2 rounded border px-3 py-2.5 text-xs ${preview.eligible ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'}`} data-testid="issue-preview">
                    <div className="flex items-center justify-between gap-3">
                      <strong>{preview.member.name}</strong>
                      <span className="uppercase tracking-wider text-[10px] font-bold">{preview.member.memberType} · {preview.member.accountStatus}</span>
                    </div>
                    <div className="mt-1 text-[11px] space-x-3">
                      <span>Borrowed {preview.member.activeLoans} / {preview.member.borrowingLimit}</span>
                      <span>Fine due {rupees(preview.member.outstandingFine)}</span>
                      <span>Max loan {preview.policy.maxLoanDays} days</span>
                    </div>
                    {preview.eligible ? (
                      <div className="mt-1.5 font-semibold">Eligible. Due date if issued today: <span className="font-mono">{preview.dueDate}</span> ({preview.loanDays} days)</div>
                    ) : (
                      <ul className="mt-1.5 list-disc pl-4 font-semibold">{preview.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-stone-100 pt-4">
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Accession Number (Specific Physical Copy)
                </label>
                <input
                  type="text"
                  placeholder="e.g. ACC-9780132350884-002"
                  value={issueAccessionNumber}
                  onChange={(e) => setIssueAccessionNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 rounded text-sm font-mono focus:ring-1 focus:ring-navy-700 focus:outline-none"
                />
                <span className="text-[11px] text-stone-500 mt-1 block">
                  Scan barcode or input unique copy Accession Number.
                </span>
              </div>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-stone-200"></div>
                <span className="flex-shrink mx-3 text-[11px] uppercase font-semibold text-stone-400">Or Auto-Select by Title / ISBN</span>
                <div className="flex-grow border-t border-stone-200"></div>
              </div>

              <div>
                <label htmlFor="issue-book-title" className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Search the catalogue by title or author
                </label>
                <Autocomplete
                  id="issue-book-title"
                  placeholder="e.g. Clean Code"
                  value={issueBookQuery}
                  onChange={(value) => { setIssueBookQuery(value); if (issueBookPick && value !== issueBookPick.title) { if (issueIsbn === issueBookPick.isbn) setIssueIsbn(''); setIssueBookPick(null); } }}
                  onSelect={(book) => { setIssueBookQuery(book.title); setIssueIsbn(book.isbn); setIssueBookPick(book); }}
                  fetchOptions={async (query) => (await catalogApi.getBooks({ q: query, limit: 6 })).data || []}
                  getKey={(book) => book.isbn}
                  renderOption={(book) => (
                    <div>
                      <div className="font-semibold text-stone-900">{book.title}</div>
                      <div className="text-[11px] text-stone-500">{book.author} · <span className="font-mono">{book.isbn}</span> · {Number(book.available_copies) > 0 ? `${book.available_copies} of ${book.total_copies} available` : 'all copies issued'}</div>
                    </div>
                  )}
                  className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:ring-1 focus:ring-navy-700 focus:outline-none"
                />
                {issueBookPick && (
                  <span className="text-[11px] text-stone-600 mt-1 block">
                    ISBN <span className="font-mono">{issueBookPick.isbn}</span> filled below. {Number(issueBookPick.available_copies) > 0 ? `${issueBookPick.available_copies} of ${issueBookPick.total_copies} copies available.` : 'No copy is free; you will be offered a reservation.'}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Book ISBN (10 or 13 digits)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 9780132350884"
                  value={issueIsbn}
                  onChange={(e) => { setIssueIsbn(e.target.value); if (issueBookPick && e.target.value !== issueBookPick.isbn) setIssueBookPick(null); }}
                  className="w-full px-3 py-2 border border-stone-300 rounded text-sm font-mono focus:ring-1 focus:ring-navy-700 focus:outline-none"
                />
                <span className="text-[11px] text-stone-500 mt-1 block">
                  System will automatically allocate the first available copy in inventory.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Loan Duration (Days, Optional)
                </label>
                <input
                  type="number"
                  min="1"
                  max={preview?.policy?.maxLoanDays || undefined}
                  value={issueRequestedDays}
                  onChange={(e) => setIssueRequestedDays(e.target.value)}
                  placeholder="Leave blank to use member policy"
                  className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:ring-1 focus:ring-navy-700 focus:outline-none"
                />
                <span className="text-[11px] text-stone-500 mt-1 block">
                  Approved requests carry their requested days. The server validates every duration against the member's policy.
                </span>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={issueLoading}
                  className="w-full py-2.5 px-4 bg-navy-800 hover:bg-navy-900 text-white font-semibold text-xs uppercase tracking-wider rounded shadow-sm transition disabled:opacity-50"
                >
                  {issueLoading ? 'Validating & Issuing...' : 'Verify Eligibility & Confirm Issue'}
                </button>
              </div>
            </form>
          </div>

          {/* Issue Receipt Output */}
          <div className="lg:col-span-5">
            {issueReceipt ? (
              <div className="bg-emerald-50/60 border border-emerald-300 rounded p-6 shadow-sm">
                <div className="flex items-center space-x-2 text-emerald-800 mb-4">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-serif font-bold text-base">Issue Confirmation & Receipt</h3>
                </div>

                <dl className="text-xs space-y-2.5 text-stone-700 border-t border-emerald-200 pt-3">
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Loan ID:</dt>
                    <dd className="font-mono font-bold text-stone-900">#{issueReceipt.loanId}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Book Title:</dt>
                    <dd className="font-medium text-stone-900 text-right max-w-[200px]">{issueReceipt.bookTitle}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Accession No:</dt>
                    <dd className="font-mono text-stone-900">{issueReceipt.accessionNumber}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Borrower Name:</dt>
                    <dd className="font-semibold text-stone-900">{issueReceipt.memberName}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Membership ID:</dt>
                    <dd className="font-mono text-stone-800">{issueReceipt.membershipId}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Member Role:</dt>
                    <dd className="text-stone-800">{issueReceipt.memberType}</dd>
                  </div>
                  <div className="flex justify-between border-t border-emerald-200 pt-2 font-medium">
                    <dt className="text-stone-600">Issue Date:</dt>
                    <dd className="font-mono text-stone-900">{issueReceipt.issueDate}</dd>
                  </div>
                  <div className="flex justify-between text-navy-900 font-bold border-b border-emerald-200 pb-2">
                    <dt>Calculated Due Date:</dt>
                    <dd className="font-mono text-sm text-emerald-900">{issueReceipt.dueDate}</dd>
                  </div>
                </dl>

                <div className="mt-4 text-[11px] text-emerald-900/80 bg-white/70 p-2.5 rounded border border-emerald-200">
                  Physical copy status updated to <strong>Issued</strong> and catalog available count decremented.
                </div>
              </div>
            ) : (
              <div className="bg-stone-50 border border-dashed border-stone-300 rounded p-8 text-center text-stone-500">
                <BookOpen className="w-8 h-8 mx-auto text-stone-400 mb-2" />
                <h4 className="font-serif font-medium text-stone-700 text-sm">Circulation Issue Guidelines</h4>
                <p className="text-xs text-stone-500 mt-2 max-w-xs mx-auto">
                  Loan period, borrowing limit and fine threshold depend on the member type and the Administrator's current policy. Enter a Membership ID to see the member's eligibility and due date.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. RETURN TAB */}
      {activeTab === 'return' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 bg-white border border-stone-200 rounded p-6 shadow-sm">
            <h2 className="text-lg font-serif font-bold text-navy-900 mb-2">
              Book Return Terminal
            </h2>
            <p className="text-xs text-stone-500 mb-6">
              Processes returned books, updates inventory count, checks active hold queues (48h reservation hold), and automatically assesses overdue fines.
            </p>

            {returnError && (
              <div className="mb-6 p-4 rounded bg-red-50 border border-red-200 text-red-900 text-xs flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                <div>
                  <strong className="block font-semibold">Return Processing Error:</strong>
                  <span>{returnError}</span>
                </div>
              </div>
            )}

            <form onSubmit={handleReturnSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Accession Number (Required)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ACC-9780132350884-001"
                  value={returnAccessionNumber}
                  onChange={(e) => setReturnAccessionNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 rounded text-sm font-mono focus:ring-1 focus:ring-navy-700 focus:outline-none"
                />
                <span className="text-[11px] text-stone-500 mt-1 block">
                  Scan barcode or input unique copy Accession Number to locate the active loan.
                </span>
              </div>

              <div className="border-t border-stone-100 pt-3 space-y-3">
                <label className="flex items-start space-x-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flagDamaged}
                    onChange={(e) => { setFlagDamaged(e.target.checked); if (e.target.checked) setFlagLost(false); }}
                    className="mt-0.5 rounded border-stone-300 text-navy-800 focus:ring-navy-700"
                  />
                  <span>
                    <strong>Flag as Damaged</strong> (Routes copy to damaged quarantine instead of returning to available circulation, FR-Return.Condition-01)
                  </span>
                </label>

                <label className="flex items-start space-x-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flagLost}
                    onChange={(e) => { setFlagLost(e.target.checked); if (e.target.checked) setFlagDamaged(false); }}
                    className="mt-0.5 rounded border-stone-300 text-navy-800 focus:ring-navy-700"
                  />
                  <span>
                    <strong>Mark as Lost</strong> (Closes the loan as Lost, retires the copy and charges the maximum per-loan fine, BR-6)
                  </span>
                </label>

                <label className="flex items-start space-x-2 text-xs text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={payFineNow}
                    onChange={(e) => setPayFineNow(e.target.checked)}
                    className="mt-0.5 rounded border-stone-300 text-navy-800 focus:ring-navy-700"
                  />
                  <span>
                    <strong>Collect fine immediately</strong> (If book is overdue, generates instant cash payment receipt, FR-Return.Fine-02)
                  </span>
                </label>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={returnLoading}
                  className="w-full py-2.5 px-4 bg-navy-800 hover:bg-navy-900 text-white font-semibold text-xs uppercase tracking-wider rounded shadow-sm transition disabled:opacity-50"
                >
                  {returnLoading ? 'Processing Return...' : 'Confirm Book Return'}
                </button>
              </div>
            </form>
          </div>

          {/* Return Summary / Receipt Output */}
          <div className="lg:col-span-5">
            {returnSummary ? (
              <div className="bg-white border border-stone-300 rounded p-6 shadow-sm">
                <div className="flex items-center space-x-2 text-navy-900 mb-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-serif font-bold text-base">Return Processed Successfully</h3>
                </div>

                <dl className="text-xs space-y-2 text-stone-700 border-t border-stone-100 pt-3">
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Book Title:</dt>
                    <dd className="font-medium text-stone-900 text-right max-w-[200px]">{returnSummary.bookTitle}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Accession No:</dt>
                    <dd className="font-mono text-stone-900">{returnSummary.accessionNumber}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Borrower:</dt>
                    <dd className="font-medium text-stone-900">{returnSummary.memberName}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Due Date:</dt>
                    <dd className="font-mono text-stone-700">{returnSummary.dueDate}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Return Date:</dt>
                    <dd className="font-mono text-stone-700">{returnSummary.returnDate}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-stone-500">Updated Copy Status:</dt>
                    <dd className="font-semibold text-navy-900 uppercase text-[11px]">{returnSummary.copyStatus}</dd>
                  </div>

                  {/* Overdue and fine info */}
                  <div className="border-t border-stone-200 pt-2">
                    {returnSummary.isOverdue ? (
                      <div className="bg-amber-50 p-2.5 rounded border border-amber-200 text-amber-900 space-y-1">
                        <div className="font-bold flex items-center justify-between">
                          <span>Overdue Duration:</span>
                          <span className="font-mono">{returnSummary.daysOverdue} days</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span>{returnSummary.lost ? 'Lost-book charge (maximum fine):' : 'Fine assessed:'}</span>
                          <span className="font-mono font-bold text-sm text-red-700">Rs. {returnSummary.fineAmount.toFixed(2)}</span>
                        </div>
                        {returnSummary.finePaid && (
                          <div className="text-[11px] text-emerald-800 font-semibold pt-1 border-t border-amber-200">
                            ✓ Paid immediately (Receipt #{returnSummary.paymentReceipt?.receiptNumber})
                          </div>
                        )}
                        {!returnSummary.finePaid && returnSummary.fineId && !fineReceipt && (
                          <div className="pt-2 border-t border-amber-200 flex items-center justify-between gap-2">
                            <span className="text-[11px]">Not yet collected.</span>
                            <button
                              type="button"
                              disabled={fineBusy}
                              onClick={() => collectFine(returnSummary.fineId, returnSummary.fineAmount, false)}
                              className="px-2.5 py-1 bg-navy-800 hover:bg-navy-900 text-white rounded text-[11px] font-semibold disabled:opacity-50"
                            >
                              {fineBusy ? 'Recording…' : `Collect ${rupees(returnSummary.fineAmount)} now`}
                            </button>
                          </div>
                        )}
                        {fineReceipt && !returnSummary.finePaid && (
                          <div className="text-[11px] text-emerald-800 font-semibold pt-1 border-t border-amber-200">
                            ✓ Collected (Receipt #{fineReceipt.receiptNumber}). Remaining {rupees(fineReceipt.remainingBalance)}.
                          </div>
                        )}
                        {fineError && <div className="text-[11px] text-red-800 pt-1">{fineError}</div>}
                      </div>
                    ) : (
                      <div className="text-emerald-800 text-xs font-semibold py-1">
                        ✓ Returned on time — No fine assessed.
                      </div>
                    )}
                  </div>

                  {/* Reservation Hold Notice (FR-Return.Reservation-01) */}
                  {returnSummary.reservationHold && (
                    <div className="mt-3 bg-purple-50 p-3 rounded border border-purple-200 text-purple-900 text-xs">
                      <strong className="block font-semibold">Reservation Hold Placed (BR-7):</strong>
                      <span>
                        Held for next patron in queue: <strong>{returnSummary.reservationHold.patronName}</strong> ({returnSummary.reservationHold.membershipId}). Held exclusively for {returnSummary.reservationHold.holdHours} hours.
                      </span>
                    </div>
                  )}
                </dl>
              </div>
            ) : (
              <div className="bg-stone-50 border border-dashed border-stone-300 rounded p-8 text-center text-stone-500">
                <RotateCcw className="w-8 h-8 mx-auto text-stone-400 mb-2" />
                <h4 className="font-serif font-medium text-stone-700 text-sm">Return Workflow</h4>
                <p className="text-xs text-stone-500 mt-2 max-w-xs mx-auto">
                  Enter the accession number of the returned physical volume to complete check-in, update copy availability, and record any overdue fines.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. ACTIVE LOANS TAB */}
      {activeTab === 'activeLoans' && (
        <div className="bg-white border border-stone-200 rounded shadow-sm">
          <div className="p-4 border-b border-stone-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Filter by accession, member, or book..."
                value={loanSearchTerm}
                onChange={(e) => setLoanSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700 focus:outline-none"
              />
            </div>

            <label className="flex items-center space-x-2 text-xs text-stone-700 cursor-pointer self-start sm:self-auto">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={(e) => setOverdueOnly(e.target.checked)}
                className="rounded border-stone-300 text-navy-800 focus:ring-navy-700"
              />
              <span className="font-medium text-red-700">Overdue Loans Only</span>
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-stone-700">
              <thead className="bg-stone-50 border-b border-stone-200 uppercase font-semibold tracking-wider text-[11px] text-stone-500">
                <tr>
                  <th className="px-5 py-3">Accession No</th>
                  <th className="px-5 py-3">Book Title</th>
                  <th className="px-5 py-3">Member Name & ID</th>
                  <th className="px-5 py-3">Issue Date</th>
                  <th className="px-5 py-3">Due Date</th>
                  <th className="px-5 py-3">Status / Overdue</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {loadingLoans ? (
                  <tr>
                    <td colSpan="7" className="px-5 py-8 text-center text-stone-500 italic">
                      Loading circulation loans...
                    </td>
                  </tr>
                ) : activeLoans.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-5 py-8 text-center text-stone-500">
                      No active loans matching criteria found.
                    </td>
                  </tr>
                ) : (
                  activeLoans.map((l) => {
                    const isOverdue = l.days_overdue > 0;
                    return (
                      <tr key={l.loan_id} className={`hover:bg-stone-50/50 ${isOverdue ? 'bg-red-50/20' : ''}`}>
                        <td className="px-5 py-3 font-mono font-semibold text-stone-900">
                          {l.accession_number}
                        </td>
                        <td className="px-5 py-3 font-medium text-stone-900 max-w-xs truncate">
                          {l.book_title}
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-semibold text-stone-800">{l.member_name}</div>
                          <div className="font-mono text-[11px] text-stone-500">{l.membership_id} ({l.member_type})</div>
                        </td>
                        <td className="px-5 py-3 font-mono text-stone-600">
                          {l.issue_date}
                        </td>
                        <td className="px-5 py-3 font-mono text-stone-600">
                          {l.due_date}
                        </td>
                        <td className="px-5 py-3">
                          {isOverdue ? (
                            <span className="inline-block px-2 py-0.5 rounded bg-red-100 text-red-900 border border-red-200 text-[10px] font-bold">
                              {l.days_overdue} DAYS OVERDUE
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200 text-[10px] font-semibold">
                              ACTIVE
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => handleQuickReturn(l.accession_number)}
                            className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 rounded text-xs font-medium transition"
                          >
                            Return
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. FINES TAB (FR-Fine.Pay-01, Pay-02) */}
      {activeTab === 'fines' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 bg-white border border-stone-200 rounded p-6 shadow-sm">
            <h2 className="text-lg font-serif font-bold text-navy-900 mb-2">Fine Collection</h2>
            <p className="text-xs text-stone-500 mb-5">Look up a member to see assessed fines and record a full or partial payment. Waivers are an Administrator action on the member's profile page.</p>
            <form onSubmit={loadFineMember} className="flex gap-2 mb-5">
              <input
                type="text"
                required
                value={fineMemberQuery}
                onChange={(e) => setFineMemberQuery(e.target.value)}
                placeholder="Membership ID, e.g. MEM-2026-0001"
                className="flex-1 px-3 py-2 border border-stone-300 rounded text-sm font-mono focus:ring-1 focus:ring-navy-700 focus:outline-none"
              />
              <button type="submit" className="px-4 py-2 bg-navy-800 hover:bg-navy-900 text-white font-semibold text-xs uppercase tracking-wider rounded">Look up</button>
            </form>
            {fineLookupError && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-900 text-xs">{fineLookupError}</div>}
            {fineError && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-900 text-xs">{fineError}</div>}
            {fineMember && (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3 mb-3">
                  <div>
                    <div className="font-semibold text-stone-900">{fineMember.member.name}</div>
                    <div className="text-[11px] font-mono text-stone-500">{fineMember.member.membership_id} · {fineMember.member.member_type}</div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-stone-500 uppercase text-[10px] font-bold">Outstanding</div>
                    <div className={`font-mono text-lg font-bold ${fineMember.outstandingFineBalance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{rupees(fineMember.outstandingFineBalance)}</div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-stone-700">
                    <thead className="bg-stone-50 border-b border-stone-200 uppercase font-semibold tracking-wider text-[11px] text-stone-500">
                      <tr><th className="px-3 py-2">Fine</th><th className="px-3 py-2">Book</th><th className="px-3 py-2">Charged</th><th className="px-3 py-2">Paid</th><th className="px-3 py-2">Waived</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">Collect</th></tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {fineMember.fines.length === 0 ? (
                        <tr><td colSpan="7" className="px-3 py-6 text-center text-stone-500 italic">No fines assessed for this member.</td></tr>
                      ) : fineMember.fines.map((f) => {
                        const due = Math.max(0, Number(f.amount_charged) - Number(f.amount_paid) - Number(f.waived_amount));
                        const amount = fineAmounts[f.fine_id] ?? due.toFixed(2);
                        return (
                          <tr key={f.fine_id}>
                            <td className="px-3 py-2 font-mono">#{f.fine_id}</td>
                            <td className="px-3 py-2">{f.book_title}</td>
                            <td className="px-3 py-2 font-mono whitespace-nowrap">{rupees(f.amount_charged)}</td>
                            <td className="px-3 py-2 font-mono text-emerald-700 whitespace-nowrap">{rupees(f.amount_paid)}</td>
                            <td className="px-3 py-2 font-mono whitespace-nowrap">{rupees(f.waived_amount)}</td>
                            <td className={`px-3 py-2 font-mono font-bold whitespace-nowrap ${due > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{rupees(due)}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              {due > 0 ? (
                                <span className="inline-flex items-center gap-1">
                                  <input type="number" step="0.5" min="0.5" max={due} value={amount} onChange={(e) => setFineAmounts({ ...fineAmounts, [f.fine_id]: e.target.value })} aria-label={`Amount for fine ${f.fine_id}`} className="w-20 px-2 py-1 border border-stone-300 rounded font-mono" />
                                  <button type="button" disabled={fineBusy} onClick={() => collectFine(f.fine_id, amount)} className="px-2.5 py-1 bg-navy-800 hover:bg-navy-900 text-white rounded font-semibold disabled:opacity-50">Collect</button>
                                </span>
                              ) : <span className="text-stone-400">Settled</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-right"><Link className="text-xs text-navy-800 underline" to={`/patron/${fineMember.member.membership_id}`}>Open full member profile (waivers, reservations)</Link></div>
              </div>
            )}
          </div>
          <div className="lg:col-span-4">
            {fineReceipt ? (
              <div className="bg-emerald-50/60 border border-emerald-300 rounded p-6 shadow-sm" data-testid="fine-receipt">
                <div className="flex items-center space-x-2 text-emerald-800 mb-3"><Receipt className="w-5 h-5" /><h3 className="font-serif font-bold text-base">Payment Receipt</h3></div>
                <dl className="text-xs space-y-2 text-stone-700 border-t border-emerald-200 pt-3">
                  <div className="flex justify-between"><dt className="text-stone-500">Receipt no:</dt><dd className="font-mono font-bold">{fineReceipt.receiptNumber}</dd></div>
                  <div className="flex justify-between"><dt className="text-stone-500">Member:</dt><dd>{fineReceipt.memberName}</dd></div>
                  <div className="flex justify-between"><dt className="text-stone-500">Amount paid:</dt><dd className="font-mono font-bold">{rupees(fineReceipt.amountPaid)}</dd></div>
                  <div className="flex justify-between"><dt className="text-stone-500">Date:</dt><dd className="font-mono">{String(fineReceipt.paymentDate).slice(0, 10)}</dd></div>
                  <div className="flex justify-between border-t border-emerald-200 pt-2"><dt className="text-stone-600">Remaining balance on this fine:</dt><dd className="font-mono font-bold">{rupees(fineReceipt.remainingBalance)}</dd></div>
                </dl>
              </div>
            ) : (
              <div className="bg-stone-50 border border-dashed border-stone-300 rounded p-8 text-center text-stone-500">
                <Receipt className="w-8 h-8 mx-auto text-stone-400 mb-2" />
                <h4 className="font-serif font-medium text-stone-700 text-sm">Receipts appear here</h4>
                <p className="text-xs mt-2">Each recorded payment generates an on-screen receipt with the remaining balance.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
