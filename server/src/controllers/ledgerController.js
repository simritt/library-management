const { pool } = require('../config/db');

const outstandingExpression = 'GREATEST(f.amount_charged - f.amount_paid - f.waived_amount, 0)';

async function buildMemberLedger(membershipId) {
  const [memberRows] = await pool.query(
    `SELECT m.membership_id, m.name, m.institutional_id, m.department, m.email, m.phone,
            m.member_type, m.account_status, m.borrowing_limit, m.created_at,
            (SELECT COUNT(*) FROM loans x WHERE x.membership_id = m.membership_id AND x.loan_status = 'Issued') AS active_loan_count,
            (SELECT COUNT(*) FROM loans x WHERE x.membership_id = m.membership_id) AS lifetime_loan_count
     FROM members m WHERE m.membership_id = ?`,
    [membershipId]
  );
  if (!memberRows.length) return null;

  const [fineSettings] = await pool.query(
    "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('fine_rate_per_day', 'max_fine_per_loan')"
  );
  const fineConfig = Object.fromEntries(fineSettings.map((row) => [row.setting_key, Number(row.setting_value)]));
  const fineRate = Number.isFinite(fineConfig.fine_rate_per_day) ? fineConfig.fine_rate_per_day : 2;
  const maxFine = Number.isFinite(fineConfig.max_fine_per_loan) ? fineConfig.max_fine_per_loan : 200;

  const [loans] = await pool.query(
    `SELECT l.loan_id, l.membership_id, l.accession_number, l.isbn, b.title, b.author, b.category,
            l.issue_date, l.due_date, l.return_date, l.loan_status,
            CASE WHEN l.loan_status = 'Issued' THEN GREATEST(DATEDIFF(CURDATE(), l.issue_date), 0)
                 ELSE GREATEST(DATEDIFF(l.return_date, l.issue_date), 0) END AS days_elapsed,
            CASE WHEN l.loan_status = 'Issued' AND l.due_date >= CURDATE() THEN GREATEST(DATEDIFF(l.due_date, CURDATE()), 0) ELSE 0 END AS days_remaining,
            CASE WHEN l.loan_status = 'Issued' AND l.due_date < CURDATE() THEN DATEDIFF(CURDATE(), l.due_date)
                 WHEN l.loan_status = 'Returned' AND l.return_date > l.due_date THEN DATEDIFF(l.return_date, l.due_date) ELSE 0 END AS days_overdue,
            COALESCE(fa.amount_charged, 0) AS fine_charged,
            COALESCE(fa.amount_paid, 0) AS fine_paid,
            COALESCE(fa.waived_amount, 0) AS fine_waived,
            CASE WHEN l.loan_status = 'Issued' AND l.due_date < CURDATE()
                       AND NOT EXISTS (SELECT 1 FROM fines active_fine WHERE active_fine.loan_id = l.loan_id)
                 THEN LEAST(?, DATEDIFF(CURDATE(), l.due_date) * ?) ELSE 0 END AS fine_accrued_now,
            GREATEST(COALESCE(fa.amount_charged, 0) - COALESCE(fa.amount_paid, 0) - COALESCE(fa.waived_amount, 0), 0) AS fine_outstanding
     FROM loans l
     JOIN book_titles b ON b.isbn = l.isbn
     LEFT JOIN (
       SELECT loan_id, SUM(amount_charged) AS amount_charged, SUM(amount_paid) AS amount_paid, SUM(waived_amount) AS waived_amount
       FROM fines GROUP BY loan_id
     ) fa ON fa.loan_id = l.loan_id
     WHERE l.membership_id = ?
     ORDER BY l.issue_date DESC, l.loan_id DESC`,
    [maxFine, fineRate, membershipId]
  );

  const [fines] = await pool.query(
    `SELECT f.fine_id, f.loan_id, f.amount_charged, f.amount_paid, f.waived_amount,
            GREATEST(f.amount_charged - f.amount_paid - f.waived_amount, 0) AS outstanding,
            f.date_charged, f.waiver_remark, b.title, l.accession_number, l.issue_date, l.due_date, l.return_date
     FROM fines f JOIN loans l ON l.loan_id = f.loan_id JOIN book_titles b ON b.isbn = l.isbn
     WHERE f.membership_id = ? ORDER BY f.date_charged DESC, f.fine_id DESC`,
    [membershipId]
  );
  const [payments] = await pool.query(
    `SELECT p.payment_id, p.fine_id, p.amount, p.payment_date, p.receipt_number,
            p.collected_by, u.full_name AS collected_by_name, b.title, l.accession_number
     FROM fine_payments p
     JOIN fines f ON f.fine_id = p.fine_id
     JOIN loans l ON l.loan_id = f.loan_id
     JOIN book_titles b ON b.isbn = l.isbn
     LEFT JOIN users u ON u.id = p.collected_by
     WHERE p.membership_id = ? ORDER BY p.payment_date DESC, p.payment_id DESC`,
    [membershipId]
  );
  const [fineSummaryRows] = await pool.query(
    `SELECT COALESCE(SUM(amount_charged), 0) AS total_charged,
            COALESCE(SUM(amount_paid), 0) AS total_paid,
            COALESCE(SUM(waived_amount), 0) AS total_waived,
            COALESCE(SUM(${outstandingExpression}), 0) AS total_outstanding
     FROM fines f WHERE membership_id = ?`,
    [membershipId]
  );
  const [reservations] = await pool.query(
    `SELECT r.reservation_id, r.isbn, b.title, r.queue_position, r.reservation_date, r.status,
            r.held_accession_number, r.hold_expires_at,
            CASE WHEN r.status = 'Active' AND r.held_accession_number IS NULL THEN
              (SELECT COUNT(*) + 1 FROM reservations earlier WHERE earlier.isbn = r.isbn AND earlier.status = 'Active'
               AND earlier.held_accession_number IS NULL AND (earlier.reservation_date < r.reservation_date OR (earlier.reservation_date = r.reservation_date AND earlier.reservation_id < r.reservation_id)))
              ELSE NULL END AS live_queue_position
     FROM reservations r JOIN book_titles b ON b.isbn = r.isbn
     WHERE r.membership_id = ? ORDER BY r.reservation_date DESC`,
    [membershipId]
  );
  const [requests] = await pool.query(
    `SELECT request_id, requested_title, requested_isbn, requested_days, request_note,
            request_status, staff_note, reviewed_at, created_at
     FROM book_requests WHERE membership_id = ? ORDER BY created_at DESC, request_id DESC`,
    [membershipId]
  );
  const s = fineSummaryRows[0];
  const [liveAccrualRows] = await pool.query(
    `SELECT COALESCE(SUM(LEAST(?, DATEDIFF(CURDATE(), l.due_date) * ?)), 0) AS accrued
     FROM loans l WHERE l.membership_id = ? AND l.loan_status = 'Issued' AND l.due_date < CURDATE()
       AND NOT EXISTS (SELECT 1 FROM fines f WHERE f.loan_id = l.loan_id)`,
    [maxFine, fineRate, membershipId]
  );
  const liveAccruedFine = Number(liveAccrualRows[0]?.accrued || 0);
  return {
    member: memberRows[0],
    summary: {
      activeLoans: Number(memberRows[0].active_loan_count || 0),
      lifetimeLoans: Number(memberRows[0].lifetime_loan_count || 0),
      finesCharged: Number(s.total_charged || 0),
      finesCollected: Number(s.total_paid || 0),
      finesWaived: Number(s.total_waived || 0),
      finesOutstanding: Number(s.total_outstanding || 0) + liveAccruedFine,
      liveAccruedFine
    },
    loans,
    fines,
    payments,
    reservations,
    requests
  };
}

exports.getMyLedger = async (req, res) => {
  try {
    if (req.session.user.userType !== 'patron' || !req.session.user.membershipId) {
      return res.status(403).json({ success: false, error: 'This endpoint is reserved for a signed-in patron.' });
    }
    const ledger = await buildMemberLedger(req.session.user.membershipId);
    if (!ledger) return res.status(404).json({ success: false, error: 'Member account not found.' });
    return res.json({ success: true, ...ledger });
  } catch (error) {
    console.error('Get patron ledger error:', error);
    return res.status(500).json({ success: false, error: 'Unable to load your account ledger.' });
  }
};

exports.getMemberLedger = async (req, res) => {
  try {
    const membershipId = String(req.params.membershipId || '').trim();
    const ledger = await buildMemberLedger(membershipId);
    if (!ledger) return res.status(404).json({ success: false, error: 'Member account not found.' });
    return res.json({ success: true, ...ledger });
  } catch (error) {
    console.error('Get member ledger error:', error);
    return res.status(500).json({ success: false, error: 'Unable to load member ledger.' });
  }
};

exports.getBookLedger = async (req, res) => {
  try {
    const isbn = String(req.params.isbn || '').trim();
    const [fineSettings] = await pool.query(
      "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('fine_rate_per_day', 'max_fine_per_loan')"
    );
    const fineConfig = Object.fromEntries(fineSettings.map((row) => [row.setting_key, Number(row.setting_value)]));
    const fineRate = Number.isFinite(fineConfig.fine_rate_per_day) ? fineConfig.fine_rate_per_day : 2;
    const maxFine = Number.isFinite(fineConfig.max_fine_per_loan) ? fineConfig.max_fine_per_loan : 200;
    const [bookRows] = await pool.query(
      `SELECT isbn, title, author, category, publisher, edition, publication_year, total_copies, available_copies,
              (SELECT COUNT(*) FROM book_copies c WHERE c.isbn = book_titles.isbn AND c.copy_status = 'Issued') AS currently_issued,
              (SELECT COUNT(*) FROM book_copies c WHERE c.isbn = book_titles.isbn AND c.copy_status = 'Reserved_Hold') AS reserved_holds,
              (SELECT COUNT(*) FROM book_copies c WHERE c.isbn = book_titles.isbn AND c.copy_status = 'Lost') AS lost_copies,
              (SELECT COUNT(*) FROM book_copies c WHERE c.isbn = book_titles.isbn AND c.copy_status = 'Damaged') AS damaged_copies
       FROM book_titles WHERE isbn = ?`, [isbn]
    );
    if (!bookRows.length) return res.status(404).json({ success: false, error: 'Book not found in the catalogue.' });

    const [loans] = await pool.query(
      `SELECT l.loan_id, l.membership_id, m.name AS member_name, m.member_type, m.institutional_id,
              l.accession_number, l.issue_date, l.due_date, l.return_date, l.loan_status,
              CASE WHEN l.loan_status = 'Issued' THEN GREATEST(DATEDIFF(CURDATE(), l.issue_date), 0)
                   ELSE GREATEST(DATEDIFF(l.return_date, l.issue_date), 0) END AS days_elapsed,
              CASE WHEN l.loan_status = 'Issued' AND l.due_date >= CURDATE() THEN GREATEST(DATEDIFF(l.due_date, CURDATE()), 0) ELSE 0 END AS days_remaining,
              CASE WHEN l.loan_status = 'Issued' AND l.due_date < CURDATE() THEN DATEDIFF(CURDATE(), l.due_date)
                   WHEN l.loan_status = 'Returned' AND l.return_date > l.due_date THEN DATEDIFF(l.return_date, l.due_date) ELSE 0 END AS days_overdue,
              COALESCE(fa.amount_charged, 0) AS fine_charged,
              COALESCE(fa.amount_paid, 0) AS fine_collected,
              COALESCE(fa.waived_amount, 0) AS fine_waived,
              CASE WHEN l.loan_status = 'Issued' AND l.due_date < CURDATE()
                         AND NOT EXISTS (SELECT 1 FROM fines active_fine WHERE active_fine.loan_id = l.loan_id)
                   THEN LEAST(?, DATEDIFF(CURDATE(), l.due_date) * ?) ELSE 0 END AS fine_accrued_now,
              GREATEST(COALESCE(fa.amount_charged, 0) - COALESCE(fa.amount_paid, 0) - COALESCE(fa.waived_amount, 0), 0) AS fine_due
       FROM loans l JOIN members m ON m.membership_id = l.membership_id
       LEFT JOIN (
         SELECT loan_id, SUM(amount_charged) AS amount_charged, SUM(amount_paid) AS amount_paid, SUM(waived_amount) AS waived_amount
         FROM fines GROUP BY loan_id
       ) fa ON fa.loan_id = l.loan_id
       WHERE l.isbn = ? ORDER BY l.issue_date DESC, l.loan_id DESC`,
      [maxFine, fineRate, isbn]
    );
    const [summaryRows] = await pool.query(
      `SELECT COUNT(*) AS total_loans,
              SUM(CASE WHEN loan_status = 'Issued' THEN 1 ELSE 0 END) AS active_loans,
              SUM(CASE WHEN loan_status = 'Returned' THEN 1 ELSE 0 END) AS completed_loans
       FROM loans WHERE isbn = ?`, [isbn]
    );
    const [fineRows] = await pool.query(
      `SELECT COALESCE(SUM(f.amount_charged),0) AS charged,
              COALESCE(SUM(f.amount_paid),0) AS collected,
              COALESCE(SUM(f.waived_amount),0) AS waived,
              COALESCE(SUM(GREATEST(f.amount_charged - f.amount_paid - f.waived_amount,0)),0) AS outstanding
       FROM fines f JOIN loans l ON l.loan_id = f.loan_id WHERE l.isbn = ?`, [isbn]
    );
    const [liveAccrualRows] = await pool.query(
      `SELECT COALESCE(SUM(LEAST(?, DATEDIFF(CURDATE(), l.due_date) * ?)), 0) AS accrued
       FROM loans l WHERE l.isbn = ? AND l.loan_status = 'Issued' AND l.due_date < CURDATE()
         AND NOT EXISTS (SELECT 1 FROM fines f WHERE f.loan_id = l.loan_id)`,
      [maxFine, fineRate, isbn]
    );
    fineRows[0].live_accrued = Number(liveAccrualRows[0]?.accrued || 0);
    fineRows[0].outstanding = Number(fineRows[0].outstanding || 0) + fineRows[0].live_accrued;
    return res.json({ success: true, book: bookRows[0], summary: summaryRows[0], fines: fineRows[0], loans });
  } catch (error) {
    console.error('Get book ledger error:', error);
    return res.status(500).json({ success: false, error: 'Unable to load book ledger.' });
  }
};
