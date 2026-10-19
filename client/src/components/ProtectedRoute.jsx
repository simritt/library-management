import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, allowedRoles = [] }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading"><div className="loading-mark">L</div><p>Checking your secure session…</p></div>;
  if (!user) {
    const patronOnly = allowedRoles.length === 1 && allowedRoles[0] === 'Patron';
    return <Navigate to={patronOnly ? '/patron-login' : '/login'} replace />;
  }
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    return <div className="permission-screen"><div className="permission-mark"><ShieldAlert size={24} /></div><div className="eyebrow">ACCESS CONTROL</div><h1>This area is restricted</h1><p>Your current role ({user.role}) does not have permission to access this module.</p><Link className="button button-primary" to={user.role === 'Patron' ? '/account' : '/dashboard'}>Return to your workspace</Link></div>;
  }
  return children;
}
