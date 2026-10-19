const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

/**
 * Auth Controller
 * Handles Staff (Librarian/Admin) login/logout with SE-8 (15 minute lockout after 5 consecutive failed attempts)
 * Also handles Patron login for My Account portal
 */

// Staff Login
exports.loginStaff = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    const [rows] = await pool.query(
      'SELECT id, username, password_hash, full_name, email, role, failed_attempts, locked_until FROM users WHERE username = ?',
      [username.trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    const user = rows[0];

    // Check account lock (SE-8: 15 minutes after 5 failed attempts)
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const waitMinutes = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(429).json({
        success: false,
        error: `Account is temporarily locked due to 5 consecutive failed attempts. Please try again in ${waitMinutes} minute(s).`
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      const newAttempts = user.failed_attempts + 1;
      let lockSql = 'UPDATE users SET failed_attempts = ?';
      const params = [newAttempts];

      if (newAttempts >= 5) {
        lockSql += ', locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE)';
      }
      lockSql += ' WHERE id = ?';
      params.push(user.id);
      await pool.query(lockSql, params);

      if (newAttempts >= 5) {
        return res.status(429).json({
          success: false,
          error: 'Maximum failed attempts reached. Account locked for 15 minutes.'
        });
      }

      return res.status(401).json({
        success: false,
        error: `Invalid username or password. (${5 - newAttempts} attempts remaining)`
      });
    }

    // Reset failed attempts on success
    await pool.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);

    // Set session
    req.session.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      userType: 'staff'
    };

    return res.json({
      success: true,
      message: 'Login successful',
      user: req.session.user
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error during login' });
  }
};

// Patron Login (Student / Faculty)
exports.loginPatron = async (req, res) => {
  try {
    const { membershipId, password } = req.body;
    if (!membershipId || !password) {
      return res.status(400).json({ success: false, error: 'Membership ID and password are required' });
    }

    const [memberRows] = await pool.query(
      `SELECT m.membership_id, m.name, m.institutional_id, m.department, m.email, m.phone, m.member_type, m.account_status, m.borrowing_limit,
              c.password_hash, c.failed_attempts, c.locked_until
       FROM members m
       LEFT JOIN member_credentials c ON m.membership_id = c.membership_id
       WHERE m.membership_id = ? OR m.institutional_id = ?`,
      [membershipId.trim(), membershipId.trim()]
    );

    if (memberRows.length === 0) {
      return res.status(401).json({ success: false, error: 'Member not found' });
    }

    const member = memberRows[0];

    // Check account lockout
    if (member.locked_until && new Date(member.locked_until) > new Date()) {
      const waitMinutes = Math.ceil((new Date(member.locked_until) - new Date()) / 60000);
      return res.status(429).json({
        success: false,
        error: `Account is locked due to repeated failed logins. Please try again in ${waitMinutes} minutes.`
      });
    }

    // If credentials haven't been created yet, allow institutional default password (e.g. institutional_id or Member@123)
    let isMatch = false;
    if (member.password_hash) {
      isMatch = await bcrypt.compare(password, member.password_hash);
    } else {
      isMatch = (password === 'Member@123' || password === member.institutional_id);
    }

    if (!isMatch) {
      if (member.password_hash) {
        const newAttempts = (member.failed_attempts || 0) + 1;
        let lockSql = 'UPDATE member_credentials SET failed_attempts = ?';
        const params = [newAttempts];
        if (newAttempts >= 5) {
          lockSql += ', locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE)';
        }
        lockSql += ' WHERE membership_id = ?';
        params.push(member.membership_id);
        await pool.query(lockSql, params);
      }
      return res.status(401).json({ success: false, error: 'Invalid membership ID or password' });
    }

    // Reset lockout
    if (member.password_hash) {
      await pool.query('UPDATE member_credentials SET failed_attempts = 0, locked_until = NULL WHERE membership_id = ?', [member.membership_id]);
    }

    req.session.user = {
      membershipId: member.membership_id,
      name: member.name,
      institutionalId: member.institutional_id,
      department: member.department,
      email: member.email,
      memberType: member.member_type,
      accountStatus: member.account_status,
      borrowingLimit: member.borrowing_limit,
      role: 'Patron',
      userType: 'patron'
    };

    return res.json({
      success: true,
      message: 'Patron login successful',
      user: req.session.user
    });
  } catch (error) {
    console.error('Patron login error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error during patron login' });
  }
};

// Check Current Session Status
exports.getCurrentUser = async (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ success: true, user: req.session.user });
  }
  return res.json({ success: true, user: null });
};

// Logout
exports.logout = (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Could not log out' });
    }
    res.clearCookie('olms_sid');
    return res.json({ success: true, message: 'Logged out successfully' });
  });
};
