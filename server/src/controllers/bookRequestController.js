const { pool } = require('../config/db');
const { cleanISBN, validateISBN } = require('../utils/isbnValidator');

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

async function getLoanPolicy(memberType) {
  const key = memberType === 'Faculty' ? 'faculty_loan_days' : 'student_loan_days';
  const fallback = memberType === 'Faculty' ? 30 : 14;
  const [rows] = await pool.query('SELECT setting_value FROM system_settings WHERE setting_key = ?', [key]);
  return rows.length ? toNumber(rows[0].setting_value, fallback) : fallback;
}

exports.getPolicy = async (req, res) => {
  try {
    const user = req.session.user;
    if (user.userType !== 'patron' || !user.membershipId) {
      return res.status(403).json({ success: false, error: 'Only signed-in patrons can submit personal book requests.' });
    }
    const [memberRows] = await pool.query(
      'SELECT member_type, account_status FROM members WHERE membership_id = ?',
      [user.membershipId]
    );
    if (!memberRows.length) return res.status(404).json({ success: false, error: 'Member account not found.' });
    const member = memberRows[0];
    const maxDays = await getLoanPolicy(member.member_type);
    return res.json({ success: true, memberType: member.member_type, accountStatus: member.account_status, maxDays });
  } catch (error) {
    console.error('Request policy error:', error);
    return res.status(500).json({ success: false, error: 'Unable to load borrowing policy.' });
  }
};

exports.createRequest = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const user = req.session.user;
    if (user.userType !== 'patron' || !user.membershipId) {
      return res.status(403).json({ success: false, error: 'Book requests can only be submitted by a signed-in patron.' });
    }

    const title = String(req.body.title || '').trim();
    const rawIsbn = String(req.body.isbn || '').trim();
    const note = String(req.body.note || '').trim();
    const requestedDays = Number(req.body.requestedDays);
    if (!title || title.length > 255) {
      return res.status(400).json({ success: false, error: 'Book title is required and must be at most 255 characters.' });
    }
    const isbnResult = validateISBN(rawIsbn);
    if (!isbnResult.valid) return res.status(400).json({ success: false, error: isbnResult.error });
    if (!Number.isInteger(requestedDays) || requestedDays < 1) {
      return res.status(400).json({ success: false, error: 'Requested duration must be a whole number of at least 1 day.' });
    }
    if (note.length > 500) return res.status(400).json({ success: false, error: 'Note must be 500 characters or fewer.' });

    await connection.beginTransaction();
    const [members] = await connection.query(
      'SELECT membership_id, member_type, account_status FROM members WHERE membership_id = ? FOR UPDATE',
      [user.membershipId]
    );
    if (!members.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Member account not found.' });
    }
    const member = members[0];
    if (member.account_status !== 'Active') {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Your library account is inactive. Contact the library desk to reactivate it.' });
    }

    const settingKey = member.member_type === 'Faculty' ? 'faculty_loan_days' : 'student_loan_days';
    const fallback = member.member_type === 'Faculty' ? 30 : 14;
    const [settings] = await connection.query('SELECT setting_value FROM system_settings WHERE setting_key = ?', [settingKey]);
    const maxDays = settings.length ? toNumber(settings[0].setting_value, fallback) : fallback;
    if (requestedDays > maxDays) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        maxDays,
        error: `Your ${member.member_type.toLowerCase()} loan policy allows a maximum of ${maxDays} days. Choose ${maxDays} days or fewer.`
      });
    }

    const isbn = cleanISBN(isbnResult.cleaned);
    const [existing] = await connection.query(
      `SELECT request_id FROM book_requests
       WHERE membership_id = ? AND requested_isbn = ? AND request_status IN ('Pending', 'Approved')
       LIMIT 1 FOR UPDATE`,
      [member.membership_id, isbn]
    );
    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({ success: false, error: 'You already have a pending or approved request for this ISBN.' });
    }

    const [inserted] = await connection.query(
      `INSERT INTO book_requests (membership_id, requested_title, requested_isbn, requested_days, request_note)
       VALUES (?, ?, ?, ?, ?)`,
      [member.membership_id, title, isbn, requestedDays, note || null]
    );
    await connection.commit();
    return res.status(201).json({
      success: true,
      message: 'Book request submitted for library review.',
      request: { requestId: inserted.insertId, title, isbn, requestedDays, status: 'Pending' }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Create book request error:', error);
    return res.status(500).json({ success: false, error: 'Unable to submit book request.' });
  } finally {
    connection.release();
  }
};

exports.getMyRequests = async (req, res) => {
  try {
    const user = req.session.user;
    if (user.userType !== 'patron' || !user.membershipId) {
      return res.status(403).json({ success: false, error: 'Only patrons can view personal book requests.' });
    }
    const [rows] = await pool.query(
      `SELECT r.*, u.full_name AS reviewed_by_name,
              CASE WHEN b.isbn IS NULL THEN 0 ELSE 1 END AS catalog_exists,
              b.available_copies, b.total_copies
       FROM book_requests r
       LEFT JOIN users u ON u.id = r.reviewed_by
       LEFT JOIN book_titles b ON b.isbn = r.requested_isbn
       WHERE r.membership_id = ?
       ORDER BY r.created_at DESC, r.request_id DESC`,
      [user.membershipId]
    );
    return res.json({ success: true, requests: rows });
  } catch (error) {
    console.error('Get my book requests error:', error);
    return res.status(500).json({ success: false, error: 'Unable to retrieve your book requests.' });
  }
};

exports.getAllRequests = async (req, res) => {
  try {
    const status = String(req.query.status || 'All');
    const allowed = ['All', 'Pending', 'Approved', 'Rejected', 'Cancelled', 'Fulfilled'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status filter.' });
    const params = [];
    const where = status === 'All' ? '' : 'WHERE r.request_status = ?';
    if (status !== 'All') params.push(status);
    const [rows] = await pool.query(
      `SELECT r.*, m.name AS member_name, m.member_type, m.email AS member_email,
              m.institutional_id, u.full_name AS reviewed_by_name,
              CASE WHEN b.isbn IS NULL THEN 0 ELSE 1 END AS catalog_exists,
              b.available_copies, b.total_copies
       FROM book_requests r
       JOIN members m ON m.membership_id = r.membership_id
       LEFT JOIN users u ON u.id = r.reviewed_by
       LEFT JOIN book_titles b ON b.isbn = r.requested_isbn
       ${where}
       ORDER BY CASE r.request_status WHEN 'Pending' THEN 0 WHEN 'Approved' THEN 1 ELSE 2 END,
                r.created_at DESC`,
      params
    );
    return res.json({ success: true, requests: rows });
  } catch (error) {
    console.error('Get all book requests error:', error);
    return res.status(500).json({ success: false, error: 'Unable to retrieve book requests.' });
  }
};

exports.reviewRequest = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const requestId = Number(req.params.requestId);
    const status = String(req.body.status || '');
    const staffNote = String(req.body.staffNote || '').trim();
    if (!Number.isInteger(requestId) || requestId < 1) return res.status(400).json({ success: false, error: 'Invalid request ID.' });
    if (!['Approved', 'Rejected'].includes(status)) return res.status(400).json({ success: false, error: 'Status must be Approved or Rejected.' });
    if (staffNote.length > 500) return res.status(400).json({ success: false, error: 'Staff note must be 500 characters or fewer.' });

    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM book_requests WHERE request_id = ? FOR UPDATE', [requestId]);
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Book request not found.' });
    }
    const request = rows[0];
    if (request.request_status !== 'Pending') {
      await connection.rollback();
      return res.status(409).json({ success: false, error: `Only Pending requests can be reviewed. Current status: ${request.request_status}.` });
    }
    await connection.query(
      `UPDATE book_requests SET request_status = ?, staff_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE request_id = ?`,
      [status, staffNote || null, req.session.user.id, requestId]
    );
    await connection.commit();
    return res.json({ success: true, message: `Request ${status.toLowerCase()}.`, requestId, status });
  } catch (error) {
    await connection.rollback();
    console.error('Review book request error:', error);
    return res.status(500).json({ success: false, error: 'Unable to update book request.' });
  } finally {
    connection.release();
  }
};

exports.cancelMyRequest = async (req, res) => {
  try {
    const requestId = Number(req.params.requestId);
    if (!Number.isInteger(requestId) || requestId < 1) return res.status(400).json({ success: false, error: 'Invalid request ID.' });
    const [result] = await pool.query(
      `UPDATE book_requests SET request_status = 'Cancelled'
       WHERE request_id = ? AND membership_id = ? AND request_status = 'Pending'`,
      [requestId, req.session.user.membershipId]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, error: 'Pending request not found. Only pending requests can be cancelled.' });
    return res.json({ success: true, message: 'Book request cancelled.' });
  } catch (error) {
    console.error('Cancel book request error:', error);
    return res.status(500).json({ success: false, error: 'Unable to cancel book request.' });
  }
};
