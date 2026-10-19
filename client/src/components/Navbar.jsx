import React, { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, BookMarked, LayoutDashboard, LogOut, Menu, Search, ShieldCheck, Users, X, BarChart3, Clock3, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isStaff = user?.role === 'Librarian' || user?.role === 'Administrator';
  const isAdmin = user?.role === 'Administrator';

  const handleLogout = async () => {
    try { await logout(); setMobileOpen(false); navigate('/catalog'); }
    catch (error) { console.error('Logout error:', error); }
  };
  const closeMenu = () => setMobileOpen(false);
  const linkClass = ({ isActive }) => `nav-link${isActive ? ' nav-link-active' : ''}`;

  const links = isStaff ? [
    { to: '/dashboard', label: 'Overview', Icon: LayoutDashboard },
    { to: '/circulation', label: 'Circulation', Icon: BookOpen },
    { to: '/members', label: 'Members', Icon: Users },
    { to: '/catalog-management', label: 'Books', Icon: BookMarked },
    { to: '/requests', label: 'Requests', Icon: FileSpreadsheet },
    { to: '/ledgers', label: 'Ledgers', Icon: BarChart3 },
    { to: '/reservations', label: 'Reservations', Icon: Clock3 },
    ...(isAdmin ? [{ to: '/admin/reports', label: 'Reports', Icon: BarChart3 }] : []),
  ] : user?.role === 'Patron' ? [
    { to: '/catalog', label: 'Catalogue', Icon: Search },
    { to: '/account', label: 'My account', Icon: LayoutDashboard },
    { to: '/requests', label: 'Book requests', Icon: BookMarked },
  ] : [
    { to: '/catalog', label: 'Catalogue', Icon: Search },
    { to: '/help', label: 'Library help', Icon: BookOpen },
  ];

  return <header className="site-header">
    <div className="topline"><span>SPIT · SARDAR PATEL INSTITUTE OF TECHNOLOGY</span><span>COLLECTION / CIRCULATION / ACCOUNTABILITY</span></div>
    <div className="nav-main">
      <Link to="/" className="brand-lockup" onClick={closeMenu}>
        <span className="brand-symbol"><BookOpen size={22} strokeWidth={1.8} /></span>
        <span className="brand-copy"><strong>SPIT <em>Library</em></strong><small>Online library management</small></span>
      </Link>
      <nav className="desktop-nav" aria-label="Main navigation">
        {links.map(({ to, label }) => <NavLink key={to} to={to} className={linkClass}>{label}</NavLink>)}
      </nav>
      <div className="nav-account">
        {user ? <>
          <div className="nav-user"><span className="user-presence" /><span><strong>{user.fullName || user.name}</strong><small>{user.role}</small></span></div>
          <button type="button" className="nav-logout" onClick={handleLogout} title="Sign out"><LogOut size={15} /><span>Sign out</span></button>
        </> : <>
          <Link to="/patron-login" className="nav-login nav-login-quiet">Patron sign in</Link>
          <Link to="/login" className="nav-login nav-login-primary"><ShieldCheck size={14} /> Staff portal</Link>
        </>}
        <button className="mobile-menu-toggle" type="button" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} onClick={() => setMobileOpen((open) => !open)}>{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button>
      </div>
    </div>
    {mobileOpen && <div className="mobile-menu"><div className="mobile-menu-links">{links.map(({ to, label, Icon }) => <NavLink key={to} to={to} className={linkClass} onClick={closeMenu}><Icon size={16} />{label}</NavLink>)}<NavLink to="/help" className={linkClass} onClick={closeMenu}>Help & policy</NavLink></div>{user ? <button className="button button-light button-wide" onClick={handleLogout} type="button"><LogOut size={15} /> Sign out</button> : <div className="mobile-auth-actions"><Link to="/patron-login" onClick={closeMenu}>Patron sign in</Link><Link to="/login" onClick={closeMenu}>Staff portal</Link></div>}</div>}
    <div className={`nav-context ${location.pathname === '/catalog' ? 'nav-context-catalog' : ''}`}><span>{isStaff ? (isAdmin ? 'LIBRARY ADMINISTRATION' : 'LIBRARY STAFF WORKSPACE') : user?.role === 'Patron' ? 'MEMBER SELF-SERVICE' : 'PUBLIC CATALOGUE'}</span><span className="nav-context-right">{location.pathname === '/catalog' ? 'SEARCH THE COLLECTION' : 'LIVE DATABASE RECORDS'}</span></div>
  </header>;
}
