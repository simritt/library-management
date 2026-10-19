import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock, User, ShieldCheck, AlertCircle } from 'lucide-react';

export default function StaffLogin() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Admin@123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { loginStaff } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await loginStaff({ username, password });
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="bg-white border border-stone-200 rounded p-8 shadow-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-navy-800 text-white rounded flex items-center justify-center mx-auto mb-3 shadow-sm">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-navy-900 tracking-tight">
            Staff Portal Login
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Circulation Desk Librarians & Library Administrators
          </p>
        </div>

        {error && (
          <div className="mb-5 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-xs flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
              Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. admin or librarian"
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded focus:ring-1 focus:ring-navy-700 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded focus:ring-1 focus:ring-navy-700 focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-navy-800 hover:bg-navy-900 text-white font-medium text-sm rounded shadow-sm transition disabled:opacity-50 mt-2"
          >
            {loading ? 'Authenticating...' : 'Sign In to Circulation'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-stone-100 text-[11px] text-stone-500 bg-stone-50/70 p-3 rounded border border-stone-200">
          <div className="font-semibold text-stone-700 mb-1">Demo Credentials:</div>
          <div>• Administrator: <code className="font-mono text-stone-800">admin</code> / <code className="font-mono text-stone-800">Admin@123</code></div>
          <div>• Librarian: <code className="font-mono text-stone-800">librarian</code> / <code className="font-mono text-stone-800">Librarian@123</code></div>
        </div>
      </div>
    </div>
  );
}
