const { pool } = require('../config/db');

/**
 * Release expired reservation holds. If another active reservation is waiting,
 * the same physical copy is transferred to the next patron for a fresh hold.
 * The function is safe to call more than once and keeps inventory counts atomic.
 */
async function sweepExpiredReservationHolds() {
  const connection = await pool.getConnection();
  let processed = 0;
  try {
    await connection.beginTransaction();
    const [expired] = await connection.query(
      `SELECT reservation_id, isbn, held_accession_number
       FROM reservations
       WHERE status = 'Active' AND held_accession_number IS NOT NULL AND hold_expires_at IS NOT NULL AND hold_expires_at <= NOW()
       ORDER BY hold_expires_at ASC FOR UPDATE`
    );
    if (!expired.length) {
      await connection.commit();
      return { processed: 0 };
    }

    const [holdSetting] = await connection.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'reservation_hold_hours'"
    );
    const holdHours = holdSetting.length ? Math.max(1, Number(holdSetting[0].setting_value) || 48) : 48;

    for (const row of expired) {
      const [copyRows] = await connection.query(
        'SELECT accession_number, isbn, copy_status FROM book_copies WHERE accession_number = ? FOR UPDATE',
        [row.held_accession_number]
      );
      await connection.query(
        "UPDATE reservations SET status = 'Expired', held_accession_number = NULL, hold_expires_at = NULL WHERE reservation_id = ?",
        [row.reservation_id]
      );
      if (!copyRows.length || copyRows[0].copy_status !== 'Reserved_Hold') {
        processed += 1;
        continue;
      }

      const [nextRows] = await connection.query(
        `SELECT reservation_id FROM reservations
         WHERE isbn = ? AND status = 'Active' AND held_accession_number IS NULL
         ORDER BY reservation_date ASC, reservation_id ASC LIMIT 1 FOR UPDATE`,
        [row.isbn]
      );

      if (nextRows.length) {
        const expiresAt = new Date(Date.now() + holdHours * 60 * 60 * 1000);
        await connection.query(
          'UPDATE reservations SET held_accession_number = ?, hold_expires_at = ? WHERE reservation_id = ?',
          [row.held_accession_number, expiresAt, nextRows[0].reservation_id]
        );
        // Copy remains Reserved_Hold and available_copies remains unchanged.
      } else {
        await connection.query(
          "UPDATE book_copies SET copy_status = 'Available' WHERE accession_number = ?",
          [row.held_accession_number]
        );
        await connection.query(
          'UPDATE book_titles SET available_copies = available_copies + 1 WHERE isbn = ?',
          [row.isbn]
        );
      }
      processed += 1;
    }
    await connection.commit();
    return { processed };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { sweepExpiredReservationHolds };
