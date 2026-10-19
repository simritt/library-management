/**
 * Authentication and Role-based Access Control Middlewares
 * Enforces SE-1, SE-2, SE-4, SE-5, SE-6
 */

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please log in.'
    });
  }
  next();
}

function requireStaff(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.'
    });
  }
  const role = req.session.user.role;
  if (role !== 'Librarian' && role !== 'Administrator') {
    return res.status(403).json({
      success: false,
      error: 'Access denied: Librarian or Administrator privileges required.'
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.'
    });
  }
  if (req.session.user.role !== 'Administrator') {
    return res.status(403).json({
      success: false,
      error: 'Access denied: Administrator privileges required.'
    });
  }
  next();
}

module.exports = {
  requireAuth,
  requireStaff,
  requireAdmin
};
