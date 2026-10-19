const { pool } = require('../config/db');
const { localDateString } = require('../utils/dates');

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
function dateRange(query) {
  const start = isDate(query.startDate) ? query.startDate : '2000-01-01';
  const end = isDate(query.endDate) ? query.endDate : localDateString();
  return { start, end };
}

/**
 * Reports & Settings Controller
 * Implements Section 4.8 (Generate Reports) & System Administration
 * FR-Report.Inventory-01
 * FR-Report.Overdue-01
 * FR-Report.Circulation-01
 * FR-Report.Fines-01
 * FR-Report.Export-01 (CSV Export)
 * System Settings Configuration (SE-5)
 */

// Inventory Report (FR-Report.Inventory-01)
exports.getInventoryReport = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.isbn, b.title, b.author, b.category, b.total_copies, b.available_copies,
              (b.total_copies - b.available_copies) AS issued_or_unavailable_copies,
              (SELECT COUNT(*) FROM book_copies c WHERE c.isbn = b.isbn AND c.copy_status = 'Lost') AS lost_copies,
              (SELECT COUNT(*) FROM book_copies c WHERE c.isbn = b.isbn AND c.copy_status = 'Damaged') AS damaged_copies
       FROM book_titles b
       ORDER BY b.title ASC`
    );

    const [summary] = await pool.query(
      `SELECT 
         COUNT(*) as totalTitles,
         COALESCE(SUM(total_copies), 0) as totalPhysicalCopies,
         COALESCE(SUM(available_copies), 0) as totalAvailableCopies
       FROM book_titles`
    );

    return res.json({
      success: true,
      summary: summary[0],
      inventory: rows
    });
  } catch (error) {
    console.error('Inventory report error:', error);
    return res.status(500).json({ success: false, error: 'Failed to generate inventory report' });
  }
};

// Overdue Loans Report (FR-Report.Overdue-01)
exports.getOverdueReport = async (req, res) => {
  try {
    const [settings] = await pool.query(
      "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('fine_rate_per_day', 'max_fine_per_loan')"
    );
    const config = Object.fromEntries(settings.map((item) => [item.setting_key, Number(item.setting_value)]));
    const rate = Number.isFinite(config.fine_rate_per_day) ? config.fine_rate_per_day : 2;
    const cap = Number.isFinite(config.max_fine_per_loan) ? config.max_fine_per_loan : 200;
    const [rows] = await pool.query(
      `SELECT l.loan_id, l.accession_number, l.issue_date, l.due_date,
              m.membership_id, m.name as member_name, m.member_type, m.email, m.phone,
              b.title as book_title, b.isbn,
              DATEDIFF(CURDATE(), l.due_date) as days_overdue,
              LEAST(DATEDIFF(CURDATE(), l.due_date) * ?, ?) as estimated_fine
       FROM loans l
       JOIN members m ON l.membership_id = m.membership_id
       JOIN book_titles b ON l.isbn = b.isbn
       WHERE l.loan_status = 'Issued' AND l.due_date < CURDATE()
       ORDER BY days_overdue DESC`, [rate, cap]
    );

    return res.json({
      success: true,
      count: rows.length,
      overdueLoans: rows
    });
  } catch (error) {
    console.error('Overdue report error:', error);
    return res.status(500).json({ success: false, error: 'Failed to generate overdue report' });
  }
};

// Circulation Activity Report (FR-Report.Circulation-01)
exports.getCirculationReport = async (req, res) => {
  try {
    const { start, end } = dateRange(req.query);
    if (start > end) return res.status(400).json({ success: false, error: 'Start date must not be after end date.' });

    const [issues] = await pool.query(
      `SELECT COUNT(*) as count 
       FROM loans 
       WHERE issue_date >= ? AND issue_date <= ?`,
      [start, end]
    );

    const [returns] = await pool.query(
      `SELECT COUNT(*) as count 
       FROM loans 
       WHERE return_date >= ? AND return_date <= ?`,
      [start, end]
    );

    const [dailyBreakdown] = await pool.query(
      `SELECT d.activity_date,
              (SELECT COUNT(*) FROM loans li WHERE li.issue_date = d.activity_date) AS issues_count,
              (SELECT COUNT(*) FROM loans lr WHERE lr.return_date = d.activity_date) AS returns_count
       FROM (
         SELECT issue_date AS activity_date FROM loans WHERE issue_date BETWEEN ? AND ?
         UNION
         SELECT return_date FROM loans WHERE return_date BETWEEN ? AND ?
       ) d
       ORDER BY d.activity_date DESC
       LIMIT 60`,
      [start, end, start, end]
    );

    return res.json({
      success: true,
      dateRange: { start, end },
      totalIssues: issues[0].count,
      totalReturns: returns[0].count,
      dailyBreakdown
    });
  } catch (error) {
    console.error('Circulation report error:', error);
    return res.status(500).json({ success: false, error: 'Failed to generate circulation report' });
  }
};

// Fines Financial Report (FR-Report.Fines-01)
exports.getFinesReport = async (req, res) => {
  try {
    const { start, end } = dateRange(req.query);
    if (start > end) return res.status(400).json({ success: false, error: 'Start date must not be after end date.' });

    const [finesCharged] = await pool.query(
      `SELECT COALESCE(SUM(amount_charged), 0.00) as totalCharged,
 COALESCE(SUM(waived_amount), 0.00) as totalWaived,
              COALESCE(SUM(amount_paid), 0.00) as totalPaidOnCharged
       FROM fines 
       WHERE DATE(date_charged) >= ? AND DATE(date_charged) <= ?`,
      [start, end]
    );

    const [finesCollected] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0.00) as totalCollected
       FROM fine_payments 
       WHERE DATE(payment_date) >= ? AND DATE(payment_date) <= ?`,
      [start, end]
    );

    const [detailedList] = await pool.query(
      `SELECT f.*, m.name as member_name, b.title as book_title
       FROM fines f
       JOIN members m ON f.membership_id = m.membership_id
       JOIN loans l ON f.loan_id = l.loan_id
       JOIN book_titles b ON l.isbn = b.isbn
       WHERE DATE(f.date_charged) BETWEEN ? AND ?
       ORDER BY f.date_charged DESC
       LIMIT 100`,
      [start, end]
    );

    return res.json({
      success: true,
      totalCharged: parseFloat(finesCharged[0].totalCharged),
      totalCollected: parseFloat(finesCollected[0].totalCollected),
      totalWaived: parseFloat(finesCharged[0].totalWaived),
      outstanding: Math.max(0, parseFloat(finesCharged[0].totalCharged) - parseFloat(finesCharged[0].totalPaidOnCharged) - parseFloat(finesCharged[0].totalWaived)),
      dateRange: { start, end },
      recentFines: detailedList
    });
  } catch (error) {
    console.error('Fines report error:', error);
    return res.status(500).json({ success: false, error: 'Failed to generate fines report' });
  }
};

// CSV Export (FR-Report.Export-01)
exports.exportReportCsv = async (req, res) => {
  try {
    const { type } = req.params;
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    let header;
    let rows;
    if (type === 'inventory') {
      [rows] = await pool.query('SELECT isbn, title, author, category, publisher, total_copies, available_copies FROM book_titles ORDER BY title ASC');
      header = ['ISBN', 'Title', 'Author', 'Category', 'Publisher', 'Total Copies', 'Available Copies'];
      rows = rows.map((r) => [r.isbn, r.title, r.author, r.category, r.publisher, r.total_copies, r.available_copies]);
    } else if (type === 'overdue') {
      [rows] = await pool.query(
        `SELECT l.accession_number, b.title AS book_title, m.name AS member_name, m.membership_id,
                l.due_date, DATEDIFF(CURDATE(), l.due_date) AS days_overdue
         FROM loans l JOIN members m ON l.membership_id = m.membership_id
         JOIN book_titles b ON l.isbn = b.isbn
         WHERE l.loan_status = 'Issued' AND l.due_date < CURDATE() ORDER BY days_overdue DESC`
      );
      header = ['Accession Number', 'Book Title', 'Member Name', 'Membership ID', 'Due Date', 'Days Overdue'];
      rows = rows.map((r) => [r.accession_number, r.book_title, r.member_name, r.membership_id, r.due_date, r.days_overdue]);
    } else if (type === 'fines') {
      [rows] = await pool.query(
        `SELECT f.fine_id, f.membership_id, m.name AS member_name, b.title AS book_title,
                f.amount_charged, f.amount_paid, f.waived_amount,
                GREATEST(f.amount_charged - f.amount_paid - f.waived_amount, 0) AS outstanding,
                f.date_charged, f.waiver_remark
         FROM fines f JOIN members m ON m.membership_id = f.membership_id
         JOIN loans l ON l.loan_id = f.loan_id JOIN book_titles b ON b.isbn = l.isbn
         WHERE DATE(f.date_charged) BETWEEN ? AND ?
         ORDER BY f.date_charged DESC`, [dateRange(req.query).start, dateRange(req.query).end]
      );
      header = ['Fine ID', 'Membership ID', 'Member Name', 'Book Title', 'Charged', 'Collected', 'Waived', 'Outstanding', 'Date Charged', 'Waiver Remark'];
      rows = rows.map((r) => [r.fine_id, r.membership_id, r.member_name, r.book_title, r.amount_charged, r.amount_paid, r.waived_amount, r.outstanding, r.date_charged, r.waiver_remark]);
    } else if (type === 'circulation') {
      const { start, end } = dateRange(req.query);
      [rows] = await pool.query(
        `SELECT l.loan_id, l.accession_number, b.title AS book_title, m.membership_id, m.name AS member_name,
                l.issue_date, l.due_date, l.return_date, l.loan_status
         FROM loans l JOIN members m ON m.membership_id = l.membership_id JOIN book_titles b ON b.isbn = l.isbn
         WHERE l.issue_date BETWEEN ? AND ? OR l.return_date BETWEEN ? AND ?
         ORDER BY l.issue_date DESC, l.loan_id DESC`, [start, end, start, end]
      );
      header = ['Loan ID', 'Accession Number', 'Book Title', 'Membership ID', 'Member Name', 'Issue Date', 'Due Date', 'Return Date', 'Status'];
      rows = rows.map((r) => [r.loan_id, r.accession_number, r.book_title, r.membership_id, r.member_name, r.issue_date, r.due_date, r.return_date, r.loan_status]);
    } else {
      return res.status(400).json({ success: false, error: 'Unsupported export type. Use inventory, overdue, circulation, or fines.' });
    }

    // Prefix cells with a quote and escape quotes to avoid malformed CSV when titles contain punctuation.
    const csvContent = [header.map(quote).join(','), ...rows.map((row) => row.map(quote).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="library_${type}_report_${Date.now()}.csv"`);
    return res.send(`\uFEFF${csvContent}`);
  } catch (error) {
    console.error('CSV export error:', error);
    return res.status(500).json({ success: false, error: 'Failed to export CSV' });
  }
};

// System Settings Management (SE-5)
exports.getSettings = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM system_settings');
    const settings = {};
    rows.forEach(r => {
      settings[r.setting_key] = r.setting_value;
    });
    return res.json({ success: true, settings });
  } catch (error) {
    console.error('Get settings error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
};

exports.updateSettings = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ success: false, error: 'Invalid settings payload' });
    }
    const allowed = {
      fine_rate_per_day: { min: 0.01, max: 1000, integer: false },
      max_fine_per_loan: { min: 1, max: 100000, integer: false },
      fine_block_threshold: { min: 0, max: 100000, integer: false },
      student_loan_days: { min: 1, max: 365, integer: true },
      faculty_loan_days: { min: 1, max: 365, integer: true },
      student_borrow_limit: { min: 1, max: 50, integer: true },
      faculty_borrow_limit: { min: 1, max: 50, integer: true },
      reservation_hold_hours: { min: 1, max: 720, integer: true },
    };
    const updates = [];
    for (const [key, raw] of Object.entries(settings)) {
      if (!(key in allowed)) return res.status(400).json({ success: false, error: `Setting '${key}' cannot be changed through this screen.` });
      const value = Number(raw);
      const rule = allowed[key];
      if (!Number.isFinite(value) || value < rule.min || value > rule.max || (rule.integer && !Number.isInteger(value))) {
        return res.status(400).json({ success: false, error: `Invalid value for ${key}.` });
      }
      updates.push([String(value), key]);
    }
    if (!updates.length) return res.status(400).json({ success: false, error: 'No settings were supplied.' });

    await connection.beginTransaction();
    for (const [value, key] of updates) {
      await connection.query('UPDATE system_settings SET setting_value = ? WHERE setting_key = ?', [value, key]);
    }
    await connection.commit();
    return res.json({ success: true, message: 'Settings updated successfully', updated: updates.map(([, key]) => key) });
  } catch (error) {
    await connection.rollback();
    console.error('Update settings error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update settings' });
  } finally {
    connection.release();
  }
};
