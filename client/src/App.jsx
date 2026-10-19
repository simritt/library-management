import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import CatalogSearch from './pages/CatalogSearch';
import BookDetails from './pages/BookDetails';
import CirculationDesk from './pages/CirculationDesk';
import MemberRegistration from './pages/MemberRegistration';
import PatronProfile from './pages/PatronProfile';
import CatalogManagement from './pages/CatalogManagement';
import AdminReports from './pages/AdminReports';
import StaffLogin from './pages/StaffLogin';
import PatronLogin from './pages/PatronLogin';
import Help from './pages/Help';
import BookRequests from './pages/BookRequests';
import LedgerDesk from './pages/LedgerDesk';
import PatronDashboard from './pages/PatronDashboard';
import ReservationDesk from './pages/ReservationDesk';
import StaffDashboard from './pages/StaffDashboard';

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading"><div className="loading-mark">L</div><p>Opening the library…</p></div>;
  if (user?.role === 'Patron') return <Navigate to="/account" replace />;
  if (user?.role === 'Librarian' || user?.role === 'Administrator') return <Navigate to="/dashboard" replace />;
  return <Navigate to="/catalog" replace />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="app-frame">
          <Navbar />
          <main className="app-main">
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route path="/catalog" element={<CatalogSearch />} />
              <Route path="/catalog/:isbn" element={<BookDetails />} />
              <Route path="/login" element={<StaffLogin />} />
              <Route path="/patron-login" element={<PatronLogin />} />
              <Route path="/help" element={<Help />} />

              <Route path="/account" element={<ProtectedRoute allowedRoles={['Patron']}><PatronDashboard /></ProtectedRoute>} />
              <Route path="/patron/:membershipId" element={<ProtectedRoute allowedRoles={['Patron', 'Librarian', 'Administrator']}><PatronProfile /></ProtectedRoute>} />
              <Route path="/requests" element={<ProtectedRoute allowedRoles={['Patron', 'Librarian', 'Administrator']}><BookRequests /></ProtectedRoute>} />

              <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['Librarian', 'Administrator']}><StaffDashboard /></ProtectedRoute>} />
              <Route path="/circulation" element={<ProtectedRoute allowedRoles={['Librarian', 'Administrator']}><CirculationDesk /></ProtectedRoute>} />
              <Route path="/members" element={<ProtectedRoute allowedRoles={['Librarian', 'Administrator']}><MemberRegistration /></ProtectedRoute>} />
              <Route path="/catalog-management" element={<ProtectedRoute allowedRoles={['Librarian', 'Administrator']}><CatalogManagement /></ProtectedRoute>} />
              <Route path="/ledgers" element={<ProtectedRoute allowedRoles={['Librarian', 'Administrator']}><LedgerDesk /></ProtectedRoute>} />
              <Route path="/reservations" element={<ProtectedRoute allowedRoles={['Librarian', 'Administrator']}><ReservationDesk /></ProtectedRoute>} />
              <Route path="/admin/reports" element={<ProtectedRoute allowedRoles={['Administrator']}><AdminReports /></ProtectedRoute>} />
              <Route path="*" element={<RootRedirect />} />
            </Routes>
          </main>
          <footer className="site-footer"><div className="footer-inner"><div><strong>SPIT Library</strong><span>Online Library Management System · Release 1.0</span></div><div className="footer-right"><span>Department of Computer Engineering</span><span>Designed for accurate, auditable circulation</span></div></div></footer>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
