import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, BookOpen, CircleDollarSign, FileSpreadsheet, RefreshCw, Search, Users } from 'lucide-react';
import { catalogApi, ledgerApi, membersApi } from '../utils/api';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value) => value ? String(value).slice(0, 10) : '—';
const statusClass = (status) => status === 'Issued' ? 'status-pill status-live' : status === 'Returned' ? 'status-pill status-complete' : 'status-pill';

export default function LedgerDesk() {
  const [mode, setMode] = useState('member');
  const [members, setMembers] = useState([]);
  const [books, setBooks] = useState([]);
  const [selectedMember, setSelectedMember] = useState('');
  const [selectedBook, setSelectedBook] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [bookQuery, setBookQuery] = useState('');
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      membersApi.getMembers({ page: 1, limit: 50, status: 'All' }),
      catalogApi.getBooks({ page: 1, limit: 50, sortBy: 'title', order: 'ASC' }),
    ]).then(([memberResult, bookResult]) => {
      setMembers(memberResult.data || []);
      setBooks(bookResult.data || []);
    }).catch((err) => setError(err.message || 'Could not load ledger selectors.')).finally(() => setBootLoading(false));
  }, []);

  const filteredMembers = useMemo(() => {
    const q = memberQuery.toLowerCase().trim();
    return members.filter((m) => !q || `${m.name} ${m.membership_id} ${m.institutional_id}`.toLowerCase().includes(q));
  }, [members, memberQuery]);
  const filteredBooks = useMemo(() => {
    const q = bookQuery.toLowerCase().trim();
    return books.filter((b) => !q || `${b.title} ${b.isbn} ${b.author}`.toLowerCase().includes(q));
  }, [books, bookQuery]);

  const loadLedger = async (event) => {
    event?.preventDefault(); setError(''); setLoading(true); setLedger(null);
    try {
      if (mode === 'member') {
        if (!selectedMember) throw new Error('Select a member to open their ledger.');
        setLedger({ type: 'member', ...(await ledgerApi.member(selectedMember)) });
      } else {
        if (!selectedBook) throw new Error('Select a book to open its circulation ledger.');
        setLedger({ type: 'book', ...(await ledgerApi.book(selectedBook)) });
      }
    } catch (err) {
      setError(err.message || 'Could not load ledger.');
    } finally { setLoading(false); }
  };

  const activeMember = ledger?.type === 'member' ? ledger.member : null;
  const activeBook = ledger?.type === 'book' ? ledger.book : null;

  return (
    <div className="page-shell">
      <section className="page-heading-row">
        <div><div className="eyebrow">AUDIT & TRACEABILITY</div><h1 className="page-title">Circulation ledgers</h1><p className="page-subtitle">A chronological, database-backed record of who borrowed what, how long it was held, when it was returned and how fines were settled.</p></div>
        <div className="heading-mark"><FileSpreadsheet size={22} /><span>LEDGER REGISTER</span></div>
      </section>

      {error && <div className="notice notice-error" role="alert">{error}</div>}

      <section className="surface ledger-selector">
        <div className="mode-tabs" role="tablist" aria-label="Ledger type">
          <button type="button" role="tab" aria-selected={mode === 'member'} className={mode === 'member' ? 'mode-tab mode-tab-active' : 'mode-tab'} onClick={() => { setMode('member'); setLedger(null); setError(''); }}><Users size={16} /> Member ledger</button>
          <button type="button" role="tab" aria-selected={mode === 'book'} className={mode === 'book' ? 'mode-tab mode-tab-active' : 'mode-tab'} onClick={() => { setMode('book'); setLedger(null); setError(''); }}><BookOpen size={16} /> Book ledger</button>
        </div>
        {mode === 'member' ? (
          <form className="ledger-search-form" onSubmit={loadLedger}>
            <label className="field-label">Search a member <span className="required">*</span><div className="search-input-wrap"><Search size={16} /><input className="field-control" value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Name, membership ID or institutional ID" /></div></label>
            <label className="field-label">Member record<select className="field-control" value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)} disabled={bootLoading}><option value="">{bootLoading ? 'Loading members…' : 'Choose member'}</option>{filteredMembers.map((m) => <option key={m.membership_id} value={m.membership_id}>{m.name} · {m.membership_id}</option>)}</select></label>
            <button className="button button-primary" type="submit" disabled={loading || bootLoading}><Search size={15} /> {loading ? 'Loading…' : 'Open ledger'}</button>
          </form>
        ) : (
          <form className="ledger-search-form" onSubmit={loadLedger}>
            <label className="field-label">Search the catalogue <span className="required">*</span><div className="search-input-wrap"><Search size={16} /><input className="field-control" value={bookQuery} onChange={(e) => setBookQuery(e.target.value)} placeholder="Title, author or ISBN" /></div></label>
            <label className="field-label">Book record<select className="field-control" value={selectedBook} onChange={(e) => setSelectedBook(e.target.value)} disabled={bootLoading}><option value="">{bootLoading ? 'Loading books…' : 'Choose book'}</option>{filteredBooks.map((b) => <option key={b.isbn} value={b.isbn}>{b.title} · {b.isbn}</option>)}</select></label>
            <button className="button button-primary" type="submit" disabled={loading || bootLoading}><Search size={15} /> {loading ? 'Loading…' : 'Open ledger'}</button>
          </form>
        )}
      </section>

      {!ledger && !loading && <section className="ledger-prompt"><div className="ledger-prompt-icon"><FileSpreadsheet size={24} /></div><h2>Choose a record to begin</h2><p>Ledger entries are queried from live MySQL transaction data. Select a member or title above to inspect its complete history.</p></section>}
      {loading && <div className="empty-state"><RefreshCw size={19} className="spin" /> Loading ledger from the database…</div>}

      {activeMember && <>
        <section className="ledger-profile surface">
          <div className="ledger-identity"><div className="avatar-block">{activeMember.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</div><div><div className="eyebrow">MEMBER ACCOUNT</div><h2>{activeMember.name}</h2><p>{activeMember.membership_id} · {activeMember.institutional_id} · {activeMember.department}</p></div></div>
          <div className="identity-right"><span className={`status-pill ${activeMember.account_status === 'Active' ? 'status-complete' : 'status-overdue'}`}>{activeMember.account_status}</span><span>{activeMember.member_type} · limit {activeMember.borrowing_limit} books</span><span>{activeMember.email}</span></div>
        </section>
        <div className="ledger-stat-grid">
          <div className="ledger-stat"><span>Currently borrowed</span><strong>{ledger.summary.activeLoans}</strong><small>of {activeMember.borrowing_limit} permitted</small></div>
          <div className="ledger-stat"><span>Lifetime loans</span><strong>{ledger.summary.lifetimeLoans}</strong><small>Issued and returned records</small></div>
          <div className="ledger-stat"><span>Total fine charged</span><strong>{money(ledger.summary.finesCharged)}</strong><small>Across all assessed fines</small></div>
          <div className="ledger-stat"><span>Fine collected</span><strong className="good-amount">{money(ledger.summary.finesCollected)}</strong><small>Recorded payment receipts</small></div>
          <div className="ledger-stat"><span>Fine waived</span><strong>{money(ledger.summary.finesWaived)}</strong><small>Admin-authorised adjustments</small></div>
          <div className="ledger-stat"><span>Fine still due</span><strong className={ledger.summary.finesOutstanding > 0 ? 'bad-amount' : 'good-amount'}>{money(ledger.summary.finesOutstanding)}</strong><small>Recorded dues + live overdue estimate</small></div>
        </div>
        <LedgerLoanTable rows={ledger.loans || []} />
        <section className="surface ledger-lower-grid">
          <div><div className="surface-heading"><div><div className="eyebrow">FINANCIAL REGISTER</div><h2>Fine history</h2></div><CircleDollarSign size={19} /></div>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Fine / book</th><th>Charged</th><th>Paid</th><th>Waived</th><th>Due</th></tr></thead><tbody>{!ledger.fines?.length ? <tr><td colSpan="5" className="table-empty">No fine records.</td></tr> : ledger.fines.map((f) => <tr key={f.fine_id}><td><div className="table-primary">#{f.fine_id} · {f.title}</div><div className="table-secondary">{date(f.date_charged)}</div></td><td>{money(f.amount_charged)}</td><td className="good-amount">{money(f.amount_paid)}</td><td>{money(f.waived_amount)}</td><td className={Number(f.outstanding) > 0 ? 'bad-amount' : 'good-amount'}>{money(f.outstanding)}</td></tr>)}</tbody></table></div>
          </div>
          <div><div className="surface-heading"><div><div className="eyebrow">PAYMENT RECEIPTS</div><h2>Collection history</h2></div><ArrowDownToLine size={19} /></div>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Receipt</th><th>Date</th><th>Amount</th></tr></thead><tbody>{!ledger.payments?.length ? <tr><td colSpan="3" className="table-empty">No payments recorded.</td></tr> : ledger.payments.map((p) => <tr key={p.payment_id}><td><div className="table-primary mono">{p.receipt_number}</div><div className="table-secondary">{p.title}</div></td><td>{date(p.payment_date)}</td><td className="good-amount">{money(p.amount)}</td></tr>)}</tbody></table></div>
          </div>
        </section>
      </>}

      {activeBook && <>
        <section className="ledger-profile surface">
          <div className="ledger-identity"><div className="avatar-block book-avatar"><BookOpen size={22} /></div><div><div className="eyebrow">TITLE REGISTER</div><h2>{activeBook.title}</h2><p>{activeBook.author} · {activeBook.category}</p><p className="mono">ISBN {activeBook.isbn}</p></div></div>
          <div className="identity-right"><span>{activeBook.edition || 'Edition not specified'}</span><span>{activeBook.publisher}</span><span>Published {activeBook.publication_year || '—'}</span></div>
        </section>
        <div className="ledger-stat-grid">
          <div className="ledger-stat"><span>Physical copies</span><strong>{activeBook.total_copies}</strong><small>Unique accession numbers</small></div>
          <div className="ledger-stat"><span>Available now</span><strong>{activeBook.available_copies}</strong><small>Ready for issue</small></div>
          <div className="ledger-stat"><span>Currently issued</span><strong>{activeBook.currently_issued}</strong><small>Active loans</small></div>
          <div className="ledger-stat"><span>Lifetime transactions</span><strong>{ledger.summary.total_loans || 0}</strong><small>Issue records on this title</small></div>
          <div className="ledger-stat"><span>Fine collected</span><strong className="good-amount">{money(ledger.fines.collected)}</strong><small>On loans for this title</small></div>
          <div className="ledger-stat"><span>Outstanding fine</span><strong className={Number(ledger.fines.outstanding) > 0 ? 'bad-amount' : 'good-amount'}>{money(ledger.fines.outstanding)}</strong><small>Recorded dues + live overdue estimate</small></div>
        </div>
        <LedgerLoanTable rows={ledger.loans || []} bookMode />
      </>}
    </div>
  );
}

function LedgerLoanTable({ rows, bookMode = false }) {
  return <section className="surface ledger-table-panel"><div className="surface-heading"><div><div className="eyebrow">TRANSACTION REGISTER</div><h2>{bookMode ? 'All borrowers of this title' : 'Complete borrowing history'}</h2><p className="surface-description">Dates and day counts are calculated from persisted loan records.</p></div><span className="record-count">{rows.length} records</span></div><div className="table-scroll"><table className="data-table"><thead><tr>{bookMode && <th>Borrower</th>}<th>Accession / loan</th><th>Issue date</th><th>Due date</th><th>Return date</th><th>Days held</th><th>Days remaining</th><th>Overdue</th><th>Fine charged</th><th>Collected</th><th>Fine due</th><th>Status</th></tr></thead><tbody>{!rows.length ? <tr><td colSpan={bookMode ? 12 : 11} className="table-empty">No borrowing transactions recorded for this selection.</td></tr> : rows.map((loan) => <tr key={loan.loan_id}>{bookMode && <td><div className="table-primary">{loan.member_name}</div><div className="table-secondary">{loan.membership_id} · {loan.member_type}</div></td>}<td><div className="table-primary mono">{loan.accession_number}</div><div className="table-secondary">Loan #{loan.loan_id}</div>{!bookMode && <div className="table-secondary">{loan.title}</div>}</td><td>{date(loan.issue_date)}</td><td>{date(loan.due_date)}</td><td>{date(loan.return_date)}</td><td>{loan.days_elapsed ?? '—'}</td><td>{loan.loan_status === 'Issued' ? loan.days_remaining : '—'}</td><td className={Number(loan.days_overdue) > 0 ? 'bad-amount' : ''}>{loan.days_overdue || 0}</td><td>{money(loan.fine_charged)}</td><td className="good-amount">{money(bookMode ? loan.fine_collected : loan.fine_paid)}</td><td className={(Number(bookMode ? loan.fine_due : loan.fine_outstanding) + Number(loan.fine_accrued_now || 0)) > 0 ? 'bad-amount' : 'good-amount'}>{money(Number(bookMode ? loan.fine_due : loan.fine_outstanding) + Number(loan.fine_accrued_now || 0))}{Number(loan.fine_accrued_now || 0) > 0 && <div className="table-secondary">incl. {money(loan.fine_accrued_now)} accruing</div>}</td><td><span className={statusClass(loan.loan_status)}>{loan.loan_status}</span></td></tr>)}</tbody></table></div></section>;
}
