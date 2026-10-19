import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { membersApi, circulationApi } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { User, BookOpen, AlertCircle, DollarSign, Calendar, Clock, Bookmark, Receipt, CheckCircle, Shield } from 'lucide-react';

export default function PatronProfile() {
  const { membershipId } = useParams();
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Payment Modal (Staff/Admin or Patron viewing)
  const [payModalFine, setPayModalFine] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  const [payError, setPayError] = useState('');

  // Admin Fine Waiver Modal
  const [waiveModalFine, setWaiveModalFine] = useState(null);
  const [waiveAmount, setWaiveAmount] = useState('');
  const [waiveRemark, setWaiveRemark] = useState('');
  const [waiveError, setWaiveError] = useState('');

  const fetchProfile = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await membersApi.getMemberDetails(membershipId);
      if (res.success) {
        setData(res);
      }
    } catch (err) {
      setError(err.message || 'Failed to retrieve patron record');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [membershipId]);

  const handlePayFineSubmit = async (e) => {
    e.preventDefault();
    setPayError('');
    try {
      const res = await circulationApi.payFine({
        fineId: payModalFine.fine_id,
        amount: parseFloat(paymentAmount)
      });
      if (res.success) {
        setPaymentReceipt(res.receipt);
        fetchProfile();
      }
    } catch (err) {
      setPayError(err.message || 'Payment recording failed');
    }
  };

  const handleWaiveFineSubmit = async (e) => {
    e.preventDefault();
    setWaiveError('');
    try {
      const res = await circulationApi.waiveFine({
        fineId: waiveModalFine.fine_id,
        waiveAmount: parseFloat(waiveAmount),
        remark: waiveRemark
      });
      if (res.success) {
        setWaiveModalFine(null);
        fetchProfile();
      }
    } catch (err) {
      setWaiveError(err.message || 'Fine waiver failed');
    }
  };

  const handleCancelReservation = async (reservationId) => {
    if (!window.confirm('Cancel this book reservation?')) return;
    try {
      await circulationApi.cancelReservation(reservationId);
      fetchProfile();
    } catch (err) {
      setError(err.message || 'Could not cancel reservation.');
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 text-center">
        <p className="font-serif italic text-stone-500">Loading patron profile & circulation records...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="bg-white border border-stone-200 rounded p-6 text-center">
          <AlertCircle className="w-8 h-8 text-red-600 mx-auto mb-2" />
          <p className="text-red-700 font-medium mb-3">{error || 'Member not found'}</p>
          <Link to="/catalog" className="text-navy-800 underline text-sm">
            ← Return to Library Catalog
          </Link>
        </div>
      </div>
    );
  }

  const { member, currentLoans, loanHistory, fines, payments, outstandingFineBalance, reservations } = data;
  const isStaff = user && (user.role === 'Librarian' || user.role === 'Administrator');
  const isAdmin = user && user.role === 'Administrator';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Profile Overview Card */}
      <div className="bg-white border border-stone-200 rounded p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start space-x-4">
            <div className="w-14 h-14 rounded bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-700">
              <User className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl sm:text-2xl font-serif font-bold text-navy-900">
                  {member.name}
                </h1>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                  member.account_status === 'Active' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-stone-100 text-stone-600 border border-stone-300'
                }`}>
                  {member.account_status}
                </span>
              </div>
              <p className="text-xs text-stone-600 font-mono mt-0.5">
                Membership ID: <strong className="text-stone-900">{member.membership_id}</strong> | Institutional ID: {member.institutional_id}
              </p>
              <p className="text-xs text-stone-500 mt-1">
                {member.member_type} • {member.department} • {member.email} • {member.phone}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-4 border-t md:border-t-0 md:border-l border-stone-100 pt-4 md:pt-0 md:pl-6 text-xs">
            <div>
              <div className="text-stone-400 uppercase text-[10px] font-bold">Issued Quota</div>
              <div className="font-mono text-base font-bold text-stone-900">
                {currentLoans.length} / {member.borrowing_limit}
              </div>
            </div>
            <div className="border-l border-stone-200 pl-4">
              <div className="text-stone-400 uppercase text-[10px] font-bold">Outstanding Fine</div>
              <div className={`font-mono text-base font-bold ${outstandingFineBalance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                Rs. {outstandingFineBalance.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 1. Current Active Loans */}
      <div className="bg-white border border-stone-200 rounded shadow-sm">
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50/50 flex items-center justify-between">
          <h2 className="font-serif font-bold text-navy-900 text-base flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-navy-800" />
            <span>Currently Issued Books ({currentLoans.length})</span>
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-700">
            <thead className="bg-stone-50 border-b border-stone-200 uppercase font-semibold tracking-wider text-[11px] text-stone-500">
              <tr>
                <th className="px-6 py-3">Accession No</th>
                <th className="px-6 py-3">Book Title</th>
                <th className="px-6 py-3">Issue Date</th>
                <th className="px-6 py-3">Due Date</th>
                <th className="px-6 py-3">Overdue Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {currentLoans.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-6 py-6 text-center text-stone-500 italic">
                    No books currently issued to this member.
                  </td>
                </tr>
              ) : (
                currentLoans.map((l) => {
                  const today = new Date().toISOString().split('T')[0];
                  const isOverdue = l.due_date < today;
                  return (
                    <tr key={l.loan_id} className="hover:bg-stone-50/50">
                      <td className="px-6 py-3 font-mono font-medium text-stone-900">{l.accession_number}</td>
                      <td className="px-6 py-3 font-semibold text-stone-900">{l.title}</td>
                      <td className="px-6 py-3 font-mono text-stone-600">{l.issue_date}</td>
                      <td className="px-6 py-3 font-mono text-stone-800 font-semibold">{l.due_date}</td>
                      <td className="px-6 py-3">
                        {isOverdue ? (
                          <span className="inline-block px-2 py-0.5 rounded bg-red-100 text-red-900 border border-red-200 text-[10px] font-bold">
                            OVERDUE
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-semibold">
                            WITHIN PERIOD
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Reservations Queue */}
      <div className="bg-white border border-stone-200 rounded shadow-sm">
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50/50 flex items-center justify-between">
          <h2 className="font-serif font-bold text-navy-900 text-base flex items-center space-x-2">
            <Bookmark className="w-4 h-4 text-purple-700" />
            <span>Active Reservations & Queue Position ({reservations.length})</span>
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-700">
            <thead className="bg-stone-50 border-b border-stone-200 uppercase font-semibold tracking-wider text-[11px] text-stone-500">
              <tr>
                <th className="px-6 py-3">Book Title</th>
                <th className="px-6 py-3">ISBN</th>
                <th className="px-6 py-3">Queue Position</th>
                <th className="px-6 py-3">Date Reserved</th>
                <th className="px-6 py-3">Hold Status</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {reservations.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-6 text-center text-stone-500 italic">
                    No active book reservations.
                  </td>
                </tr>
              ) : (
                reservations.map((r) => (
                  <tr key={r.reservation_id} className="hover:bg-stone-50/50">
                    <td className="px-6 py-3 font-semibold text-stone-900">{r.title}</td>
                    <td className="px-6 py-3 font-mono text-stone-600">{r.isbn}</td>
                    <td className="px-6 py-3 font-mono font-bold text-stone-900">{r.held_accession_number ? 'Held' : `#${r.live_queue_position ?? r.queue_position}`}</td>
                    <td className="px-6 py-3 font-mono text-stone-600">{r.reservation_date?.split('T')[0]}</td>
                    <td className="px-6 py-3">
                      {r.held_accession_number ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-purple-100 text-purple-900 border border-purple-300 text-[10px] font-bold">
                          READY FOR PICKUP (Held: {r.held_accession_number})
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-[10px]">
                          WAITING IN QUEUE
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={() => handleCancelReservation(r.reservation_id)}
                        className="text-red-700 hover:text-red-900 text-xs font-semibold"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Fines and Dues */}
      <div className="bg-white border border-stone-200 rounded shadow-sm">
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50/50 flex items-center justify-between">
          <h2 className="font-serif font-bold text-navy-900 text-base flex items-center space-x-2">
            <DollarSign className="w-4 h-4 text-stone-800" />
            <span>Fines & Financial Ledger (FR-Fine.View-01)</span>
          </h2>
          <span className="text-xs font-semibold text-stone-600">
            Total Outstanding: <span className="font-mono text-red-700 font-bold">Rs. {outstandingFineBalance.toFixed(2)}</span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-700">
            <thead className="bg-stone-50 border-b border-stone-200 uppercase font-semibold tracking-wider text-[11px] text-stone-500">
              <tr>
                <th className="px-6 py-3">Fine ID</th>
                <th className="px-6 py-3">Book Title</th>
                <th className="px-6 py-3">Charged</th>
                <th className="px-6 py-3">Paid</th>
                <th className="px-6 py-3">Waived</th>
                <th className="px-6 py-3">Outstanding</th>
                <th className="px-6 py-3">Date Charged</th>
                {isStaff && <th className="px-6 py-3 text-right">Desk Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {fines.length === 0 ? (
                <tr>
                  <td colSpan={isStaff ? 8 : 7} className="px-6 py-6 text-center text-stone-500 italic">
                    No fines assessed for this member. Account clear!
                  </td>
                </tr>
              ) : (
                fines.map((f) => {
                  const outAmt = Math.max(0, parseFloat(f.amount_charged) - parseFloat(f.amount_paid) - parseFloat(f.waived_amount));
                  return (
                    <tr key={f.fine_id} className="hover:bg-stone-50/50">
                      <td className="px-6 py-3 font-mono font-medium text-stone-900">#{f.fine_id}</td>
                      <td className="px-6 py-3 font-medium text-stone-900">{f.book_title}</td>
                      <td className="px-6 py-3 font-mono text-stone-800">Rs. {parseFloat(f.amount_charged).toFixed(2)}</td>
                      <td className="px-6 py-3 font-mono text-emerald-700">Rs. {parseFloat(f.amount_paid).toFixed(2)}</td>
                      <td className="px-6 py-3 font-mono text-stone-500">
                        {parseFloat(f.waived_amount) > 0 ? `Rs. ${parseFloat(f.waived_amount).toFixed(2)}` : '—'}
                      </td>
                      <td className="px-6 py-3 font-mono font-bold text-red-700">
                        {outAmt > 0 ? `Rs. ${outAmt.toFixed(2)}` : 'Rs. 0.00'}
                      </td>
                      <td className="px-6 py-3 font-mono text-stone-500">{f.date_charged?.split(' ')[0]}</td>
                      {isStaff && (
                        <td className="px-6 py-3 text-right space-x-2">
                          {outAmt > 0 && (
                            <>
                              <button
                                onClick={() => { setPayModalFine(f); setPaymentAmount(outAmt.toString()); setPaymentReceipt(null); }}
                                className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 border border-stone-300 rounded font-medium text-stone-800"
                              >
                                Collect
                              </button>
                              {isAdmin && (
                                <button
                                  onClick={() => { setWaiveModalFine(f); setWaiveAmount(outAmt.toString()); setWaiveRemark(''); setWaiveError(''); }}
                                  className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded font-medium text-amber-900"
                                >
                                  Waive
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* FINE PAYMENT MODAL (Staff/Librarian) */}
      {payModalFine && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded max-w-md w-full p-6 shadow-xl">
            <h3 className="font-serif font-bold text-base text-navy-900 mb-2">
              Record Fine Payment
            </h3>

            {paymentReceipt ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded p-4 text-xs text-emerald-900 space-y-2 mb-4">
                <CheckCircle className="w-5 h-5 text-emerald-600 mb-1" />
                <strong className="block text-sm">Payment Receipt Generated:</strong>
                <div>• Receipt Number: <span className="font-mono font-bold">{paymentReceipt.receiptNumber}</span></div>
                <div>• Amount Paid: <span className="font-mono font-bold">Rs. {paymentReceipt.amountPaid.toFixed(2)}</span></div>
                <div>• Remaining Fine Balance: <span className="font-mono font-bold">Rs. {paymentReceipt.remainingBalance.toFixed(2)}</span></div>
                <button
                  onClick={() => setPayModalFine(null)}
                  className="mt-3 w-full py-1.5 bg-emerald-700 text-white font-semibold rounded"
                >
                  Close Receipt
                </button>
              </div>
            ) : (
              <form onSubmit={handlePayFineSubmit} className="space-y-3 text-xs">
                {payError && <div className="p-2.5 rounded bg-red-50 text-red-800 border border-red-200">{payError}</div>}
                <div>
                  <label className="block text-stone-600 font-semibold uppercase tracking-wider mb-1">
                    Amount to Pay (INR)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    required
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 rounded font-mono text-sm"
                  />
                </div>
                <div className="flex justify-end space-x-2 pt-3 border-t border-stone-100">
                  <button
                    type="button"
                    onClick={() => setPayModalFine(null)}
                    className="px-3 py-1.5 border border-stone-300 rounded text-stone-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-navy-800 text-white rounded font-semibold"
                  >
                    Record Payment
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* FINE WAIVER MODAL (Admin Only - BR-8) */}
      {waiveModalFine && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded max-w-md w-full p-6 shadow-xl">
            <h3 className="font-serif font-bold text-base text-navy-900 mb-1 flex items-center space-x-2">
              <Shield className="w-4 h-4 text-amber-700" />
              <span>Waive Fine (Administrator Authority)</span>
            </h3>
            <p className="text-xs text-stone-500 mb-3">
              Per BR-8, every fine waiver requires a mandatory remark for audit compliance.
            </p>

            {waiveError && <div className="p-2.5 rounded bg-red-50 text-red-800 border border-red-200 text-xs mb-3">{waiveError}</div>}

            <form onSubmit={handleWaiveFineSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 mb-1">Amount to Waive (INR)</label>
                <input
                  type="number"
                  step="0.5"
                  required
                  value={waiveAmount}
                  onChange={(e) => setWaiveAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 rounded font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 mb-1">Mandatory Audit Remark *</label>
                <textarea
                  required
                  rows="3"
                  placeholder="e.g. Medical emergency on submission due date documented by college health center."
                  value={waiveRemark}
                  onChange={(e) => setWaiveRemark(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 rounded"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setWaiveModalFine(null)}
                  className="px-3 py-1.5 border border-stone-300 rounded text-stone-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-amber-800 text-white rounded font-semibold"
                >
                  Apply Waiver
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
