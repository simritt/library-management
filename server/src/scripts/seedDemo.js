/**
 * Small, idempotent demo dataset for presentations (run AFTER `npm run seed`):
 *
 *   npm run seed:demo
 *
 * Adds a handful of realistic records, dated relative to today, so every screen has something to show:
 * an overdue loan, late returns with paid / partly paid / waived fines, a fully issued title with a
 * waiting reservation, a damaged copy, and patron requests in Pending / Approved / Rejected states.
 * Existing data (including members you registered yourself) is never modified or removed.
 */
const { pool } = require('../config/db');
const { validateISBN } = require('../utils/isbnValidator');

const M = { parth: 'MEM-2026-0001', simrit: 'MEM-2026-0002', faculty: 'MEM-2026-0003', aarav: 'MEM-2026-0004' };
const B = {
  algorithms: '9780262033848', clang: '9780131103627', java: '9780134685991', headFirst: '9780596007126',
  os: '9780131101630', networks: '9780136086208', db: '9780073523323', clean: '9780132350884'
};

async function seedDemo() {
  const conn = await pool.getConnection();
  try {
    const [members] = await conn.query('SELECT membership_id FROM members WHERE membership_id IN (?)', [Object.values(M)]);
    if (members.length !== 4) throw new Error('Run `npm run seed` first: the four sample members are missing.');

    const [already] = await conn.query("SELECT payment_id FROM fine_payments WHERE receipt_number = 'RCP-DEMO-0001'");
    if (already.length) { console.log('Demo data is already loaded. Nothing to do.'); return; }

    // Pick whichever copies are free right now (the library may already have live activity).
    const needed = { [B.algorithms]: 1, [B.clang]: 2, [B.java]: 1, [B.headFirst]: 3, [B.os]: 1, [B.networks]: 1, [B.db]: 1, [B.clean]: 1 };
    const short = [];
    for (const [isbn, count] of Object.entries(needed)) {
      const [[row]] = await conn.query("SELECT COUNT(*) free FROM book_copies WHERE isbn = ? AND copy_status = 'Available'", [isbn]);
      if (row.free < count) short.push(`${isbn} needs ${count} free copies (has ${row.free})`);
    }
    if (short.length) throw new Error(`Not enough free copies for the demo: ${short.join('; ')}.`);

    const [staff] = await conn.query("SELECT id, username, full_name FROM users WHERE username IN ('librarian', 'admin')");
    const lib = staff.find((u) => u.username === 'librarian');
    const admin = staff.find((u) => u.username === 'admin');
    if (!lib || !admin) throw new Error('Run `npm run seed` first: staff accounts are missing.');

    await conn.beginTransaction();

    const title = async (isbn) => (await conn.query('SELECT title FROM book_titles WHERE isbn = ?', [isbn]))[0][0].title;
    const log = (type, by, byName, member, accession, details, daysAgo) => conn.query(
      `INSERT INTO transaction_logs (action_type, performed_by, performed_by_name, membership_id, accession_number, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? DAY))`, [type, by, byName, member, accession, details, daysAgo]);

    // loan({..., issuedAgo, dueAgo (negative = in the future), returnedAgo|null}); uses the next free copy of the title
    async function loan({ member, isbn, issuedAgo, dueAgo, returnedAgo = null }) {
      const [[free]] = await conn.query(
        "SELECT accession_number FROM book_copies WHERE isbn = ? AND copy_status = 'Available' ORDER BY accession_number LIMIT 1 FOR UPDATE", [isbn]);
      if (!free) throw new Error(`No free copy of ${isbn}`);
      const accession = free.accession_number;
      const [res] = await conn.query(
        `INSERT INTO loans (membership_id, accession_number, isbn, issue_date, due_date, return_date, loan_status, issued_by, received_by, created_at)
         VALUES (?, ?, ?, DATE_SUB(CURDATE(), INTERVAL ? DAY), DATE_SUB(CURDATE(), INTERVAL ? DAY),
                 ${returnedAgo === null ? 'NULL' : 'DATE_SUB(CURDATE(), INTERVAL ? DAY)'}, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? DAY))`,
        [member, accession, isbn, issuedAgo, dueAgo, ...(returnedAgo === null ? [] : [returnedAgo]),
          returnedAgo === null ? 'Issued' : 'Returned', lib.id, returnedAgo === null ? null : lib.id, issuedAgo]);
      const name = await title(isbn);
      await log('ISSUE', lib.id, lib.full_name, member, accession, `Issued book "${name}" (Accession: ${accession}). Demo data.`, issuedAgo);
      if (returnedAgo === null) {
        await conn.query("UPDATE book_copies SET copy_status = 'Issued' WHERE accession_number = ?", [accession]);
      } else {
        await log('RETURN', lib.id, lib.full_name, member, accession, `Processed return of "${name}" (Accession: ${accession}). Demo data.`, returnedAgo);
      }
      return res.insertId;
    }

    async function fine(loanId, member, amount, returnedAgo, { paid = 0, waived = 0, waiveRemark = null, receipt = null } = {}) {
      const [res] = await conn.query(
        `INSERT INTO fines (loan_id, membership_id, amount_charged, amount_paid, waived_amount, waived_by, waiver_remark, date_charged)
         VALUES (?, ?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? DAY))`,
        [loanId, member, amount, paid, waived, waived ? admin.id : null, waiveRemark, returnedAgo]);
      if (paid > 0) {
        await conn.query(
          `INSERT INTO fine_payments (fine_id, membership_id, amount, payment_date, collected_by, receipt_number)
           VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL ? DAY), ?, ?)`, [res.insertId, member, paid, returnedAgo, lib.id, receipt]);
        await log('FINE_PAYMENT', lib.id, lib.full_name, member, null, `Collected payment of Rs. ${paid} for fine #${res.insertId}. Receipt: ${receipt}`, returnedAgo);
      }
      if (waived > 0) {
        await log('FINE_WAIVE', admin.id, admin.full_name, member, null, `Waived fine amount of Rs. ${waived} for fine #${res.insertId}. Reason: ${waiveRemark}`, returnedAgo);
      }
    }

    // 1. Late returns with different fine outcomes (Rs 2/day)
    const javaLoan = await loan({ member: M.parth, isbn: B.java, issuedAgo: 50, dueAgo: 36, returnedAgo: 26 }); // 10 days late
    await fine(javaLoan, M.parth, 20, 26, { paid: 20, receipt: 'RCP-DEMO-0001' });                                    // fully paid
    const cLoan = await loan({ member: M.simrit, isbn: B.clang, issuedAgo: 36, dueAgo: 22, returnedAgo: 14 }); // 8 days late
    await fine(cLoan, M.simrit, 16, 14, { paid: 10, receipt: 'RCP-DEMO-0002' });                                      // Rs 6 still due
    const netLoan = await loan({ member: M.aarav, isbn: B.networks, issuedAgo: 40, dueAgo: 26, returnedAgo: 19 }); // 7 days late
    await fine(netLoan, M.aarav, 14, 19, { waived: 14, waiveRemark: 'Hospitalised during exam week (medical certificate submitted)' }); // waived by admin
    await loan({ member: M.faculty, isbn: B.clean, issuedAgo: 40, dueAgo: 10, returnedAgo: 12 });              // returned on time

    // 2. Currently issued books: one overdue, the rest on time
    await loan({ member: M.parth, isbn: B.algorithms, issuedAgo: 24, dueAgo: 10 });                            // 10 days overdue, Rs 20 accruing
    await loan({ member: M.simrit, isbn: B.os, issuedAgo: 3, dueAgo: -11 });
    await loan({ member: M.faculty, isbn: B.db, issuedAgo: 12, dueAgo: -18 });

    // 3. A fully issued title with a waiting reservation
    await loan({ member: M.simrit, isbn: B.headFirst, issuedAgo: 5, dueAgo: -9 });
    await loan({ member: M.faculty, isbn: B.headFirst, issuedAgo: 9, dueAgo: -21 });
    await loan({ member: M.aarav, isbn: B.headFirst, issuedAgo: 3, dueAgo: -11 });
    await conn.query(
      `INSERT INTO reservations (membership_id, isbn, queue_position, reservation_date, status)
       VALUES (?, ?, 1, DATE_SUB(NOW(), INTERVAL 2 DAY), 'Active')`, [M.parth, B.headFirst]);

    // 4. A damaged copy (retired from circulation)
    const [[damaged]] = await conn.query(
      "SELECT accession_number FROM book_copies WHERE isbn = ? AND copy_status = 'Available' ORDER BY accession_number DESC LIMIT 1", [B.clang]);
    await conn.query("UPDATE book_copies SET copy_status = 'Damaged' WHERE accession_number = ?", [damaged.accession_number]);
    await log('COPY_STATUS_CHANGE', lib.id, lib.full_name, null, damaged.accession_number, 'Changed copy status from Available to Damaged. Remark: Water damage found at shelf check. Demo data.', 6);

    // 5. Patron requests in every review state
    await conn.query(
      `INSERT INTO book_requests (membership_id, requested_title, requested_isbn, requested_days, request_note, request_status, created_at)
       VALUES (?, 'Designing Data-Intensive Applications', '9781449373320', 7, 'Needed for the distributed systems project.', 'Pending', DATE_SUB(NOW(), INTERVAL 1 DAY))`, [M.simrit]);
    await conn.query(
      `INSERT INTO book_requests (membership_id, requested_title, requested_isbn, requested_days, request_note, request_status, staff_note, reviewed_by, reviewed_at, created_at)
       VALUES (?, 'Clean Code: A Handbook of Agile Software Craftsmanship', ?, 10, 'Course reference.', 'Approved', 'Copy available, please collect from the desk.', ?, DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY))`,
      [M.aarav, B.clean, lib.id]);
    await conn.query(
      `INSERT INTO book_requests (membership_id, requested_title, requested_isbn, requested_days, request_status, staff_note, reviewed_by, reviewed_at, created_at)
       VALUES (?, 'Design Patterns: Elements of Reusable Object-Oriented Software', '9780201633610', 14, 'Rejected', 'Already on order. Please check back next month.', ?, DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 5 DAY))`,
      [M.parth, lib.id]);

    // Keep the per-title counters exact (same reconciliation the base seed uses)
    await conn.query(
      `UPDATE book_titles b
       SET b.total_copies = (SELECT COUNT(*) FROM book_copies c WHERE c.isbn = b.isbn),
           b.available_copies = (SELECT COUNT(*) FROM book_copies c WHERE c.isbn = b.isbn AND c.copy_status = 'Available')`);

    await conn.commit();
    console.log('Demo data loaded: 10 loans (4 returned, 6 active of which 1 is overdue), 3 fines (paid / partly paid / waived),');
    console.log('1 fully issued title with a waiting reservation, 1 damaged copy, 3 patron requests.');
  } catch (error) {
    await conn.rollback();
    console.error('Demo seeding failed:', error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

if (require.main === module) seedDemo();
module.exports = { seedDemo };
