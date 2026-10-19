import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, BookCopy, BookOpen, BookPlus, CircleDollarSign, ClipboardList, Clock3, RefreshCw, UserRoundPlus, Users } from 'lucide-react';
import { catalogApi, circulationApi, membersApi, requestsApi } from '../utils/api';
import { useAuth } from '../context/AuthContext';

export default function StaffDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState({ books: [], members: [], loans: [], requests: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const results = await Promise.all([
        catalogApi.getBooks({ page: 1, limit: 50 }),
        membersApi.getMembers({ page: 1, limit: 50, status: 'All' }),
        circulationApi.getActiveLoans({}),
        requestsApi.getAll('Pending'),
      ]);
      setData({ books: results[0].data || [], members: results[1].data || [], loans: results[2].loans || [], requests: results[3].requests || [] });
    } catch (err) { setError(err.message || 'Could not load the library overview.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const totalCopies = data.books.reduce((total, book) => total + Number(book.total_copies || 0), 0);
  const availableCopies = data.books.reduce((total, book) => total + Number(book.available_copies || 0), 0);
  const overdueCount = data.loans.filter((loan) => Number(loan.days_overdue) > 0).length;
  const actions = [
    { to: '/circulation', icon: BookCopy, title: 'Circulation desk', desc: 'Issue, return and inspect active loans', label: 'Open desk' },
    { to: '/catalog-management', icon: BookPlus, title: 'Catalogue maintenance', desc: 'Add titles, copies and update copy condition', label: 'Manage books' },
    { to: '/members', icon: UserRoundPlus, title: 'Member register', desc: 'Register, edit, reactivate and review members', label: 'Manage members' },
    { to: '/requests', icon: ClipboardList, title: 'Patron book requests', desc: 'Review pending requests and issue approved titles', label: `${data.requests.length} pending` },
    { to: '/ledgers', icon: BarChart3, title: 'Circulation ledgers', desc: 'Full member and book-level borrowing history', label: 'Open ledgers' },
    { to: '/reservations', icon: Clock3, title: 'Reservation queue', desc: 'Track queue order and 48-hour book holds', label: 'View queue' },
  ];

  return <div className="page-shell">
    <section className="staff-hero"><div className="staff-hero-main"><div className="eyebrow eyebrow-light">SPIT · CENTRAL LIBRARY</div><h1>Library operations.</h1><p>One workspace for circulation, inventory, patron requests and complete audit trails.</p><div className="staff-hero-bottom"><span className="staff-avatar">{(user?.fullName || 'L').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{user?.fullName || 'Library staff'}</strong><small>{user?.role || 'Staff'} · Signed in</small></span><button className="button button-hero-ghost button-small" onClick={load} type="button"><RefreshCw size={14} /> Refresh overview</button></div></div><div className="staff-hero-aside"><div className="aside-rule" /><span>COLLECTION STATUS</span><strong>{totalCopies > 0 ? Math.round((availableCopies / totalCopies) * 100) : 0}%</strong><p>of all catalogued copies are available now</p><div className="collection-bar"><span style={{ width: `${totalCopies > 0 ? (availableCopies / totalCopies) * 100 : 0}%` }} /></div><small>{availableCopies} available · {totalCopies} total copies</small></div></section>
    {error && <div className="notice notice-error">{error}</div>}
    <div className="staff-stat-grid">
      <div className="staff-stat-card"><span className="stat-icon"><BookOpen size={17} /></span><div><small>Book titles</small><strong>{loading ? '—' : data.books.length}</strong><span>Distinct ISBN records</span></div></div>
      <div className="staff-stat-card"><span className="stat-icon"><BookCopy size={17} /></span><div><small>Active loans</small><strong>{loading ? '—' : data.loans.length}</strong><span>Physical copies currently issued</span></div></div>
      <div className="staff-stat-card"><span className="stat-icon"><Users size={17} /></span><div><small>Member records</small><strong>{loading ? '—' : data.members.length}</strong><span>Students and faculty</span></div></div>
      <div className="staff-stat-card"><span className="stat-icon stat-icon-warn"><Clock3 size={17} /></span><div><small>Overdue now</small><strong className={overdueCount ? 'bad-amount' : ''}>{loading ? '—' : overdueCount}</strong><span>Requires follow-up</span></div></div>
      <div className="staff-stat-card"><span className="stat-icon"><ClipboardList size={17} /></span><div><small>Pending requests</small><strong>{loading ? '—' : data.requests.length}</strong><span>Awaiting a staff decision</span></div></div>
    </div>
    <section className="staff-module-section"><div className="section-title-row"><div><div className="eyebrow">WORKSPACE</div><h2>Choose an operation</h2></div><span className="section-note">Changes are saved to MySQL</span></div><div className="staff-module-grid">{actions.map(({ to, icon: Icon, title, desc, label }) => <Link to={to} className="staff-module-card" key={to}><div className="module-card-top"><span className="module-icon"><Icon size={19} /></span><ArrowRight size={16} className="module-arrow" /></div><h3>{title}</h3><p>{desc}</p><span className="module-label">{label}</span></Link>)}</div></section>
    {user?.role === 'Administrator' && <section className="admin-callout"><div><CircleDollarSign size={18} /><div><strong>Administration & reporting</strong><p>Inspect fine collection, overdue circulation, inventory and configurable library policy.</p></div></div><Link to="/admin/reports" className="button button-primary button-small">Reports & settings <ArrowRight size={14} /></Link></section>}
  </div>;
}
