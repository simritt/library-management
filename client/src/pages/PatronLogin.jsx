import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BookOpen, User, Lock, AlertCircle } from 'lucide-react';

export default function PatronLogin() {
  const [membershipId, setMembershipId] = useState('MEM-2026-0001');
  const [password, setPassword] = useState('Member@123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { loginPatron } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await loginPatron({ membershipId, password });
      navigate('/account');
    } catch (err) {
      setError(err.message || 'Invalid membership ID or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="bg-white border border-stone-200 rounded p-8 shadow-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-stone-100 text-stone-700 rounded flex items-center justify-center mx-auto mb-3 border border-stone-200">
            <BookOpen className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-navy-900 tracking-tight">
            Patron Account Login
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Student & Faculty Self-Service (Loans, Dues & Holds)
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
              Membership ID or Roll / Inst. ID
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
              <input
                type="text"
                required
                value={membershipId}
                onChange={(e) => setMembershipId(e.target.value)}
                placeholder="e.g. MEM-2026-0001 or 2024300274"
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
            {loading ? 'Logging In...' : 'Access My Account'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-stone-100 text-[11px] text-stone-500 bg-stone-50/70 p-3 rounded border border-stone-200">
          <div className="font-semibold text-stone-700 mb-1">Sample Member Accounts:</div>
          <div>• Student: <code className="font-mono text-stone-800">MEM-2026-0001</code> / <code className="font-mono text-stone-800">Member@123</code></div>
          <div>• Faculty: <code className="font-mono text-stone-800">MEM-2026-0003</code> / <code className="font-mono text-stone-800">Member@123</code></div>
        </div>
      </div>
    </div>
  );
}
