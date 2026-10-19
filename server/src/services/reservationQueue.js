/**
 * Shared reservation-queue helpers. All functions take an open transaction
 * connection so callers keep inventory counts and holds atomic.
 */

async function getHoldHours(connection) {
  const [rows] = await connection.query(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'reservation_hold_hours'"
  );
  return rows.length ? Math.max(1, Number(rows[0].setting_value) || 48) : 48;
}

/**
 * Offer every currently Available copy of a title to the waiting reservations
 * (FIFO). Used when new copies are added or a Lost/Damaged copy is restored, so
 * a queue never sits idle next to a free copy (FR-Reserve.Hold-01, BR-7).
 * Returns the reservations that received a hold.
 */
async function assignFreeCopiesToQueue(connection, isbn) {
  const holdHours = await getHoldHours(connection);
  const assigned = [];
  const [copies] = await connection.query(
    "SELECT accession_number FROM book_copies WHERE isbn = ? AND copy_status = 'Available' ORDER BY accession_number FOR UPDATE",
    [isbn]
  );
  for (const copy of copies) {
    const [waiting] = await connection.query(
      `SELECT reservation_id, membership_id FROM reservations
       WHERE isbn = ? AND status = 'Active' AND held_accession_number IS NULL
       ORDER BY reservation_date ASC, reservation_id ASC LIMIT 1 FOR UPDATE`,
      [isbn]
    );
    if (!waiting.length) break;
    const expiresAt = new Date(Date.now() + holdHours * 60 * 60 * 1000);
    await connection.query(
      "UPDATE book_copies SET copy_status = 'Reserved_Hold' WHERE accession_number = ?",
      [copy.accession_number]
    );
    await connection.query(
      'UPDATE book_titles SET available_copies = GREATEST(0, available_copies - 1) WHERE isbn = ?',
      [isbn]
    );
    await connection.query(
      'UPDATE reservations SET held_accession_number = ?, hold_expires_at = ? WHERE reservation_id = ?',
      [copy.accession_number, expiresAt, waiting[0].reservation_id]
    );
    assigned.push({ reservationId: waiting[0].reservation_id, membershipId: waiting[0].membership_id, accessionNumber: copy.accession_number });
  }
  return assigned;
}

module.exports = { getHoldHours, assignFreeCopiesToQueue };
