const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

/**
 * Members Controller
 * Implements Module 3: Manage Member Registration
 * Strictly complies with:
 * FR-Member.Register-01 to 04 (Student/Faculty limits: 3/8, BR-1)
 * FR-Member.Update-01
 * FR-Member.Deactivate-01, Deactivate-02 (Block deactivation if loans or unpaid fines exist)
 * FR-Member.View-01, View-02 (SE-6 Patron restricted view)
 */

// Search / List Members (Staff view: FR-Member.View-01)
exports.getMembers = async (req, res) => {
  try {
    const { q, status, memberType, page = 1, limit = 15 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const validLimit = Math.max(1, Math.min(50, parseInt(limit, 10)));
    const validOffset = Math.max(0, offset);

    let whereClauses = [];
    let params = [];

    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      whereClauses.push('(m.membership_id LIKE ? OR m.name LIKE ? OR m.institutional_id LIKE ? OR m.email LIKE ?)');
      params.push(term, term, term, term);
    }

    if (status && status !== 'All') {
      whereClauses.push('m.account_status = ?');
      params.push(status);
    }

    if (memberType && memberType !== 'All') {
      whereClauses.push('m.member_type = ?');
      params.push(memberType);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM members m ${whereSql}`,
      params
    );
    const total = countRows[0].total;

    // Fetch members with active loan counts and outstanding fine balances
    const [members] = await pool.query(
      `SELECT m.*,
        (SELECT COUNT(*) FROM loans l WHERE l.membership_id = m.membership_id AND l.loan_status = 'Issued') AS active_loans_count,
        COALESCE(
          (SELECT SUM(GREATEST(f.amount_charged - f.amount_paid - f.waived_amount, 0))
           FROM fines f
           WHERE f.membership_id = m.membership_id), 0.00
        ) AS outstanding_fines
       FROM members m
       ${whereSql}
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, validLimit, validOffset]
    );

    return res.json({
      success: true,
      data: members,
      pagination: {
        page: parseInt(page, 10),
        limit: validLimit,
        total,
        totalPages: Math.ceil(total / validLimit)
      }
    });
  } catch (error) {
    console.error('Error in getMembers:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve members' });
  }
};

// Register Member (FR-Member.Register-01 to 04)
exports.registerMember = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      name,
      institutionalId,
      department,
      email,
      phone,
      memberType,
      customBorrowingLimit,
      initialPassword
    } = req.body;

    // Validation
    if (!name || !institutionalId || !department || !email || !phone || !memberType) {
      return res.status(400).json({
        success: false,
        error: 'Name, Institutional ID, Department, Email, Phone, and Member Type are required.'
      });
    }

    if (!['Student', 'Faculty'].includes(memberType)) {
      return res.status(400).json({
        success: false,
        error: 'Member Type must be either Student or Faculty.'
      });
    }

    await connection.beginTransaction();

    // FR-Member.Register-02: Reject if institutional ID already exists
    const [existInst] = await connection.query(
      'SELECT membership_id FROM members WHERE institutional_id = ?',
      [institutionalId.trim()]
    );
    if (existInst.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        error: `Institutional ID '${institutionalId.trim()}' is already registered with membership ID '${existInst[0].membership_id}'.`
      });
    }

    // Check duplicate email
    const [existEmail] = await connection.query(
      'SELECT membership_id FROM members WHERE email = ?',
      [email.trim()]
    );
    if (existEmail.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        error: `Email '${email.trim()}' is already in use by member ${existEmail[0].membership_id}.`
      });
    }

    // FR-Member.Register-04: use the current admin-configured default, with SRS fallbacks.
    const limitKey = memberType === 'Faculty' ? 'faculty_borrow_limit' : 'student_borrow_limit';
    const fallbackLimit = memberType === 'Faculty' ? 8 : 3;
    const [limitRows] = await connection.query('SELECT setting_value FROM system_settings WHERE setting_key = ?', [limitKey]);
    let borrowingLimit = limitRows.length ? Number(limitRows[0].setting_value) : fallbackLimit;
    if (!Number.isInteger(borrowingLimit) || borrowingLimit < 1) borrowingLimit = fallbackLimit;
    if (customBorrowingLimit !== undefined && customBorrowingLimit !== null && customBorrowingLimit !== '') {
      if (req.session?.user?.role !== 'Administrator') {
        await connection.rollback();
        return res.status(403).json({ success: false, error: 'Only the Library Administrator can override the default borrowing limit.' });
      }
      const parsedLimit = Number(customBorrowingLimit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Custom borrowing limit must be a whole number between 1 and 50.' });
      }
      borrowingLimit = parsedLimit;
    }

    // FR-Member.Register-03: Generate unique Library Membership ID (MEM-YEAR-XXXX)
    const currentYear = new Date().getFullYear();
    const [countRows] = await connection.query(
      'SELECT COUNT(*) as count FROM members WHERE membership_id LIKE ?',
      [`MEM-${currentYear}-%`]
    );
    const seq = countRows[0].count + 1;
    const membershipId = `MEM-${currentYear}-${String(seq).padStart(4, '0')}`;

    // Insert member
    await connection.query(
      `INSERT INTO members (membership_id, name, institutional_id, department, email, phone, member_type, account_status, borrowing_limit)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)`,
      [
        membershipId,
        name.trim(),
        institutionalId.trim(),
        department.trim(),
        email.trim().toLowerCase(),
        phone.trim(),
        memberType,
        borrowingLimit
      ]
    );

    // Create web login password for patron (defaults to initialPassword or Member@123)
    const rawPass = initialPassword || 'Member@123';
    const passwordHash = await bcrypt.hash(rawPass, 10);
    await connection.query(
      'INSERT INTO member_credentials (membership_id, password_hash) VALUES (?, ?)',
      [membershipId, passwordHash]
    );

    // Audit log
    await connection.query(
      `INSERT INTO transaction_logs (action_type, performed_by, performed_by_name, membership_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'MEMBER_REGISTER',
        req.session?.user?.id || null,
        req.session?.user?.fullName || 'Staff',
        membershipId,
        `Registered member ${name.trim()} (${memberType}) with Institutional ID ${institutionalId.trim()}`
      ]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Member registered successfully',
      membershipId,
      borrowingLimit,
      accountStatus: 'Active'
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error registering member:', error);
    return res.status(500).json({ success: false, error: 'Database error registering member' });
  } finally {
    connection.release();
  }
};

// Update Member Contact Details & Department (FR-Member.Update-01)
exports.updateMember = async (req, res) => {
  try {
    const { membershipId } = req.params;
    const { name, department, email, phone, borrowingLimit, accountStatus } = req.body;
    if (accountStatus !== undefined) {
      return res.status(400).json({ success: false, error: 'Use the dedicated administrator deactivate/reactivate action to change account status.' });
    }
    if (borrowingLimit !== undefined && req.session?.user?.role !== 'Administrator') {
      return res.status(403).json({ success: false, error: 'Only the Library Administrator can override a member borrowing limit.' });
    }
    let parsedLimit = null;
    if (borrowingLimit !== undefined && borrowingLimit !== null && borrowingLimit !== '') {
      parsedLimit = Number(borrowingLimit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        return res.status(400).json({ success: false, error: 'Borrowing limit must be a whole number between 1 and 50.' });
      }
    }
    const [existing] = await pool.query('SELECT membership_id FROM members WHERE membership_id = ?', [membershipId]);
    if (existing.length === 0) return res.status(404).json({ success: false, error: 'Member not found' });

    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    if (cleanEmail) {
      const [duplicates] = await pool.query('SELECT membership_id FROM members WHERE email = ? AND membership_id <> ? LIMIT 1', [cleanEmail, membershipId]);
      if (duplicates.length) return res.status(409).json({ success: false, error: 'That email address is already registered to another member.' });
    }
    await pool.query(
      `UPDATE members
       SET name = COALESCE(?, name), department = COALESCE(?, department),
           email = COALESCE(?, email), phone = COALESCE(?, phone),
           borrowing_limit = COALESCE(?, borrowing_limit)
       WHERE membership_id = ?`,
      [name ? String(name).trim() : null, department ? String(department).trim() : null,
        cleanEmail, phone ? String(phone).trim() : null, parsedLimit, membershipId]
    );
    return res.json({ success: true, message: 'Member details updated successfully' });
  } catch (error) {
    console.error('Error updating member:', error);
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, error: 'The email address is already in use.' });
    return res.status(500).json({ success: false, error: 'Failed to update member' });
  }
};

// Deactivate Member (FR-Member.Deactivate-01, Deactivate-02)
exports.deactivateMember = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { membershipId } = req.params;

    await connection.beginTransaction();

    const [members] = await connection.query(
      'SELECT membership_id, name, account_status FROM members WHERE membership_id = ? FOR UPDATE',
      [membershipId]
    );
    if (members.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Member not found' });
    }

    // FR-Member.Deactivate-01 & 02: Check active loans
    const [loans] = await connection.query(
      `SELECT l.loan_id, l.accession_number, b.title, l.due_date 
       FROM loans l 
       JOIN book_titles b ON l.isbn = b.isbn 
       WHERE l.membership_id = ? AND l.loan_status = 'Issued'`,
      [membershipId]
    );

    // Check unpaid fines
    const [fines] = await connection.query(
      `SELECT COALESCE(SUM(GREATEST(amount_charged - amount_paid - waived_amount, 0)), 0.00) as unpaid_total 
       FROM fines 
       WHERE membership_id = ?`,
      [membershipId]
    );
    const unpaidFineAmount = parseFloat(fines[0].unpaid_total);

    // If either active loans or unpaid fines exist, BLOCK deactivation
    if (loans.length > 0 || unpaidFineAmount > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'Cannot deactivate member with outstanding obligations.',
        blockingReason: {
          activeLoansCount: loans.length,
          activeLoans: loans,
          unpaidFineAmount: unpaidFineAmount
        }
      });
    }

    // Deactivate member
    await connection.query(
      "UPDATE members SET account_status = 'Inactive' WHERE membership_id = ?",
      [membershipId]
    );

    // Log action
    await connection.query(
      `INSERT INTO transaction_logs (action_type, performed_by, performed_by_name, membership_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'MEMBER_DEACTIVATE',
        req.session?.user?.id || null,
        req.session?.user?.fullName || 'Administrator',
        membershipId,
        `Account status deactivated for member ${members[0].name}`
      ]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: `Member ${membershipId} deactivated successfully.`
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error deactivating member:', error);
    return res.status(500).json({ success: false, error: 'Failed to deactivate member' });
  } finally {
    connection.release();
  }
};

// Reactivate Member (BR-3)
exports.reactivateMember = async (req, res) => {
  try {
    const { membershipId } = req.params;
    const [result] = await pool.query(
      "UPDATE members SET account_status = 'Active' WHERE membership_id = ?",
      [membershipId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }

    return res.json({
      success: true,
      message: `Member ${membershipId} reactivated successfully.`
    });
  } catch (error) {
    console.error('Error reactivating member:', error);
    return res.status(500).json({ success: false, error: 'Failed to reactivate member' });
  }
};

// Member Details with Active Loans, Fine Balance, and History (FR-Member.View-01, View-02, SE-6)
exports.getMemberDetails = async (req, res) => {
  try {
    const { membershipId } = req.params;

    // SE-6 enforcement: If logged-in user is a Patron, they can ONLY view their own profile
    if (req.session?.user?.role === 'Patron' && req.session.user.membershipId !== membershipId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: You may only view your own patron account information (SE-6).'
      });
    }

    const [memberRows] = await pool.query(
      'SELECT * FROM members WHERE membership_id = ?',
      [membershipId]
    );
    if (memberRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }
    const member = memberRows[0];

    // Current Active Loans
    const [currentLoans] = await pool.query(
      `SELECT l.*, b.title, b.author, b.category
       FROM loans l
       JOIN book_titles b ON l.isbn = b.isbn
       WHERE l.membership_id = ? AND l.loan_status = 'Issued'
       ORDER BY l.due_date ASC`,
      [membershipId]
    );

    // Completed Loan History
    const [loanHistory] = await pool.query(
      `SELECT l.*, b.title, b.author
       FROM loans l
       JOIN book_titles b ON l.isbn = b.isbn
       WHERE l.membership_id = ? AND l.loan_status != 'Issued'
       ORDER BY l.return_date DESC
       LIMIT 20`,
      [membershipId]
    );

    // Fines and Payments
    const [fines] = await pool.query(
      `SELECT f.*, b.title as book_title, l.issue_date, l.due_date, l.return_date
       FROM fines f
       JOIN loans l ON f.loan_id = l.loan_id
       JOIN book_titles b ON l.isbn = b.isbn
       WHERE f.membership_id = ?
       ORDER BY f.date_charged DESC`,
      [membershipId]
    );

    const [payments] = await pool.query(
      `SELECT p.*, f.loan_id
       FROM fine_payments p
       JOIN fines f ON p.fine_id = f.fine_id
       WHERE p.membership_id = ?
       ORDER BY p.payment_date DESC`,
      [membershipId]
    );

    // Outstanding Fine Total
    let totalFinesCharged = 0;
    let totalFinesPaid = 0;
    let totalFinesWaived = 0;
    fines.forEach(f => {
      totalFinesCharged += parseFloat(f.amount_charged);
      totalFinesPaid += parseFloat(f.amount_paid);
      totalFinesWaived += parseFloat(f.waived_amount);
    });
    const outstandingFineBalance = Math.max(0, totalFinesCharged - totalFinesPaid - totalFinesWaived);

    // Active Reservations & Queue Positions
    const [reservations] = await pool.query(
      `SELECT r.*, b.title, b.author,
              CASE WHEN r.status = 'Active' AND r.held_accession_number IS NULL THEN
              (SELECT COUNT(*) + 1 FROM reservations earlier WHERE earlier.isbn = r.isbn AND earlier.status = 'Active'
               AND earlier.held_accession_number IS NULL AND (earlier.reservation_date < r.reservation_date OR (earlier.reservation_date = r.reservation_date AND earlier.reservation_id < r.reservation_id)))
              ELSE NULL END AS live_queue_position
       FROM reservations r
       JOIN book_titles b ON r.isbn = b.isbn
       WHERE r.membership_id = ? AND r.status = 'Active'
       ORDER BY r.reservation_date ASC`,
      [membershipId]
    );

    return res.json({
      success: true,
      member,
      currentLoans,
      loanHistory,
      fines,
      payments,
      outstandingFineBalance: parseFloat(outstandingFineBalance.toFixed(2)),
      reservations
    });
  } catch (error) {
    console.error('Error fetching member details:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve member details' });
  }
};
