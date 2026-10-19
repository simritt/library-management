import React, { useState, useEffect } from 'react';
import { reportsApi } from '../utils/api';
import { BarChart3, Download, Settings, Clock, BookOpen, DollarSign, CheckCircle } from 'lucide-react';

export default function AdminReports() {
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory', 'overdue', 'circulation', 'fines', 'settings'

  // Reports data
  const [inventoryData, setInventoryData] = useState(null);
  const [overdueData, setOverdueData] = useState(null);
  const [circulationData, setCirculationData] = useState(null);
  const [finesData, setFinesData] = useState(null);
  const [settingsData, setSettingsData] = useState({});
  const [loading, setLoading] = useState(false);
  const [saveSettingsSuccess, setSaveSettingsSuccess] = useState(false);
  const [error, setError] = useState('');
  const [range, setRange] = useState({ startDate: '', endDate: '' });

  // Only send the dates the Administrator actually filled in; the server defaults the rest.
  const rangeParams = () => Object.fromEntries(Object.entries(range).filter(([, value]) => value));

  useEffect(() => {
    fetchActiveTabReport();
  }, [activeTab]);

  const fetchActiveTabReport = async () => {
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'inventory') {
        const res = await reportsApi.getInventoryReport();
        if (res.success) setInventoryData(res);
      } else if (activeTab === 'overdue') {
        const res = await reportsApi.getOverdueReport();
        if (res.success) setOverdueData(res);
      } else if (activeTab === 'circulation') {
        const res = await reportsApi.getCirculationReport(rangeParams());
        if (res.success) setCirculationData(res);
      } else if (activeTab === 'fines') {
        const res = await reportsApi.getFinesReport(rangeParams());
        if (res.success) setFinesData(res);
      } else if (activeTab === 'settings') {
        const res = await reportsApi.getSettings();
        if (res.success) setSettingsData(res.settings);
      }
    } catch (err) {
      setError(err.message || 'Could not load this report.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSettings = async (e) => {
    e.preventDefault();
    setSaveSettingsSuccess(false);
    setError('');
    try {
      const res = await reportsApi.updateSettings(settingsData);
      if (res.success) {
        setSaveSettingsSuccess(true);
        setTimeout(() => setSaveSettingsSuccess(false), 3000);
      }
    } catch (err) {
      setError(err.message || 'Settings could not be saved.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="border-b border-stone-200 pb-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-navy-900 tracking-tight">
            Institutional Reports & Policy Settings
          </h1>
          <p className="text-xs sm:text-sm text-stone-600 mt-1">
            Section 4.8 administrative analytics covering inventory status, overdue tracking, circulation throughput, and fine rates.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="inline-flex rounded border border-stone-300 bg-stone-100 p-0.5 self-start sm:self-auto flex-wrap">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-3 py-1.5 text-xs font-semibold rounded transition ${
              activeTab === 'inventory' ? 'bg-white text-navy-900 shadow-sm' : 'text-stone-600 hover:text-navy-900'
            }`}
          >
            Inventory
          </button>
          <button
            onClick={() => setActiveTab('overdue')}
            className={`px-3 py-1.5 text-xs font-semibold rounded transition ${
              activeTab === 'overdue' ? 'bg-white text-navy-900 shadow-sm' : 'text-stone-600 hover:text-navy-900'
            }`}
          >
            Overdue Loans
          </button>
          <button
            onClick={() => setActiveTab('circulation')}
            className={`px-3 py-1.5 text-xs font-semibold rounded transition ${
              activeTab === 'circulation' ? 'bg-white text-navy-900 shadow-sm' : 'text-stone-600 hover:text-navy-900'
            }`}
          >
            Circulation
          </button>
          <button
            onClick={() => setActiveTab('fines')}
            className={`px-3 py-1.5 text-xs font-semibold rounded transition ${
              activeTab === 'fines' ? 'bg-white text-navy-900 shadow-sm' : 'text-stone-600 hover:text-navy-900'
            }`}
          >
            Fines Collection
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-3 py-1.5 text-xs font-semibold rounded transition ${
              activeTab === 'settings' ? 'bg-white text-navy-900 shadow-sm' : 'text-stone-600 hover:text-navy-900'
            }`}
          >
            Policy Rules
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-900 text-xs" role="alert">{error}</div>}

      {(activeTab === 'circulation' || activeTab === 'fines') && (
        <form
          onSubmit={(e) => { e.preventDefault(); fetchActiveTabReport(); }}
          className="mb-4 bg-white border border-stone-200 rounded p-4 shadow-sm flex flex-wrap items-end gap-3 text-xs"
        >
          <div>
            <label htmlFor="range-start" className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">From</label>
            <input id="range-start" type="date" value={range.startDate} onChange={(e) => setRange({ ...range, startDate: e.target.value })} className="px-3 py-1.5 border border-stone-300 rounded font-mono" />
          </div>
          <div>
            <label htmlFor="range-end" className="block font-semibold text-stone-700 uppercase tracking-wider mb-1">To</label>
            <input id="range-end" type="date" value={range.endDate} onChange={(e) => setRange({ ...range, endDate: e.target.value })} className="px-3 py-1.5 border border-stone-300 rounded font-mono" />
          </div>
          <button type="submit" className="px-4 py-1.5 bg-navy-800 hover:bg-navy-900 text-white rounded font-semibold">Apply range</button>
          <button type="button" onClick={() => { setRange({ startDate: '', endDate: '' }); setTimeout(fetchActiveTabReport, 0); }} className="px-3 py-1.5 border border-stone-300 rounded text-stone-700 hover:bg-stone-50">Clear</button>
          <span className="text-stone-500 ml-auto">Leave blank for all dates up to today.</span>
        </form>
      )}

      {loading ? (
        <div className="bg-white border border-stone-200 rounded p-12 text-center">
          <p className="font-serif italic text-stone-500 text-sm">Synthesizing institutional metrics...</p>
        </div>
      ) : (
        <>
          {/* 1. INVENTORY REPORT */}
          {activeTab === 'inventory' && inventoryData && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border border-stone-200 rounded p-5 shadow-sm">
                  <div className="text-xs uppercase text-stone-500 font-bold tracking-wider">Catalog Titles</div>
                  <div className="font-serif text-3xl font-bold text-navy-900 mt-1">{inventoryData.summary?.totalTitles}</div>
                </div>
                <div className="bg-white border border-stone-200 rounded p-5 shadow-sm">
                  <div className="text-xs uppercase text-stone-500 font-bold tracking-wider">Physical Volumes</div>
                  <div className="font-serif text-3xl font-bold text-navy-900 mt-1">{inventoryData.summary?.totalPhysicalCopies}</div>
                </div>
                <div className="bg-white border border-stone-200 rounded p-5 shadow-sm">
                  <div className="text-xs uppercase text-stone-500 font-bold tracking-wider">Currently Available</div>
                  <div className="font-serif text-3xl font-bold text-emerald-800 mt-1">{inventoryData.summary?.totalAvailableCopies}</div>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white border border-stone-200 rounded overflow-hidden shadow-sm">
                <div className="p-4 border-b border-stone-200 flex justify-between items-center bg-stone-50/50">
                  <h3 className="font-serif font-bold text-navy-900 text-sm">Per-Title Inventory Breakdown</h3>
                  <a
                    href="/api/reports/export/inventory"
                    download
                    className="inline-flex items-center text-xs font-medium text-stone-700 bg-white border border-stone-300 px-3 py-1.5 rounded hover:bg-stone-50 transition"
                  >
                    <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
                  </a>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-stone-700">
                    <thead className="bg-stone-50 border-b border-stone-200 uppercase font-semibold text-[11px] text-stone-500">
                      <tr>
                        <th className="px-5 py-3">ISBN</th>
                        <th className="px-5 py-3">Book Title</th>
                        <th className="px-5 py-3">Category</th>
                        <th className="px-5 py-3">Total Copies</th>
                        <th className="px-5 py-3">Available</th>
                        <th className="px-5 py-3">On Loan</th>
                        <th className="px-5 py-3">Lost / Damaged</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {inventoryData.inventory.map((r) => (
                        <tr key={r.isbn} className="hover:bg-stone-50/50">
                          <td className="px-5 py-3 font-mono font-medium text-stone-900">{r.isbn}</td>
                          <td className="px-5 py-3 font-semibold text-stone-900">{r.title}</td>
                          <td className="px-5 py-3">{r.category}</td>
                          <td className="px-5 py-3 font-mono font-bold text-stone-900">{r.total_copies}</td>
                          <td className="px-5 py-3 font-mono text-emerald-800 font-semibold">{r.available_copies}</td>
                          <td className="px-5 py-3 font-mono text-amber-800">{r.issued_or_unavailable_copies}</td>
                          <td className="px-5 py-3 font-mono text-red-700">
                            {r.lost_copies + r.damaged_copies > 0 ? `${r.lost_copies} lost / ${r.damaged_copies} dam` : '0'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 2. OVERDUE REPORT */}
          {activeTab === 'overdue' && overdueData && (
            <div className="space-y-6">
              <div className="bg-white border border-stone-200 rounded overflow-hidden shadow-sm">
                <div className="p-4 border-b border-stone-200 flex justify-between items-center bg-stone-50/50">
                  <div>
                    <h3 className="font-serif font-bold text-navy-900 text-sm">Current Overdue Loans ({overdueData.count})</h3>
                    <p className="text-xs text-stone-500">Books whose loan duration has lapsed beyond the due date.</p>
                  </div>
                  <a
                    href="/api/reports/export/overdue"
                    download
                    className="inline-flex items-center text-xs font-medium text-stone-700 bg-white border border-stone-300 px-3 py-1.5 rounded hover:bg-stone-50 transition"
                  >
                    <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
                  </a>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-stone-700">
                    <thead className="bg-stone-50 border-b border-stone-200 uppercase font-semibold text-[11px] text-stone-500">
                      <tr>
                        <th className="px-5 py-3">Accession No</th>
                        <th className="px-5 py-3">Book Title</th>
                        <th className="px-5 py-3">Borrowing Member</th>
                        <th className="px-5 py-3">Due Date</th>
                        <th className="px-5 py-3">Days Overdue</th>
                        <th className="px-5 py-3">Accruing Fine</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {overdueData.overdueLoans.length === 0 ? (
                        <tr>
                          <td colSpan="6" className="px-5 py-8 text-center text-stone-500 italic">
                            No overdue loans recorded across the institution.
                          </td>
                        </tr>
                      ) : (
                        overdueData.overdueLoans.map((o) => (
                          <tr key={o.loan_id} className="hover:bg-stone-50/50">
                            <td className="px-5 py-3 font-mono font-medium text-stone-900">{o.accession_number}</td>
                            <td className="px-5 py-3 font-semibold text-stone-900">{o.book_title}</td>
                            <td className="px-5 py-3">
                              <div className="font-medium text-stone-900">{o.member_name}</div>
                              <div className="text-[11px] text-stone-500 font-mono">{o.membership_id} ({o.email})</div>
                            </td>
                            <td className="px-5 py-3 font-mono text-stone-600">{o.due_date}</td>
                            <td className="px-5 py-3 font-mono font-bold text-red-700">{o.days_overdue} days</td>
                            <td className="px-5 py-3 font-mono font-bold text-stone-900">Rs. {parseFloat(o.estimated_fine).toFixed(2)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 3. CIRCULATION REPORT */}
          {activeTab === 'circulation' && circulationData && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white border border-stone-200 rounded p-5 shadow-sm">
                  <div className="text-xs uppercase text-stone-500 font-bold tracking-wider">Total Issues Recorded</div>
                  <div className="font-serif text-3xl font-bold text-navy-900 mt-1">{circulationData.totalIssues}</div>
                </div>
                <div className="bg-white border border-stone-200 rounded p-5 shadow-sm">
                  <div className="text-xs uppercase text-stone-500 font-bold tracking-wider">Total Returns Processed</div>
                  <div className="font-serif text-3xl font-bold text-emerald-800 mt-1">{circulationData.totalReturns}</div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-stone-600">
                <span>Period: <span className="font-mono">{circulationData.dateRange?.start}</span> to <span className="font-mono">{circulationData.dateRange?.end}</span></span>
                <a href={reportsApi.exportUrl('circulation', rangeParams())} download className="inline-flex items-center font-medium text-stone-700 bg-white border border-stone-300 px-3 py-1.5 rounded hover:bg-stone-50 transition">
                  <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
                </a>
              </div>

              <div className="bg-white border border-stone-200 rounded overflow-hidden shadow-sm">
                <div className="p-4 border-b border-stone-200 bg-stone-50/50">
                  <h3 className="font-serif font-bold text-navy-900 text-sm">Recent Daily Circulation Activity</h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-stone-700">
                    <thead className="bg-stone-50 border-b border-stone-200 uppercase font-semibold text-[11px] text-stone-500">
                      <tr>
                        <th className="px-5 py-3">Date</th>
                        <th className="px-5 py-3">Book Issues</th>
                        <th className="px-5 py-3">Book Returns</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {circulationData.dailyBreakdown.length === 0 && (
                        <tr><td colSpan="3" className="px-5 py-6 text-center text-stone-500 italic">No circulation activity in this period.</td></tr>
                      )}
                      {circulationData.dailyBreakdown.map((d) => (
                        <tr key={d.activity_date} className="hover:bg-stone-50/50">
                          <td className="px-5 py-3 font-mono text-stone-900">{d.activity_date}</td>
                          <td className="px-5 py-3 font-mono font-bold text-navy-900">{d.issues_count}</td>
                          <td className="px-5 py-3 font-mono font-bold text-emerald-800">{d.returns_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 4. FINES REPORT */}
          {activeTab === 'fines' && finesData && (
            <div className="space-y-6">
              <div className="flex justify-end">
                <a href={reportsApi.exportUrl('fines', rangeParams())} download className="inline-flex items-center text-xs font-medium text-stone-700 bg-white border border-stone-300 px-3 py-2 rounded hover:bg-stone-50 transition">
                  <Download className="w-3.5 h-3.5 mr-1" /> Export fine ledger CSV
                </a>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white border border-stone-200 rounded p-5 shadow-sm">
                  <div className="text-xs uppercase text-stone-500 font-bold tracking-wider">Total Assessed</div>
                  <div className="font-serif text-2xl font-bold text-navy-900 mt-1">Rs. {finesData.totalCharged.toFixed(2)}</div>
                </div>
                <div className="bg-white border border-stone-200 rounded p-5 shadow-sm">
                  <div className="text-xs uppercase text-stone-500 font-bold tracking-wider">Total Collected</div>
                  <div className="font-serif text-2xl font-bold text-emerald-800 mt-1">Rs. {finesData.totalCollected.toFixed(2)}</div>
                </div>
                <div className="bg-white border border-stone-200 rounded p-5 shadow-sm">
                  <div className="text-xs uppercase text-stone-500 font-bold tracking-wider">Total Waived</div>
                  <div className="font-serif text-2xl font-bold text-stone-600 mt-1">Rs. {finesData.totalWaived.toFixed(2)}</div>
                </div>
                <div className="bg-white border border-stone-200 rounded p-5 shadow-sm">
                  <div className="text-xs uppercase text-stone-500 font-bold tracking-wider">Net Outstanding</div>
                  <div className="font-serif text-2xl font-bold text-red-700 mt-1">Rs. {finesData.outstanding.toFixed(2)}</div>
                </div>
              </div>
              <div className="bg-white border border-stone-200 rounded overflow-hidden shadow-sm">
                <div className="p-4 border-b border-stone-200 bg-stone-50/50">
                  <h3 className="font-serif font-bold text-navy-900 text-sm">Fines assessed in this period</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-stone-700">
                    <thead className="bg-stone-50 border-b border-stone-200 uppercase font-semibold text-[11px] text-stone-500">
                      <tr><th className="px-5 py-3">Fine</th><th className="px-5 py-3">Member</th><th className="px-5 py-3">Book</th><th className="px-5 py-3">Charged</th><th className="px-5 py-3">Collected</th><th className="px-5 py-3">Waived</th><th className="px-5 py-3">Date</th></tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {finesData.recentFines.length === 0 ? (
                        <tr><td colSpan="7" className="px-5 py-6 text-center text-stone-500 italic">No fines were assessed in this period.</td></tr>
                      ) : finesData.recentFines.map((f) => (
                        <tr key={f.fine_id}>
                          <td className="px-5 py-3 font-mono">#{f.fine_id}</td>
                          <td className="px-5 py-3">{f.member_name}<div className="text-[11px] text-stone-500 font-mono">{f.membership_id}</div></td>
                          <td className="px-5 py-3">{f.book_title}</td>
                          <td className="px-5 py-3 font-mono">Rs. {Number(f.amount_charged).toFixed(2)}</td>
                          <td className="px-5 py-3 font-mono text-emerald-800">Rs. {Number(f.amount_paid).toFixed(2)}</td>
                          <td className="px-5 py-3 font-mono">Rs. {Number(f.waived_amount).toFixed(2)}</td>
                          <td className="px-5 py-3 font-mono text-stone-600">{String(f.date_charged).slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 5. POLICY SETTINGS (SE-5, BR-1, BR-2, BR-4, BR-5, BR-6, BR-7) */}
          {activeTab === 'settings' && (
            <div className="max-w-2xl bg-white border border-stone-200 rounded p-6 shadow-sm">
              <h2 className="font-serif font-bold text-lg text-navy-900 mb-1">
                Library Circulation & Fine Policies
              </h2>
              <p className="text-xs text-stone-500 mb-6">
                Institution-wide parameters dynamically enforced at circulation desks.
              </p>

              {saveSettingsSuccess && (
                <div className="mb-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  <span>Circulation parameters saved and activated successfully!</span>
                </div>
              )}

              <form onSubmit={handleUpdateSettings} className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Overdue Fine Rate per Day (INR) (BR-5)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={settingsData.fine_rate_per_day || ''}
                    onChange={(e) => setSettingsData({ ...settingsData, fine_rate_per_day: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded font-mono"
                  />
                  <span className="text-[11px] text-stone-500 mt-0.5 block">Standard institutional default: Rs. 2.00 / day.</span>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Maximum Fine Cap per Loan (INR) (BR-6)
                  </label>
                  <input
                    type="number"
                    step="5"
                    min="10"
                    value={settingsData.max_fine_per_loan || ''}
                    onChange={(e) => setSettingsData({ ...settingsData, max_fine_per_loan: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded font-mono"
                  />
                  <span className="text-[11px] text-stone-500 mt-0.5 block">Default cap: Rs. 200.00.</span>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">
                    Borrowing Lockout Threshold (INR) (BR-4)
                  </label>
                  <input
                    type="number"
                    step="5"
                    min="0"
                    value={settingsData.fine_block_threshold || ''}
                    onChange={(e) => setSettingsData({ ...settingsData, fine_block_threshold: e.target.value })}
                    className="w-full px-3 py-2 border border-stone-300 rounded font-mono"
                  />
                  <span className="text-[11px] text-stone-500 mt-0.5 block">Borrowing is blocked while outstanding dues exceed this amount.</span>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Student Loan Duration (Days) (BR-2)</label>
                    <input
                      type="number"
                      min="1"
                      value={settingsData.student_loan_days || ''}
                      onChange={(e) => setSettingsData({ ...settingsData, student_loan_days: e.target.value })}
                      className="w-full px-3 py-2 border border-stone-300 rounded font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Faculty Loan Duration (Days) (BR-2)</label>
                    <input
                      type="number"
                      min="1"
                      value={settingsData.faculty_loan_days || ''}
                      onChange={(e) => setSettingsData({ ...settingsData, faculty_loan_days: e.target.value })}
                      className="w-full px-3 py-2 border border-stone-300 rounded font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-2">
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Student Borrowing Limit (BR-1)</label>
                    <input type="number" min="1" max="50" value={settingsData.student_borrow_limit || ''} onChange={(e) => setSettingsData({ ...settingsData, student_borrow_limit: e.target.value })} className="w-full px-3 py-2 border border-stone-300 rounded font-mono" />
                  </div>
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Faculty Borrowing Limit (BR-1)</label>
                    <input type="number" min="1" max="50" value={settingsData.faculty_borrow_limit || ''} onChange={(e) => setSettingsData({ ...settingsData, faculty_borrow_limit: e.target.value })} className="w-full px-3 py-2 border border-stone-300 rounded font-mono" />
                  </div>
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Reservation Hold (hours) (BR-7)</label>
                    <input type="number" min="1" max="720" value={settingsData.reservation_hold_hours || ''} onChange={(e) => setSettingsData({ ...settingsData, reservation_hold_hours: e.target.value })} className="w-full px-3 py-2 border border-stone-300 rounded font-mono" />
                  </div>
                </div>
                <p className="text-[11px] text-stone-500">Default borrowing limits apply to members registered after the change; use Edit on a member to override an individual limit.</p>

                <div className="pt-4 border-t border-stone-100 flex justify-end">
                  <button
                    type="submit"
                    className="px-5 py-2 bg-navy-800 hover:bg-navy-900 text-white rounded font-semibold transition shadow-sm"
                  >
                    Save Policy Rules
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
