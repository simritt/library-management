import React, { useState, useEffect } from 'react';
import { membersApi } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { Users, UserPlus, Search, AlertCircle, CheckCircle, ShieldAlert, Edit, Ban, Check } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function MemberRegistration() {
  const { user } = useAuth();
  const isAdmin = user && user.role === 'Administrator';

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');

  // Registration Modal / Form State
  const [showRegModal, setShowRegModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    institutionalId: '',
    department: 'Computer Engineering',
    email: '',
    phone: '',
    memberType: 'Student',
    customBorrowingLimit: '',
  });
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Deactivation warning / blocking modal
  const [deactModal, setDeactModal] = useState(null);
  const [deactError, setDeactError] = useState(null);

  // Edit member modal (FR-Member.Update-01; borrowing-limit override is Administrator only)
  const [editMember, setEditMember] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', department: '', email: '', phone: '', borrowingLimit: '' });
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const res = await membersApi.getMembers({
        q: searchTerm,
        status: statusFilter,
        memberType: typeFilter,
        page: 1,
        limit: 50
      });
      if (res.success) {
        setMembers(res.data);
      }
    } catch (err) {
      setError(err.message || 'Failed to load members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [searchTerm, statusFilter, typeFilter]);

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setRegError('');
    setRegSuccess(null);
    setSubmitting(true);

    try {
      const res = await membersApi.registerMember(formData);
      if (res.success) {
        setRegSuccess(`Member registered successfully! Generated Library Membership ID: ${res.membershipId}. Default web password: Member@123 (the member should keep it private).`);
        setFormData({
          name: '',
          institutionalId: '',
          department: 'Computer Engineering',
          email: '',
          phone: '',
          memberType: 'Student',
          customBorrowingLimit: '',
        });
        fetchMembers();
      }
    } catch (err) {
      setRegError(err.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (membershipId) => {
    setDeactError(null);
    try {
      const res = await membersApi.deactivateMember(membershipId);
      if (res.success) {
        setDeactModal(null);
        fetchMembers();
      }
    } catch (err) {
      setDeactError(err.data?.blockingReason || err.message);
    }
  };

  const handleReactivate = async (membershipId) => {
    setError('');
    try {
      await membersApi.reactivateMember(membershipId);
      setNotice(`Member ${membershipId} reactivated.`);
      fetchMembers();
    } catch (err) {
      setError(err.message);
    }
  };

  const openEdit = (m) => {
    setEditMember(m);
    setEditForm({ name: m.name, department: m.department, email: m.email, phone: m.phone, borrowingLimit: String(m.borrowing_limit) });
    setEditError('');
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditError('');
    setEditSaving(true);
    try {
      const payload = { name: editForm.name, department: editForm.department, email: editForm.email, phone: editForm.phone };
      if (isAdmin && editForm.borrowingLimit !== '') payload.borrowingLimit = Number(editForm.borrowingLimit);
      await membersApi.updateMember(editMember.membership_id, payload);
      setNotice(`Details for ${editMember.membership_id} updated.`);
      setEditMember(null);
      fetchMembers();
    } catch (err) {
      setEditError(err.message || 'Update failed');
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="border-b border-stone-200 pb-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-navy-900 tracking-tight">
            Member Management
          </h1>
          <p className="text-xs sm:text-sm text-stone-600 mt-1">
            Register students and faculty, maintain institutional credentials, and manage borrowing quotas.
          </p>
        </div>

        <button
          onClick={() => { setShowRegModal(true); setRegSuccess(null); setRegError(''); }}
          className="inline-flex items-center px-4 py-2 bg-navy-800 hover:bg-navy-900 text-white font-medium text-xs uppercase tracking-wider rounded shadow-sm transition self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4 mr-1.5" />
          Register New Member
        </button>
      </div>

      {error && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-900 text-xs" role="alert">{error}</div>}
      {notice && <div className="mb-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs" role="status">{notice}</div>}

      {/* Filter / Search Bar */}
      <div className="bg-white border border-stone-200 rounded p-4 mb-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by name, membership ID, or roll number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700 focus:outline-none"
          />
        </div>

        <div className="flex items-center space-x-3 w-full sm:w-auto">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="border border-stone-300 rounded px-2.5 py-1.5 text-xs bg-white text-stone-800"
          >
            <option value="All">All Types</option>
            <option value="Student">Students</option>
            <option value="Faculty">Faculty</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-stone-300 rounded px-2.5 py-1.5 text-xs bg-white text-stone-800"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Members Table */}
      <div className="bg-white border border-stone-200 rounded overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-700">
            <thead className="bg-stone-50 border-b border-stone-200 uppercase font-semibold tracking-wider text-[11px] text-stone-500">
              <tr>
                <th className="px-5 py-3">Membership ID</th>
                <th className="px-5 py-3">Member Name</th>
                <th className="px-5 py-3">Roll / Inst ID</th>
                <th className="px-5 py-3">Department</th>
                <th className="px-5 py-3">Type & Quota</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Active Loans</th>
                <th className="px-5 py-3">Fine Balance</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan="9" className="px-5 py-8 text-center text-stone-500 italic">
                    Loading member database...
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-5 py-8 text-center text-stone-500">
                    No members matching search query found.
                  </td>
                </tr>
              ) : (
                members.map((m) => {
                  const hasDues = parseFloat(m.outstanding_fines) > 0;
                  const isActive = m.account_status === 'Active';
                  return (
                    <tr key={m.membership_id} className="hover:bg-stone-50/50">
                      <td className="px-5 py-3 font-mono font-bold text-stone-900">
                        <Link to={`/patron/${m.membership_id}`} className="hover:underline text-navy-800">
                          {m.membership_id}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-semibold text-stone-900">{m.name}</div>
                        <div className="text-[11px] text-stone-500">{m.email}</div>
                      </td>
                      <td className="px-5 py-3 font-mono text-stone-700">
                        {m.institutional_id}
                      </td>
                      <td className="px-5 py-3 text-stone-600">
                        {m.department}
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-medium text-stone-800">{m.member_type}</span>
                        <span className="text-stone-400 block text-[10px]">Limit: {m.borrowing_limit} books</span>
                      </td>
                      <td className="px-5 py-3">
                        {isActive ? (
                          <span className="inline-block px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold">
                            ACTIVE
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200 text-[10px] font-bold">
                            INACTIVE
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 font-mono text-stone-800 font-semibold">
                        {m.active_loans_count} / {m.borrowing_limit}
                      </td>
                      <td className="px-5 py-3">
                        {hasDues ? (
                          <span className="font-mono text-red-700 font-bold">
                            Rs. {parseFloat(m.outstanding_fines).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-stone-400 font-mono">Rs. 0.00</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right space-x-1 whitespace-nowrap">
                        <Link
                          to={`/patron/${m.membership_id}`}
                          className="px-2 py-1 text-stone-700 hover:text-navy-900 bg-stone-100 hover:bg-stone-200 rounded border border-stone-300 font-medium inline-block"
                        >
                          View
                        </Link>
                        <button
                          type="button"
                          onClick={() => openEdit(m)}
                          className="px-2 py-1 text-stone-700 hover:text-navy-900 bg-stone-100 hover:bg-stone-200 rounded border border-stone-300 font-medium ml-1"
                        >
                          Edit
                        </button>

                        {/* Administrator only deactivation */}
                        {isAdmin && (
                          isActive ? (
                            <button
                              onClick={() => { setDeactModal(m); setDeactError(null); }}
                              className="px-2 py-1 text-red-700 hover:text-red-900 bg-red-50 hover:bg-red-100 rounded border border-red-200 font-medium ml-1"
                              title="Deactivate Member"
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              onClick={() => handleReactivate(m.membership_id)}
                              className="px-2 py-1 text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 font-medium ml-1"
                              title="Reactivate Member"
                            >
                              Reactivate
                            </button>
                          )
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

      {/* REGISTRATION MODAL */}
      {showRegModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded max-w-lg w-full p-6 shadow-xl">
            <h2 className="font-serif font-bold text-lg text-navy-900 mb-1">
              Register Library Member
            </h2>
            <p className="text-xs text-stone-500 mb-4">
              Enter official institutional details. System automatically verifies institutional ID uniqueness and assigns default borrowing limits (3 for Students, 8 for Faculty).
            </p>

            {regError && (
              <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-xs">
                {regError}
              </div>
            )}

            {regSuccess && (
              <div className="mb-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
                {regSuccess}
              </div>
            )}

            <form onSubmit={handleRegisterSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Parth Zala"
                  className="w-full px-3 py-2 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Institutional ID / Roll No *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.institutionalId}
                    onChange={(e) => setFormData({ ...formData, institutionalId: e.target.value })}
                    placeholder="e.g. 2024300274"
                    className="w-full px-3 py-2 border border-stone-300 rounded text-xs font-mono focus:ring-1 focus:ring-navy-700"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Member Type *
                  </label>
                  <select
                    value={formData.memberType}
                    onChange={(e) => setFormData({ ...formData, memberType: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded text-xs bg-white focus:ring-1 focus:ring-navy-700"
                  >
                    <option value="Student">Student (Limit: 3)</option>
                    <option value="Faculty">Faculty (Limit: 8)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                  Department *
                </label>
                <input
                  type="text"
                  required
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  placeholder="e.g. Computer Engineering"
                  className="w-full px-3 py-2 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Institutional Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="name@spit.ac.in"
                    className="w-full px-3 py-2 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="9820011223"
                    className="w-full px-3 py-2 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700"
                  />
                </div>
              </div>

              {isAdmin && (
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">
                    Administrator Override: Custom Borrowing Limit
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={formData.customBorrowingLimit}
                    onChange={(e) => setFormData({ ...formData, customBorrowingLimit: e.target.value })}
                    placeholder="Leave empty for default (3 student / 8 faculty)"
                    className="w-full px-3 py-2 border border-stone-300 rounded text-xs focus:ring-1 focus:ring-navy-700"
                  />
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setShowRegModal(false)}
                  className="px-3 py-2 border border-stone-300 rounded text-stone-700 hover:bg-stone-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-navy-800 hover:bg-navy-900 text-white rounded font-semibold disabled:opacity-50"
                >
                  {submitting ? 'Registering...' : 'Register Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MEMBER MODAL */}
      {editMember && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded max-w-lg w-full p-6 shadow-xl">
            <h2 className="font-serif font-bold text-lg text-navy-900 mb-1">Edit Member</h2>
            <p className="text-xs text-stone-500 mb-4 font-mono">{editMember.membership_id} · {editMember.institutional_id} (institutional ID cannot be changed)</p>
            {editError && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-xs">{editError}</div>}
            <form onSubmit={handleEditSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1" htmlFor="edit-name">Full Name</label>
                <input id="edit-name" required className="w-full px-3 py-2 border border-stone-300 rounded text-xs" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1" htmlFor="edit-dept">Department</label>
                <input id="edit-dept" required className="w-full px-3 py-2 border border-stone-300 rounded text-xs" value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1" htmlFor="edit-email">Email</label>
                  <input id="edit-email" type="email" required className="w-full px-3 py-2 border border-stone-300 rounded text-xs" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                </div>
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1" htmlFor="edit-phone">Phone</label>
                  <input id="edit-phone" type="tel" required className="w-full px-3 py-2 border border-stone-300 rounded text-xs" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                </div>
              </div>
              {isAdmin && (
                <div>
                  <label className="block font-semibold text-stone-700 uppercase tracking-wider mb-1" htmlFor="edit-limit">Borrowing limit (Administrator override)</label>
                  <input id="edit-limit" type="number" min="1" max="50" className="w-full px-3 py-2 border border-stone-300 rounded text-xs" value={editForm.borrowingLimit} onChange={(e) => setEditForm({ ...editForm, borrowingLimit: e.target.value })} />
                </div>
              )}
              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-stone-100">
                <button type="button" onClick={() => setEditMember(null)} className="px-3 py-2 border border-stone-300 rounded text-stone-700 hover:bg-stone-50 font-medium">Cancel</button>
                <button type="submit" disabled={editSaving} className="px-4 py-2 bg-navy-800 hover:bg-navy-900 text-white rounded font-semibold disabled:opacity-50">{editSaving ? 'Saving...' : 'Save changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DEACTIVATION CONFIRMATION / BLOCK MODAL */}
      {deactModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded max-w-md w-full p-6 shadow-xl">
            <h3 className="font-serif font-bold text-base text-navy-900 mb-2 flex items-center space-x-2">
              <ShieldAlert className="w-5 h-5 text-red-600" />
              <span>Deactivate Member: {deactModal.name}</span>
            </h3>

            {deactError ? (
              <div className="bg-red-50 border border-red-200 rounded p-4 mb-4 text-xs text-red-900 space-y-2">
                <strong className="block font-bold">Deactivation Blocked (FR-Member.Deactivate-02):</strong>
                <p>
                  Member account cannot be deactivated while outstanding obligations exist:
                </p>
                {deactError.activeLoansCount > 0 && (
                  <div>• Currently has <strong>{deactError.activeLoansCount}</strong> unreturned book loan(s).</div>
                )}
                {deactError.unpaidFineAmount > 0 && (
                  <div>• Outstanding unpaid fine amount: <strong>Rs. {deactError.unpaidFineAmount.toFixed(2)}</strong>.</div>
                )}
                <p className="text-[11px] text-stone-600 pt-1 border-t border-red-200">
                  Please return all physical copies and clear fines at the Circulation Desk prior to account deactivation.
                </p>
              </div>
            ) : (
              <p className="text-xs text-stone-600 mb-4">
                Are you sure you want to deactivate account <strong>{deactModal.membership_id}</strong>? The member will be barred from borrowing books until reactivated by an Administrator.
              </p>
            )}

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setDeactModal(null)}
                className="px-3 py-1.5 border border-stone-300 rounded text-xs text-stone-700 hover:bg-stone-50 font-medium"
              >
                {deactError ? 'Close' : 'Cancel'}
              </button>
              {!deactError && (
                <button
                  type="button"
                  onClick={() => handleDeactivate(deactModal.membership_id)}
                  className="px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white rounded text-xs font-semibold"
                >
                  Confirm Deactivation
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
