const { pool } = require('../config/db');
const { calculateDueDate, calculateFine } = require('../utils/fineCalculator');
const { localDateString } = require('../utils/dates');
const { isRetryable, withDeadlockRetry } = require('../utils/txRetry');

/**
 * Circulation Controller
 * Implements Module 4: Book Issue & Return, Fine Collection & Reservations
 * Strictly fulfills:
 * FR-Issue.Eligibility-01, 02, 03, Fail-01
 * FR-Issue.Copy-01, Copy-02
 * FR-Issue.DueDate-01 (14 days student, 30 days faculty, BR-2)
 * FR-Issue.Confirm-01, Confirm-02 (atomic transaction and rollback)
 * FR-Issue.Receipt-01
 * FR-Return.Locate-01, Locate-02
 * FR-Return.Process-01 (atomic transaction)
 * FR-Return.Fine-01, Fine-02 (Rs 2/day, max Rs 200 cap, BR-5, BR-6)
 * FR-Return.Reservation-01 (48 hour hold for queued reservation, BR-7)
 * FR-Fine.Pay-01, Pay-02, Waive-01 (Admin only, mandatory remark, BR-8)
 * FR-Reserve.Create-01, Create-02, Queue-01, Cancel-01
 */

// 1. Issue Book
exports.issueBook = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { membershipId, isbn, accessionNumber, requestedDays: requestedDaysInput, requestId: requestIdInput } = req.body;

    if (!membershipId || (!isbn && !accessionNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Membership ID and either ISBN or Accession Number are required.'
      });
    }

    await connection.beginTransaction();

    // 1. Check Member and Eligibility (FR-Issue.Eligibility-01 to 03)
    const [members] = await connection.query(
      'SELECT * FROM members WHERE membership_id = ? FOR UPDATE',
      [membershipId]
    );

    if (members.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Member not found.' });
    }

    const member = members[0];

    // Determine the maximum permitted loan period from the live policy settings.
    const policyKey = member.member_type === 'Faculty' ? 'faculty_loan_days' : 'student_loan_days';
    const fallbackDays = member.member_type === 'Faculty' ? 30 : 14;
    const [policyRows] = await connection.query('SELECT setting_value FROM system_settings WHERE setting_key = ?', [policyKey]);
    const maxLoanDays = policyRows.length ? Number(policyRows[0].setting_value) : fallbackDays;
    let loanDays = maxLoanDays;
    const requestId = requestIdInput ? Number(requestIdInput) : null;
    if (requestIdInput !== undefined && requestIdInput !== null && requestIdInput !== '' && (!Number.isInteger(requestId) || requestId < 1)) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Invalid book request ID.' });
    }
    let linkedRequest = null;
    if (requestId) {
      const [requestRows] = await connection.query(
        'SELECT * FROM book_requests WHERE request_id = ? AND membership_id = ? FOR UPDATE',
        [requestId, member.membership_id]
      );
      if (!requestRows.length) {
        await connection.rollback();
        return res.status(404).json({ success: false, error: 'The linked book request was not found for this member.' });
      }
      linkedRequest = requestRows[0];
      if (linkedRequest.request_status !== 'Approved') {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Only an approved book request can be fulfilled through issue.' });
      }
      loanDays = Number(linkedRequest.requested_days);
      if (!Number.isInteger(loanDays) || loanDays < 1 || loanDays > maxLoanDays) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: `The approved request duration exceeds the current policy limit of ${maxLoanDays} days for this member. Review the request or update the policy before issuing.` });
      }
    } else if (requestedDaysInput !== undefined && requestedDaysInput !== null && requestedDaysInput !== '') {
      loanDays = Number(requestedDaysInput);
      if (!Number.isInteger(loanDays) || loanDays < 1 || loanDays > maxLoanDays) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: `Loan duration must be a whole number from 1 to ${maxLoanDays} days for this member.` });
      }
    }

    // FR-Issue.Eligibility-01: Account status must be Active
    if (member.account_status !== 'Active') {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        eligibilityFailed: true,
        reason: 'INACTIVE_ACCOUNT',
        error: 'Issue failed: Member account status is Inactive. Reactivation by Administrator required (FR-Issue.Eligibility-01, BR-3).'
      });
    }

    // FR-Issue.Eligibility-02: Check current active loans against borrowing limit
    const [loanCountRows] = await connection.query(
      "SELECT COUNT(*) as activeCount FROM loans WHERE membership_id = ? AND loan_status = 'Issued'",
      [membershipId]
    );
    const activeCount = loanCountRows[0].activeCount;

    if (activeCount >= member.borrowing_limit) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        eligibilityFailed: true,
        reason: 'BORROWING_LIMIT_EXCEEDED',
        error: `Issue failed: Borrowing limit reached (${activeCount} / ${member.borrowing_limit} books currently issued) (FR-Issue.Eligibility-02, BR-1).`
      });
    }

    // FR-Issue.Eligibility-03: Check outstanding fine threshold (BR-4: Rs 100 threshold)
    const [fineRows] = await connection.query(
      'SELECT COALESCE(SUM(amount_charged - amount_paid - waived_amount), 0.00) as unpaidFine FROM fines WHERE membership_id = ?',
      [membershipId]
    );
    const unpaidFine = parseFloat(fineRows[0].unpaidFine);

    // Retrieve threshold setting (default 100.00)
    const [settingRows] = await connection.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'fine_block_threshold'"
    );
    const fineThreshold = settingRows.length > 0 ? parseFloat(settingRows[0].setting_value) : 100.00;

    if (unpaidFine > fineThreshold) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        eligibilityFailed: true,
        reason: 'FINE_THRESHOLD_EXCEEDED',
        error: `Issue failed: Member has outstanding fine of Rs. ${unpaidFine.toFixed(2)}, which exceeds the permitted limit of Rs. ${fineThreshold.toFixed(2)} (FR-Issue.Eligibility-03, BR-4).`
      });
    }

    // Lock order is always member -> title -> copy. Taking the title row first serialises concurrent
    // issues of the same title and avoids shared->exclusive FK lock upgrades that deadlock under load.
    let lockIsbn = isbn ? String(isbn).trim() : null;
    if (!lockIsbn && accessionNumber) {
      const [copyIsbnRows] = await connection.query('SELECT isbn FROM book_copies WHERE accession_number = ?', [accessionNumber.trim()]);
      lockIsbn = copyIsbnRows.length ? copyIsbnRows[0].isbn : null;
    }
    if (lockIsbn) await connection.query('SELECT isbn FROM book_titles WHERE isbn = ? FOR UPDATE', [lockIsbn]);

    // 2. Locate Copy (FR-Issue.Copy-01 & Copy-02), including a hold assigned to this patron.
    let selectedCopy = null;
    let linkedReservation = null;

    if (accessionNumber) {
      // Specific copy requested
      const [copyRows] = await connection.query(
        'SELECT * FROM book_copies WHERE accession_number = ? FOR UPDATE',
        [accessionNumber.trim()]
      );
      if (copyRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, error: 'Specified accession number does not exist.' });
      }
      if (copyRows[0].copy_status === 'Reserved_Hold') {
        const [ownHold] = await connection.query(
          `SELECT * FROM reservations WHERE held_accession_number = ? AND membership_id = ? AND status = 'Active' FOR UPDATE`,
          [accessionNumber.trim(), member.membership_id]
        );
        if (!ownHold.length) {
          await connection.rollback();
          return res.status(400).json({ success: false, error: `Copy ${accessionNumber} is held for another patron.` });
        }
        linkedReservation = ownHold[0];
      } else if (copyRows[0].copy_status !== 'Available') {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          error: `Copy ${accessionNumber} is not available (Current status: ${copyRows[0].copy_status}).`
        });
      }
      if (isbn && String(isbn).trim() !== copyRows[0].isbn) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: `Accession ${accessionNumber.trim()} belongs to ISBN ${copyRows[0].isbn}, not ${String(isbn).trim()}.` });
      }
      selectedCopy = copyRows[0];
    } else {
      // Auto-select an available copy. If none exists, check whether this member owns a reserved hold.
      const [availCopies] = await connection.query(
        "SELECT * FROM book_copies WHERE isbn = ? AND copy_status = 'Available' LIMIT 1 FOR UPDATE",
        [isbn.trim()]
      );
      if (availCopies.length > 0) {
        selectedCopy = availCopies[0];
      } else {
        const [ownHold] = await connection.query(
          `SELECT c.*, r.reservation_id FROM reservations r
           JOIN book_copies c ON c.accession_number = r.held_accession_number
           WHERE r.membership_id = ? AND r.isbn = ? AND r.status = 'Active' AND r.held_accession_number IS NOT NULL
           AND c.copy_status = 'Reserved_Hold' LIMIT 1 FOR UPDATE`,
          [member.membership_id, isbn.trim()]
        );
        if (ownHold.length > 0) {
          selectedCopy = ownHold[0];
          const [reservationRows] = await connection.query('SELECT * FROM reservations WHERE reservation_id = ? FOR UPDATE', [ownHold[0].reservation_id]);
          linkedReservation = reservationRows[0] || null;
        } else {
          await connection.rollback();
          return res.status(400).json({
            success: false,
            reason: 'NO_COPIES_AVAILABLE',
            canReserve: true,
            error: 'No copies of this book are currently available for issue. Place a reservation or return when your held copy is ready.'
          });
        }
      }
    }

    // A linked approved request must match the specific title being issued.
    if (linkedRequest && String(linkedRequest.requested_isbn) !== String(selectedCopy.isbn)) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'The selected copy ISBN does not match the approved request ISBN.' });
    }

    // Fetch Book Title
    const [bookRows] = await connection.query(
      'SELECT isbn, title FROM book_titles WHERE isbn = ?',
      [selectedCopy.isbn]
    );
    const bookTitle = bookRows.length > 0 ? bookRows[0].title : 'Unknown Title';

    // 3. Compute Due Date from the approved/requested duration, within the member policy.
    const todayStr = localDateString();
    const dueDateStr = calculateDueDate(todayStr, member.member_type, loanDays);

    // 4. Atomic Execution (FR-Issue.Confirm-01)
    // (a) Create Loan record with status 'Issued'
    const [loanResult] = await connection.query(
      `INSERT INTO loans (membership_id, accession_number, isbn, issue_date, due_date, loan_status, issued_by)
       VALUES (?, ?, ?, ?, ?, 'Issued', ?)`,
      [
        member.membership_id,
        selectedCopy.accession_number,
        selectedCopy.isbn,
        todayStr,
        dueDateStr,
        req.session?.user?.id || null
      ]
    );

    // (b) Decrement available copies count for book title
    if (selectedCopy.copy_status === 'Available') {
      await connection.query(
        'UPDATE book_titles SET available_copies = GREATEST(0, available_copies - 1) WHERE isbn = ?',
        [selectedCopy.isbn]
      );
    }

    // (c) Update copy status to 'Issued'
    await connection.query(
      "UPDATE book_copies SET copy_status = 'Issued' WHERE accession_number = ?",
      [selectedCopy.accession_number]
    );

    // A held copy is fulfilled for the patron who owns that reservation.
    if (linkedReservation) {
      await connection.query(
        `UPDATE reservations SET status = 'Fulfilled', held_accession_number = NULL, hold_expires_at = NULL WHERE reservation_id = ?`,
        [linkedReservation.reservation_id]
      );
    }

    // Mark the linked request fulfilled only after all issue writes are ready to commit.
    if (linkedRequest) {
      await connection.query(
        `UPDATE book_requests SET request_status = 'Fulfilled', reviewed_by = ?, reviewed_at = NOW(),
         staff_note = COALESCE(staff_note, 'Issued from approved request') WHERE request_id = ?`,
        [req.session?.user?.id || null, linkedRequest.request_id]
      );
    }

    // Log transaction (SA-1)
    await connection.query(
      `INSERT INTO transaction_logs (action_type, performed_by, performed_by_name, membership_id, accession_number, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'ISSUE',
        req.session?.user?.id || null,
        req.session?.user?.fullName || 'Staff',
        member.membership_id,
        selectedCopy.accession_number,
        `Issued book "${bookTitle}" (Accession: ${selectedCopy.accession_number}) to ${member.name} (${member.membership_id}). Due: ${dueDateStr}`
      ]
    );

    await connection.commit();

    // FR-Issue.Receipt-01: Return on-screen confirmation receipt
    return res.status(201).json({
      success: true,
      message: 'Book issued successfully',
      receipt: {
        loanId: loanResult.insertId,
        bookTitle,
        isbn: selectedCopy.isbn,
        accessionNumber: selectedCopy.accession_number,
        memberName: member.name,
        membershipId: member.membership_id,
        memberType: member.member_type,
        issueDate: todayStr,
        dueDate: dueDateStr,
        loanDays
      }
    });
  } catch (error) {
    await connection.rollback(); // FR-Issue.Confirm-02: Rollback on any failure
    if (isRetryable(error)) throw error;
    console.error('Issue book error:', error);
    return res.status(500).json({ success: false, error: 'Database transaction error issuing book. Transaction rolled back.' });
  } finally {
    connection.release();
  }
};

// 2. Return Book (FR-Return.Locate-01 to 02, FR-Return.Process-01, FR-Return.Fine-01 to 02)
exports.returnBook = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      accessionNumber,
      loanId,
      flagAsDamaged = false,
      flagAsLost = false,
      payFineNow = false
    } = req.body;

    if (!accessionNumber && !loanId) {
      return res.status(400).json({
        success: false,
        error: 'Accession number or Loan ID is required to process return.'
      });
    }

    await connection.beginTransaction();

    // FR-Return.Locate-01: Locate active loan
    let querySql = `
      SELECT l.*, m.name as member_name, m.member_type, m.account_status, b.title as book_title
      FROM loans l
      JOIN members m ON l.membership_id = m.membership_id
      JOIN book_titles b ON l.isbn = b.isbn
      WHERE l.loan_status = 'Issued'
    `;
    let queryParams = [];

    // FOR UPDATE OF l: lock only the loan row here; the title row is locked next (fixed lock order).
    if (loanId) {
      querySql += ' AND l.loan_id = ? FOR UPDATE OF l';
      queryParams.push(loanId);
    } else {
      querySql += ' AND l.accession_number = ? FOR UPDATE OF l';
      queryParams.push(accessionNumber.trim());
    }

    const [loans] = await connection.query(querySql, queryParams);
    if (loans.length) await connection.query('SELECT isbn FROM book_titles WHERE isbn = ? FOR UPDATE', [loans[0].isbn]);

    // FR-Return.Locate-02: Check if active loan exists
    if (loans.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: 'No active loan found for this accession number/ID. The copy is not currently recorded as issued (FR-Return.Locate-02).'
      });
    }

    const loan = loans[0];
    const todayStr = localDateString();

    // Fetch fine rate & max cap from settings (BR-5, BR-6)
    const [rateRows] = await connection.query("SELECT setting_value FROM system_settings WHERE setting_key = 'fine_rate_per_day'");
    const [capRows] = await connection.query("SELECT setting_value FROM system_settings WHERE setting_key = 'max_fine_per_loan'");

    const fineRate = rateRows.length > 0 ? parseFloat(rateRows[0].setting_value) : 2.0;
    const maxFineCap = capRows.length > 0 ? parseFloat(capRows[0].setting_value) : 200.0;

    if (flagAsLost && flagAsDamaged) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'A copy cannot be flagged both Lost and Damaged.' });
    }

    // Calculate overdue fine. A lost copy is charged the per-loan maximum (BR-6: the book is treated as lost).
    let fineCalculation = calculateFine(loan.due_date, todayStr, fineRate, maxFineCap);
    if (flagAsLost) {
      fineCalculation = { ...fineCalculation, isOverdue: true, fineAmount: maxFineCap, isCapped: true };
    }
    let createdFineId = null;
    let paymentReceipt = null;

    if (fineCalculation.isOverdue && fineCalculation.fineAmount > 0) {
      // Create fine record
      const [fineResult] = await connection.query(
        `INSERT INTO fines (loan_id, membership_id, amount_charged, amount_paid, date_charged)
         VALUES (?, ?, ?, ?, NOW())`,
        [
          loan.loan_id,
          loan.membership_id,
          fineCalculation.fineAmount,
          payFineNow ? fineCalculation.fineAmount : 0.00
        ]
      );
      createdFineId = fineResult.insertId;

      if (payFineNow) {
        const receiptNo = `REC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await connection.query(
          `INSERT INTO fine_payments (fine_id, membership_id, amount, collected_by, receipt_number)
           VALUES (?, ?, ?, ?, ?)`,
          [
            createdFineId,
            loan.membership_id,
            fineCalculation.fineAmount,
            req.session?.user?.id || null,
            receiptNo
          ]
        );
        paymentReceipt = {
          receiptNumber: receiptNo,
          amountPaid: fineCalculation.fineAmount,
          remainingBalance: 0.00
        };
      }
    }

    // FR-Return.Process-01:
    // (a) set Loan record status to 'Returned' with actual return date
    await connection.query(
      `UPDATE loans
       SET loan_status = ?,
           return_date = ?,
           received_by = ?
       WHERE loan_id = ?`,
      [flagAsLost ? 'Lost' : 'Returned', todayStr, req.session?.user?.id || null, loan.loan_id]
    );

    // FR-Return.Condition-01: Check if flagged as damaged
    let finalCopyStatus = 'Available';
    let reservationNotified = null;

    if (flagAsLost) {
      finalCopyStatus = 'Lost';
      await connection.query(
        "UPDATE book_copies SET copy_status = 'Lost' WHERE accession_number = ?",
        [loan.accession_number]
      );
    } else if (flagAsDamaged) {
      finalCopyStatus = 'Damaged';
      // Does NOT increment available_copies, copy routed to Damaged
      await connection.query(
        "UPDATE book_copies SET copy_status = 'Damaged' WHERE accession_number = ?",
        [loan.accession_number]
      );
    } else {
      // Check active reservations (FR-Return.Reservation-01 & BR-7)
      const [reservations] = await connection.query(
        `SELECT r.*, m.name as patron_name, m.email 
         FROM reservations r
         JOIN members m ON r.membership_id = m.membership_id
         WHERE r.isbn = ? AND r.status = 'Active' AND r.held_accession_number IS NULL
         ORDER BY r.queue_position ASC, r.reservation_date ASC
         LIMIT 1 FOR UPDATE`,
        [loan.isbn]
      );

      if (reservations.length > 0) {
        const nextRes = reservations[0];
        // Flag copy as reserved hold for the configured period (default 48 hours, BR-7).
        finalCopyStatus = 'Reserved_Hold';
        await connection.query(
          "UPDATE book_copies SET copy_status = 'Reserved_Hold' WHERE accession_number = ?",
          [loan.accession_number]
        );

        const [holdSettingRows] = await connection.query(
          "SELECT setting_value FROM system_settings WHERE setting_key = 'reservation_hold_hours'"
        );
        const holdHours = holdSettingRows.length ? Math.max(1, Number(holdSettingRows[0].setting_value) || 48) : 48;
        // Update reservation with held accession number and expiry.
        const holdExpires = new Date(Date.now() + holdHours * 60 * 60 * 1000);
        await connection.query(
          `UPDATE reservations
           SET held_accession_number = ?,
               hold_expires_at = ?
           WHERE reservation_id = ?`,
          [loan.accession_number, holdExpires, nextRes.reservation_id]
        );

        reservationNotified = {
          reservationId: nextRes.reservation_id,
          patronName: nextRes.patron_name,
          membershipId: nextRes.membership_id,
          email: nextRes.email,
          holdHours,
          holdUntil: holdExpires.toISOString()
        };
      } else {
        // Return copy to general available inventory
        await connection.query(
          "UPDATE book_copies SET copy_status = 'Available' WHERE accession_number = ?",
          [loan.accession_number]
        );
        await connection.query(
          'UPDATE book_titles SET available_copies = available_copies + 1 WHERE isbn = ?',
          [loan.isbn]
        );
      }
    }

    // SA-1: Log return
    await connection.query(
      `INSERT INTO transaction_logs (action_type, performed_by, performed_by_name, membership_id, accession_number, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'RETURN',
        req.session?.user?.id || null,
        req.session?.user?.fullName || 'Staff',
        loan.membership_id,
        loan.accession_number,
        `Processed return of "${loan.book_title}" (Accession: ${loan.accession_number}). Overdue days: ${fineCalculation.daysOverdue}, Fine: Rs ${fineCalculation.fineAmount}. Copy Status: ${finalCopyStatus}`
      ]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: 'Book returned successfully',
      returnSummary: {
        loanId: loan.loan_id,
        bookTitle: loan.book_title,
        accessionNumber: loan.accession_number,
        memberName: loan.member_name,
        membershipId: loan.membership_id,
        issueDate: loan.issue_date,
        dueDate: loan.due_date,
        returnDate: todayStr,
        isOverdue: fineCalculation.isOverdue,
        daysOverdue: fineCalculation.daysOverdue,
        fineAmount: fineCalculation.fineAmount,
        fineId: createdFineId,
        finePaid: payFineNow,
        lost: !!flagAsLost,
        paymentReceipt,
        reservationHold: reservationNotified,
        copyStatus: finalCopyStatus
      }
    });
  } catch (error) {
    await connection.rollback();
    if (isRetryable(error)) throw error;
    console.error('Error returning book:', error);
    return res.status(500).json({ success: false, error: 'Database transaction error while returning book' });
  } finally {
    connection.release();
  }
};

// 3. Record Fine Payment (FR-Fine.Pay-01, Pay-02)
exports.payFine = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { fineId, amount } = req.body;
    const paymentAmount = parseFloat(amount);

    if (!fineId || isNaN(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Valid fine ID and payment amount are required' });
    }

    await connection.beginTransaction();

    const [fines] = await connection.query(
      `SELECT f.*, m.name as member_name 
       FROM fines f 
       JOIN members m ON f.membership_id = m.membership_id 
       WHERE f.fine_id = ? FOR UPDATE`,
      [fineId]
    );

    if (fines.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Fine record not found' });
    }

    const fine = fines[0];
    const outstanding = parseFloat(fine.amount_charged) - parseFloat(fine.amount_paid) - parseFloat(fine.waived_amount);

    if (paymentAmount > outstanding + 0.01) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: `Payment amount (Rs. ${paymentAmount}) cannot exceed outstanding fine (Rs. ${outstanding.toFixed(2)})`
      });
    }

    // Generate unique receipt number
    const receiptNumber = `RCP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Update fine record
    await connection.query(
      'UPDATE fines SET amount_paid = amount_paid + ? WHERE fine_id = ?',
      [paymentAmount, fineId]
    );

    // Record in fine_payments
    await connection.query(
      `INSERT INTO fine_payments (fine_id, membership_id, amount, collected_by, receipt_number)
       VALUES (?, ?, ?, ?, ?)`,
      [
        fineId,
        fine.membership_id,
        paymentAmount,
        req.session?.user?.id || null,
        receiptNumber
      ]
    );

    // SA-1: Log fine payment
    await connection.query(
      `INSERT INTO transaction_logs (action_type, performed_by, performed_by_name, membership_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'FINE_PAYMENT',
        req.session?.user?.id || null,
        req.session?.user?.fullName || 'Staff',
        fine.membership_id,
        `Collected payment of Rs. ${paymentAmount} for fine #${fineId}. Receipt: ${receiptNumber}`
      ]
    );

    await connection.commit();

    const remainingBalance = Math.max(0, outstanding - paymentAmount);

    // FR-Fine.Pay-02: Payment receipt
    return res.json({
      success: true,
      message: 'Payment recorded successfully',
      receipt: {
        receiptNumber,
        fineId,
        membershipId: fine.membership_id,
        memberName: fine.member_name,
        amountPaid: paymentAmount,
        paymentDate: new Date().toISOString(),
        remainingBalance: parseFloat(remainingBalance.toFixed(2))
      }
    });
  } catch (error) {
    await connection.rollback();
    if (isRetryable(error)) throw error;
    console.error('Pay fine error:', error);
    return res.status(500).json({ success: false, error: 'Transaction error recording fine payment' });
  } finally {
    connection.release();
  }
};

// 4. Waive Fine (Admin Only - FR-Fine.Waive-01, BR-8)
exports.waiveFine = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { fineId, waiveAmount, remark } = req.body;
    const amountToWaive = parseFloat(waiveAmount);

    if (!remark || !remark.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Mandatory remark/reason is required for waiving a fine (BR-8).'
      });
    }

    if (!fineId || isNaN(amountToWaive) || amountToWaive <= 0) {
      return res.status(400).json({ success: false, error: 'Valid fine ID and positive waive amount are required' });
    }

    await connection.beginTransaction();

    const [fines] = await connection.query(
      'SELECT * FROM fines WHERE fine_id = ? FOR UPDATE',
      [fineId]
    );

    if (fines.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Fine not found' });
    }

    const fine = fines[0];
    const outstanding = parseFloat(fine.amount_charged) - parseFloat(fine.amount_paid) - parseFloat(fine.waived_amount);

    if (amountToWaive > outstanding + 0.01) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: `Waive amount (Rs. ${amountToWaive}) cannot exceed outstanding fine (Rs. ${outstanding.toFixed(2)})`
      });
    }

    await connection.query(
      `UPDATE fines
       SET waived_amount = waived_amount + ?,
           waived_by = ?,
           waiver_remark = ?
       WHERE fine_id = ?`,
      [amountToWaive, req.session?.user?.id || null, remark.trim(), fineId]
    );

    // Audit log (BR-8, SA-1)
    await connection.query(
      `INSERT INTO transaction_logs (action_type, performed_by, performed_by_name, membership_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'FINE_WAIVE',
        req.session?.user?.id || null,
        req.session?.user?.fullName || 'Administrator',
        fine.membership_id,
        `Waived fine amount of Rs. ${amountToWaive} for fine #${fineId}. Reason: ${remark.trim()}`
      ]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: `Fine waiver of Rs. ${amountToWaive.toFixed(2)} applied successfully.`
    });
  } catch (error) {
    await connection.rollback();
    if (isRetryable(error)) throw error;
    console.error('Waive fine error:', error);
    return res.status(500).json({ success: false, error: 'Failed to waive fine' });
  } finally {
    connection.release();
  }
};

// 5. Reserve Book (FR-Reserve.Create-01, 02, Queue-01)
exports.createReservation = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { isbn } = req.body;
    const membershipId = req.session?.user?.membershipId || req.body.membershipId;

    if (!isbn || !membershipId) {
      return res.status(400).json({ success: false, error: 'ISBN and Membership ID are required' });
    }

    await connection.beginTransaction();

    // Only an active patron record can be queued for a book.
    const [memberRows] = await connection.query(
      'SELECT membership_id, account_status FROM members WHERE membership_id = ? FOR UPDATE',
      [membershipId]
    );
    if (!memberRows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Member account not found.' });
    }
    if (memberRows[0].account_status !== 'Active') {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Inactive members cannot place reservations.' });
    }

    // Check title and availability (FR-Reserve.Create-01)
    const [bookRows] = await connection.query(
      'SELECT isbn, title, available_copies, total_copies FROM book_titles WHERE isbn = ? FOR UPDATE',
      [isbn]
    );

    if (bookRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Book not found' });
    }

    if (bookRows[0].available_copies > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'Reservation is only permitted when all copies are currently unavailable (FR-Reserve.Create-01). You can borrow this book directly at the desk.'
      });
    }

    // FR-Reserve.Create-02: Reject if member already has active reservation for this book
    const [existingRes] = await connection.query(
      "SELECT reservation_id FROM reservations WHERE membership_id = ? AND isbn = ? AND status = 'Active'",
      [membershipId, isbn]
    );

    if (existingRes.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'You already have an active reservation for this book (FR-Reserve.Create-02).'
      });
    }

    // Determine Queue Position (FR-Reserve.Queue-01)
    const [queueRows] = await connection.query(
      "SELECT COALESCE(MAX(queue_position), 0) AS lastPosition FROM reservations WHERE isbn = ? AND status = 'Active'",
      [isbn]
    );
    const queuePosition = Number(queueRows[0].lastPosition || 0) + 1;
    const [[{ waiting }]] = await connection.query(
      "SELECT COUNT(*) AS waiting FROM reservations WHERE isbn = ? AND status = 'Active' AND held_accession_number IS NULL",
      [isbn]
    );
    const livePosition = Number(waiting) + 1;

    const [resResult] = await connection.query(
      `INSERT INTO reservations (membership_id, isbn, queue_position, reservation_date, status)
       VALUES (?, ?, ?, NOW(), 'Active')`,
      [membershipId, isbn, queuePosition]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Book reserved successfully',
      reservation: {
        reservationId: resResult.insertId,
        isbn,
        bookTitle: bookRows[0].title,
        queuePosition: livePosition,
        status: 'Active'
      }
    });
  } catch (error) {
    await connection.rollback();
    if (isRetryable(error)) throw error;
    console.error('Reservation error:', error);
    return res.status(500).json({ success: false, error: 'Database error creating reservation' });
  } finally {
    connection.release();
  }
};

// 6. Cancel Reservation (FR-Reserve.Cancel-01), releasing any held copy safely.
exports.cancelReservation = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const reservationId = Number(req.params.reservationId);
    const user = req.session?.user;
    if (!Number.isInteger(reservationId) || reservationId < 1) {
      return res.status(400).json({ success: false, error: 'Invalid reservation ID.' });
    }
    await connection.beginTransaction();
    let sql = `SELECT * FROM reservations WHERE reservation_id = ? AND status = 'Active'`;
    const params = [reservationId];
    if (user?.role === 'Patron') { sql += ' AND membership_id = ?'; params.push(user.membershipId); }
    const [rows] = await connection.query(`${sql} FOR UPDATE`, params);
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Active reservation not found, or it does not belong to your account.' });
    }
    const reservation = rows[0];
    await connection.query(
      "UPDATE reservations SET status = 'Cancelled', held_accession_number = NULL, hold_expires_at = NULL WHERE reservation_id = ?",
      [reservationId]
    );

    if (reservation.held_accession_number) {
      const [copies] = await connection.query(
        'SELECT accession_number, copy_status FROM book_copies WHERE accession_number = ? FOR UPDATE',
        [reservation.held_accession_number]
      );
      if (copies.length && copies[0].copy_status === 'Reserved_Hold') {
        const [nextRows] = await connection.query(
          `SELECT reservation_id FROM reservations
           WHERE isbn = ? AND status = 'Active' AND held_accession_number IS NULL
           ORDER BY reservation_date ASC, reservation_id ASC LIMIT 1 FOR UPDATE`,
          [reservation.isbn]
        );
        const [holdRows] = await connection.query(
          "SELECT setting_value FROM system_settings WHERE setting_key = 'reservation_hold_hours'"
        );
        const holdHours = holdRows.length ? Math.max(1, Number(holdRows[0].setting_value) || 48) : 48;
        if (nextRows.length) {
          const expiresAt = new Date(Date.now() + holdHours * 60 * 60 * 1000);
          await connection.query(
            'UPDATE reservations SET held_accession_number = ?, hold_expires_at = ? WHERE reservation_id = ?',
            [reservation.held_accession_number, expiresAt, nextRows[0].reservation_id]
          );
        } else {
          await connection.query("UPDATE book_copies SET copy_status = 'Available' WHERE accession_number = ?", [reservation.held_accession_number]);
          await connection.query('UPDATE book_titles SET available_copies = available_copies + 1 WHERE isbn = ?', [reservation.isbn]);
        }
      }
    }
    await connection.commit();
    return res.json({ success: true, message: 'Reservation cancelled successfully.' });
  } catch (error) {
    await connection.rollback();
    if (isRetryable(error)) throw error;
    console.error('Cancel reservation error:', error);
    return res.status(500).json({ success: false, error: 'Failed to cancel reservation' });
  } finally {
    connection.release();
  }
};

// 7. Reservation queue visible to staff, with computed queue positions and hold status.
exports.getReservationQueue = async (req, res) => {
  try {
    const { q, status = 'Active' } = req.query;
    const allowed = ['Active', 'Fulfilled', 'Cancelled', 'Expired', 'All'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, error: 'Invalid reservation status filter.' });
    const clauses = [];
    const params = [];
    if (status !== 'All') { clauses.push('r.status = ?'); params.push(status); }
    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      clauses.push('(r.isbn LIKE ? OR b.title LIKE ? OR m.name LIKE ? OR m.membership_id LIKE ?)');
      params.push(term, term, term, term);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT r.reservation_id, r.membership_id, m.name AS member_name, m.member_type, m.email,
              r.isbn, b.title AS book_title, r.queue_position, r.reservation_date, r.status,
              r.held_accession_number, r.hold_expires_at,
              CASE WHEN r.status = 'Active' AND r.held_accession_number IS NULL THEN
                (SELECT COUNT(*) + 1 FROM reservations earlier WHERE earlier.isbn = r.isbn AND earlier.status = 'Active'
                 AND earlier.held_accession_number IS NULL AND (earlier.reservation_date < r.reservation_date OR (earlier.reservation_date = r.reservation_date AND earlier.reservation_id < r.reservation_id)))
                ELSE NULL END AS live_queue_position
       FROM reservations r JOIN members m ON m.membership_id = r.membership_id
       JOIN book_titles b ON b.isbn = r.isbn
       ${where}
       ORDER BY CASE WHEN r.status = 'Active' THEN 0 ELSE 1 END, r.isbn, r.queue_position, r.reservation_date`,
      params
    );
    return res.json({ success: true, reservations: rows });
  } catch (error) {
    console.error('Get reservation queue error:', error);
    return res.status(500).json({ success: false, error: 'Unable to retrieve reservation queue.' });
  }
};

// 8. Get All Active Loans (Circulation Desk table)
exports.getActiveLoans = async (req, res) => {
  try {
    const { q, overdueOnly } = req.query;
    let whereClauses = ["l.loan_status = 'Issued'"];
    let params = [];

    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      whereClauses.push('(l.accession_number LIKE ? OR m.membership_id LIKE ? OR m.name LIKE ? OR b.title LIKE ?)');
      params.push(term, term, term, term);
    }

    if (overdueOnly === 'true') {
      whereClauses.push('l.due_date < CURDATE()');
    }

    const [loans] = await pool.query(
      `SELECT l.*, m.name as member_name, m.member_type, m.phone, m.email, b.title as book_title,
              DATEDIFF(CURDATE(), l.due_date) as days_overdue
       FROM loans l
       JOIN members m ON l.membership_id = m.membership_id
       JOIN book_titles b ON l.isbn = b.isbn
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY l.due_date ASC`,
      params
    );

    return res.json({ success: true, loans });
  } catch (error) {
    console.error('Get active loans error:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve active loans' });
  }
};

// 9. Issue preview (FR-Issue.DueDate-01, FR-Issue.Eligibility-01..03):
// shows member eligibility and the computed due date to the Librarian BEFORE confirming.
exports.previewIssue = async (req, res) => {
  try {
    const membershipId = String(req.query.membershipId || '').trim();
    if (!membershipId) return res.status(400).json({ success: false, error: 'Membership ID is required.' });
    const [members] = await pool.query('SELECT * FROM members WHERE membership_id = ?', [membershipId]);
    if (!members.length) return res.status(404).json({ success: false, error: 'No member found with that Membership ID.' });
    const member = members[0];

    const policyKey = member.member_type === 'Faculty' ? 'faculty_loan_days' : 'student_loan_days';
    const [policyRows] = await pool.query(
      "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, 'fine_block_threshold')",
      [policyKey]
    );
    const cfg = Object.fromEntries(policyRows.map((r) => [r.setting_key, Number(r.setting_value)]));
    const maxLoanDays = Number.isFinite(cfg[policyKey]) ? cfg[policyKey] : (member.member_type === 'Faculty' ? 30 : 14);
    const threshold = Number.isFinite(cfg.fine_block_threshold) ? cfg.fine_block_threshold : 100;

    const [[{ activeCount }]] = await pool.query(
      "SELECT COUNT(*) AS activeCount FROM loans WHERE membership_id = ? AND loan_status = 'Issued'", [membershipId]
    );
    const [[{ unpaidFine }]] = await pool.query(
      'SELECT COALESCE(SUM(GREATEST(amount_charged - amount_paid - waived_amount, 0)), 0) AS unpaidFine FROM fines WHERE membership_id = ?',
      [membershipId]
    );
    const outstanding = Number(unpaidFine);

    let days = maxLoanDays;
    const raw = req.query.requestedDays;
    if (raw !== undefined && raw !== '') {
      const parsed = Number(raw);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= maxLoanDays) days = parsed;
    }

    const reasons = [];
    if (member.account_status !== 'Active') reasons.push('Account is Inactive.');
    if (activeCount >= member.borrowing_limit) reasons.push(`Borrowing limit reached (${activeCount} / ${member.borrowing_limit}).`);
    if (outstanding > threshold) reasons.push(`Outstanding fine Rs. ${outstanding.toFixed(2)} exceeds the Rs. ${threshold.toFixed(2)} threshold.`);

    return res.json({
      success: true,
      member: {
        membershipId: member.membership_id, name: member.name, memberType: member.member_type,
        accountStatus: member.account_status, borrowingLimit: member.borrowing_limit,
        activeLoans: activeCount, outstandingFine: outstanding
      },
      policy: { maxLoanDays, fineBlockThreshold: threshold },
      loanDays: days,
      dueDate: calculateDueDate(localDateString(), member.member_type, days),
      eligible: reasons.length === 0,
      reasons
    });
  } catch (error) {
    console.error('Issue preview error:', error);
    return res.status(500).json({ success: false, error: 'Unable to preview issue.' });
  }
};

// Transparent retry if MySQL aborts one of two competing transactions (deadlock / lock wait timeout).
for (const name of ['issueBook', 'returnBook', 'payFine', 'waiveFine', 'createReservation', 'cancelReservation']) {
  exports[name] = withDeadlockRetry(exports[name]);
}
