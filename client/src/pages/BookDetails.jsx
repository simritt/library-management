import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { catalogApi, circulationApi } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { BookOpen, CheckCircle, Clock, AlertCircle, ArrowLeft, Bookmark } from 'lucide-react';

export default function BookDetails() {
  const { isbn } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [book, setBook] = useState(null);
  const [copies, setCopies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState(null);
  const [reserving, setReserving] = useState(false);
  const [copyBusy, setCopyBusy] = useState('');

  const isStaffUser = user && (user.role === 'Librarian' || user.role === 'Administrator');

  // Mark a physical copy Lost/Damaged or restore it (FR-Catalog.Remove-01..03). The server refuses copies on loan.
  const changeCopyStatus = async (copy, status) => {
    const remark = window.prompt(`Remark for marking ${copy.accession_number} as ${status} (optional):`, '');
    if (remark === null) return;
    setCopyBusy(copy.accession_number);
    setActionMessage(null);
    try {
      await catalogApi.updateCopyStatus(copy.accession_number, status, remark);
      setActionMessage({ type: 'success', text: `${copy.accession_number} is now ${status}.` });
      await fetchBookData();
    } catch (err) {
      setActionMessage({ type: 'error', text: err.message || 'Could not update the copy.' });
    } finally {
      setCopyBusy('');
    }
  };

  useEffect(() => {
    fetchBookData();
  }, [isbn]);

  const fetchBookData = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await catalogApi.getBookByIsbn(isbn);
      if (data.success) {
        setBook(data.book);
        setCopies(data.copies);
      }
    } catch (err) {
      setError(err.message || 'Failed to load book details');
    } finally {
      setLoading(false);
    }
  };

  const handleReserve = async () => {
    if (!user) {
      navigate('/patron-login', { state: { returnTo: `/catalog/${isbn}` } });
      return;
    }

    setReserving(true);
    setActionMessage(null);
    try {
      const res = await circulationApi.reserveBook({ isbn: book.isbn });
      if (res.success) {
        setActionMessage({
          type: 'success',
          text: `Reservation confirmed! You are placed at position #${res.reservation.queuePosition} in the waitlist.`
        });
        fetchBookData();
      }
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err.message || 'Unable to place reservation.'
      });
    } finally {
      setReserving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <p className="font-serif italic text-stone-500">Loading catalog record...</p>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="bg-white border border-stone-200 rounded p-6 text-center">
          <p className="text-red-700 font-medium mb-3">{error || 'Book not found'}</p>
          <Link to="/catalog" className="text-navy-800 underline text-sm">
            ← Back to Catalog
          </Link>
        </div>
      </div>
    );
  }

  const isAvailable = book.available_copies > 0;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Link to="/catalog" className="inline-flex items-center text-xs font-medium text-stone-600 hover:text-navy-900 mb-6">
        <ArrowLeft className="w-3.5 h-3.5 mr-1" />
        Back to Catalog Search
      </Link>

      {actionMessage && (
        <div className={`p-4 rounded border mb-6 text-sm ${actionMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'}`}>
          {actionMessage.text}
        </div>
      )}

      {/* Book Metadata Card */}
      <div className="bg-white border border-stone-200 rounded p-6 sm:p-8 mb-8 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between gap-6">
          <div className="flex-1">
            <span className="inline-block text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-stone-100 text-stone-700 border border-stone-200 mb-3">
              {book.category}
            </span>
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-navy-900 leading-tight mb-2">
              {book.title}
            </h1>
            <p className="text-base text-stone-700 font-medium mb-4">
              By {book.author}
            </p>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs border-t border-stone-100 pt-4 text-stone-600">
              <div>
                <dt className="text-stone-400">ISBN</dt>
                <dd className="font-mono text-stone-800 font-semibold">{book.isbn}</dd>
              </div>
              <div>
                <dt className="text-stone-400">Publisher</dt>
                <dd className="text-stone-800">{book.publisher}</dd>
              </div>
              <div>
                <dt className="text-stone-400">Edition</dt>
                <dd className="text-stone-800">{book.edition}</dd>
              </div>
              <div>
                <dt className="text-stone-400">Publication Year</dt>
                <dd className="text-stone-800 font-mono">{book.publication_year || 'N/A'}</dd>
              </div>
            </dl>
          </div>

          {/* Availability Box */}
          <div className="w-full md:w-64 bg-stone-50 border border-stone-200 rounded p-5 flex flex-col justify-between">
            <div>
              <span className="text-[11px] uppercase tracking-wider text-stone-500 font-bold block mb-1">
                Availability Status
              </span>
              <div className="flex items-center space-x-2 mb-2">
                {isAvailable ? (
                  <>
                    <CheckCircle className="w-5 h-5 text-emerald-700" />
                    <span className="text-base font-bold text-emerald-900">Available</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-5 h-5 text-amber-700" />
                    <span className="text-base font-bold text-amber-900">All Copies Issued</span>
                  </>
                )}
              </div>

              <p className="text-xs text-stone-600 mb-2">
                <strong className="text-stone-900">{book.available_copies}</strong> copies currently available out of <strong className="text-stone-900">{book.total_copies}</strong> total copies.
              </p>

              {!isAvailable && book.earliest_expected_return && (
                <div className="text-[11px] bg-amber-100/70 border border-amber-300/80 rounded p-2 text-amber-950 mb-3">
                  <strong>Expected return:</strong> {book.earliest_expected_return}
                </div>
              )}
            </div>

            {/* Action buttons */}
            {isStaffUser && !isAvailable ? (
              <div className="mt-4 text-[11px] text-stone-600 text-center bg-white border border-stone-200 rounded py-2 px-2">
                Reservations are placed by patrons online, or by staff for a member from the Circulation Desk.
              </div>
            ) : !isAvailable ? (
              <button
                onClick={handleReserve}
                disabled={reserving}
                className="w-full mt-4 px-4 py-2 bg-navy-800 hover:bg-navy-900 text-white text-xs font-semibold rounded shadow-sm transition disabled:opacity-50 flex items-center justify-center space-x-1"
              >
                <Bookmark className="w-3.5 h-3.5 mr-1" />
                {reserving ? 'Reserving...' : 'Place Reservation (Queue)'}
              </button>
            ) : (
              <div className="mt-4 text-[11px] text-stone-500 text-center bg-white border border-stone-200 rounded py-2">
                Available at Circulation Desk with physical ID
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Individual Copies Table (FR-Catalog.Add-04, FR-Search.Detail-01) */}
      <div className="bg-white border border-stone-200 rounded overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50/50 flex items-center justify-between">
          <h2 className="font-serif font-bold text-navy-900 text-base">
            Individual Physical Copies
          </h2>
          <span className="text-xs text-stone-500">
            Total Copies: {copies.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-700">
            <thead className="bg-stone-50 border-b border-stone-200 uppercase font-semibold tracking-wider text-[11px] text-stone-500">
              <tr>
                <th className="px-6 py-3">Accession Number</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Current Due Date</th>
                {isStaffUser && (
                  <th className="px-6 py-3">Borrower</th>
                )}
                {isStaffUser && (
                  <th className="px-6 py-3 text-right">Copy condition</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {copies.map((c) => {
                let badgeClass = 'bg-stone-100 text-stone-700';
                if (c.copy_status === 'Available') badgeClass = 'bg-emerald-50 text-emerald-800 border-emerald-200';
                if (c.copy_status === 'Issued') badgeClass = 'bg-amber-50 text-amber-800 border-amber-200';
                if (c.copy_status === 'Lost' || c.copy_status === 'Damaged') badgeClass = 'bg-red-50 text-red-800 border-red-200';
                if (c.copy_status === 'Reserved_Hold') badgeClass = 'bg-purple-50 text-purple-800 border-purple-200';

                return (
                  <tr key={c.accession_number} className="hover:bg-stone-50/50">
                    <td className="px-6 py-3 font-mono font-medium text-stone-900">
                      {c.accession_number}
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wider ${badgeClass}`}>
                        {c.copy_status}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-mono text-stone-600">
                      {c.due_date || '—'}
                    </td>
                    {isStaffUser && (
                      <td className="px-6 py-3 text-stone-600">
                        {c.borrower_name ? `${c.borrower_name} (${c.membership_id})` : '—'}
                      </td>
                    )}
                    {isStaffUser && (
                      <td className="px-6 py-3 text-right whitespace-nowrap space-x-1">
                        {c.copy_status === 'Issued' ? (
                          <span className="text-[11px] text-stone-400">On loan: use Return</span>
                        ) : c.copy_status === 'Lost' || c.copy_status === 'Damaged' ? (
                          <button type="button" disabled={copyBusy === c.accession_number} onClick={() => changeCopyStatus(c, 'Available')} className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded text-emerald-900 font-medium disabled:opacity-50">Restore</button>
                        ) : (
                          <>
                            <button type="button" disabled={copyBusy === c.accession_number} onClick={() => changeCopyStatus(c, 'Lost')} className="px-2 py-1 bg-stone-100 hover:bg-stone-200 border border-stone-300 rounded text-stone-800 font-medium disabled:opacity-50">Mark lost</button>
                            <button type="button" disabled={copyBusy === c.accession_number} onClick={() => changeCopyStatus(c, 'Damaged')} className="px-2 py-1 bg-stone-100 hover:bg-stone-200 border border-stone-300 rounded text-stone-800 font-medium disabled:opacity-50">Mark damaged</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
