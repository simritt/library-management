const { pool } = require('../config/db');
const { validateISBN } = require('../utils/isbnValidator');
const { assignFreeCopiesToQueue } = require('../services/reservationQueue');
const { isRetryable, withDeadlockRetry } = require('../utils/txRetry');

/**
 * Catalog Controller
 * Covers Module 1 (Catalog Management) & Module 2 (Search & Availability)
 * Strictly fulfills:
 * FR-Catalog.Add-01, Add-02, Add-03, Add-04
 * FR-Catalog.Update-01, Update-02
 * FR-Catalog.Remove-01, Remove-02, Remove-03
 * FR-Catalog.View-01
 * FR-Search.Query-01, Query-02, Filter-01, Detail-01, Sort-01
 */

// Search / Browse Catalog (Public & Staff)
exports.getBooks = async (req, res) => {
  try {
    const {
      q,              // general search query (title, author, ISBN, keyword)
      category,       // category filter
      availableOnly,  // 'true' or 'false'
      sortBy = 'title', // 'title', 'author', 'year'
      order = 'ASC',  // 'ASC' or 'DESC'
      page = 1,
      limit = 12
    } = req.query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const validLimit = Math.max(1, Math.min(50, parseInt(limit, 10)));
    const validOffset = Math.max(0, offset);

    let whereClauses = [];
    let params = [];

    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      whereClauses.push('(b.title LIKE ? OR b.author LIKE ? OR b.isbn LIKE ? OR b.publisher LIKE ? OR b.category LIKE ?)');
      params.push(term, term, term, term, term);
    }

    if (category && category !== 'All') {
      whereClauses.push('b.category = ?');
      params.push(category);
    }

    if (availableOnly === 'true') {
      whereClauses.push('b.available_copies > 0');
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Determine sort column
    let orderColumn = 'b.title';
    if (sortBy === 'author') orderColumn = 'b.author';
    if (sortBy === 'year') orderColumn = 'b.publication_year';
    const sortDir = order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    // Count total matching
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM book_titles b ${whereSql}`,
      params
    );
    const total = countRows[0].total;

    // Fetch books with earliest return date if 0 available (FR-Search.Detail-01)
    const [books] = await pool.query(
      `SELECT b.*,
        (SELECT MIN(l.due_date) 
         FROM loans l 
         JOIN book_copies c ON l.accession_number = c.accession_number 
         WHERE c.isbn = b.isbn AND l.loan_status = 'Issued'
        ) AS earliest_expected_return
       FROM book_titles b
       ${whereSql}
       ORDER BY ${orderColumn} ${sortDir}
       LIMIT ? OFFSET ?`,
      [...params, validLimit, validOffset]
    );

    return res.json({
      success: true,
      data: books,
      pagination: {
        page: parseInt(page, 10),
        limit: validLimit,
        total,
        totalPages: Math.ceil(total / validLimit)
      }
    });
  } catch (error) {
    console.error('Error in getBooks:', error);
    return res.status(500).json({ success: false, error: 'Failed to retrieve catalog books' });
  }
};

// Get Single Book by ISBN with Copies and Earliest Due Date
exports.getBookByIsbn = async (req, res) => {
  try {
    const { isbn } = req.params;
    const [rows] = await pool.query(
      `SELECT b.*,
        (SELECT MIN(l.due_date) 
         FROM loans l 
         JOIN book_copies c ON l.accession_number = c.accession_number 
         WHERE c.isbn = b.isbn AND l.loan_status = 'Issued'
        ) AS earliest_expected_return
       FROM book_titles b
       WHERE b.isbn = ?`,
      [isbn]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Book not found' });
    }

    const book = rows[0];

    // Fetch individual copies
    const [copies] = await pool.query(
      `SELECT c.accession_number, c.isbn, c.copy_status, c.created_at,
              l.loan_id, l.membership_id, l.issue_date, l.due_date, m.name as borrower_name
       FROM book_copies c
       LEFT JOIN loans l ON c.accession_number = l.accession_number AND l.loan_status = 'Issued'
       LEFT JOIN members m ON l.membership_id = m.membership_id
       WHERE c.isbn = ?
       ORDER BY c.accession_number ASC`,
      [isbn]
    );

    // Borrower identity is staff-only (SE-6, OR-3). Public/patron callers only see the due date.
    const role = req.session?.user?.role;
    const isStaff = role === 'Librarian' || role === 'Administrator';
    const visibleCopies = isStaff ? copies : copies.map(({ loan_id, membership_id, issue_date, borrower_name, ...safe }) => safe);

    return res.json({
      success: true,
      book,
      copies: visibleCopies
    });
  } catch (error) {
    console.error('Error fetching book detail:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// Add New Book Title and Copies (FR-Catalog.Add-01 to 04)
exports.addBook = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      isbn,
      title,
      author,
      category,
      publisher,
      edition,
      publicationYear,
      copiesCount = 1
    } = req.body;

    // Validate mandatory attributes
    if (!title || !author || !isbn || !category || !publisher || !edition) {
      return res.status(400).json({
        success: false,
        error: 'Mandatory fields: title, author, isbn, category, publisher, edition are required'
      });
    }

    // ISBN Checksum validation (FR-Catalog.Add-02)
    const isbnCheck = validateISBN(isbn);
    if (!isbnCheck.valid) {
      return res.status(400).json({
        success: false,
        error: isbnCheck.error
      });
    }
    const cleanIsbnValue = isbnCheck.cleaned;

    const count = parseInt(copiesCount, 10);
    if (isNaN(count) || count < 1) {
      return res.status(400).json({
        success: false,
        error: 'Number of copies must be a positive integer (minimum 1)'
      });
    }

    await connection.beginTransaction();

    // Check duplicate ISBN (FR-Catalog.Add-03)
    const [existing] = await connection.query('SELECT isbn, title FROM book_titles WHERE isbn = ?', [cleanIsbnValue]);
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        isDuplicate: true,
        error: `Book with ISBN ${cleanIsbnValue} already exists ("${existing[0].title}"). Please add more copies to the existing title instead of creating a new record.`
      });
    }

    // Insert book title
    await connection.query(
      `INSERT INTO book_titles (isbn, title, author, category, publisher, edition, publication_year, total_copies, available_copies)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanIsbnValue,
        title.trim(),
        author.trim(),
        category.trim(),
        publisher.trim(),
        edition.trim(),
        publicationYear ? parseInt(publicationYear, 10) : new Date().getFullYear(),
        count,
        count
      ]
    );

    // Generate unique Accession Numbers for each copy (FR-Catalog.Add-04)
    const insertedAccessions = [];
    for (let i = 1; i <= count; i++) {
      const padNum = String(i).padStart(3, '0');
      const accessionNumber = `ACC-${cleanIsbnValue}-${padNum}`;
      await connection.query(
        'INSERT INTO book_copies (accession_number, isbn, copy_status) VALUES (?, ?, ?)',
        [accessionNumber, cleanIsbnValue, 'Available']
      );
      insertedAccessions.push(accessionNumber);
    }

    // Log action (SA-1)
    await connection.query(
      `INSERT INTO transaction_logs (action_type, performed_by, performed_by_name, details)
       VALUES (?, ?, ?, ?)`,
      [
        'COPY_STATUS_CHANGE',
        req.session?.user?.id || null,
        req.session?.user?.fullName || 'System',
        `Added new book title "${title.trim()}" (ISBN: ${cleanIsbnValue}) with ${count} copies.`
      ]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'Book title and copies successfully registered',
      isbn: cleanIsbnValue,
      accessionNumbers: insertedAccessions
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error adding book:', error);
    return res.status(500).json({ success: false, error: 'Database transaction error while adding book' });
  } finally {
    connection.release();
  }
};

// Add Copies to Existing Book Title
exports.addCopies = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { isbn } = req.params;
    const { count = 1 } = req.body;
    const numCopies = parseInt(count, 10);

    if (isNaN(numCopies) || numCopies < 1) {
      return res.status(400).json({ success: false, error: 'Count must be at least 1' });
    }

    await connection.beginTransaction();

    const [bookRows] = await connection.query('SELECT isbn, title, total_copies, available_copies FROM book_titles WHERE isbn = ? FOR UPDATE', [isbn]);
    if (bookRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Book not found' });
    }

    // Get current maximum copy index for this ISBN
    const [copies] = await connection.query('SELECT accession_number FROM book_copies WHERE isbn = ?', [isbn]);
    let maxIdx = copies.reduce((max, c) => {
      const n = parseInt(String(c.accession_number).split('-').pop(), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, copies.length);

    const newAccessions = [];
    for (let i = 1; i <= numCopies; i++) {
      maxIdx++;
      const accessionNumber = `ACC-${isbn}-${String(maxIdx).padStart(3, '0')}`;
      await connection.query(
        'INSERT INTO book_copies (accession_number, isbn, copy_status) VALUES (?, ?, ?)',
        [accessionNumber, isbn, 'Available']
      );
      newAccessions.push(accessionNumber);
    }

    // Update book totals
    await connection.query(
      'UPDATE book_titles SET total_copies = total_copies + ?, available_copies = available_copies + ? WHERE isbn = ?',
      [numCopies, numCopies, isbn]
    );

    // Serve any waiting reservations from the newly available copies (FR-Reserve.Hold-01)
    const holds = await assignFreeCopiesToQueue(connection, isbn);

    await connection.query(
      `INSERT INTO transaction_logs (action_type, performed_by, performed_by_name, details)
       VALUES ('COPY_STATUS_CHANGE', ?, ?, ?)`,
      [req.session?.user?.id || null, req.session?.user?.fullName || 'Staff',
        `Added ${numCopies} copies to "${bookRows[0].title}" (ISBN: ${isbn}): ${newAccessions.join(', ')}.`]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: `Successfully added ${numCopies} copies`,
      accessionNumbers: newAccessions,
      reservationHolds: holds
    });
  } catch (error) {
    await connection.rollback();
    if (isRetryable(error)) throw error;
    console.error('Error adding copies:', error);
    return res.status(500).json({ success: false, error: 'Failed to add copies' });
  } finally {
    connection.release();
  }
};

// Update Book Details (FR-Catalog.Update-01, FR-Catalog.Update-02)
exports.updateBook = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { isbn } = req.params;
    const { title, author, category, publisher, edition, publicationYear, newIsbn } = req.body;
    const clean = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT isbn FROM book_titles WHERE isbn = ? FOR UPDATE', [isbn]);
    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Book title not found' });
    }

    let targetIsbn = isbn;
    if (newIsbn && String(newIsbn).trim() !== isbn) {
      // FR-Catalog.Update-02: ISBN is locked once any copy has been issued.
      const [loanCheck] = await connection.query('SELECT loan_id FROM loans WHERE isbn = ? LIMIT 1', [isbn]);
      if (loanCheck.length > 0) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          error: 'ISBN cannot be modified once copies of this book have been issued. A new title record must be created instead (FR-Catalog.Update-02).'
        });
      }
      const check = validateISBN(newIsbn);
      if (!check.valid) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: check.error });
      }
      const [dupe] = await connection.query('SELECT isbn FROM book_titles WHERE isbn = ?', [check.cleaned]);
      if (dupe.length) {
        await connection.rollback();
        return res.status(409).json({ success: false, error: `ISBN ${check.cleaned} already belongs to another catalogue record.` });
      }
      await connection.query('UPDATE book_titles SET isbn = ? WHERE isbn = ?', [check.cleaned, isbn]); // FKs cascade
      targetIsbn = check.cleaned;
    }

    let year = null;
    if (publicationYear !== undefined && publicationYear !== null && String(publicationYear).trim() !== '') {
      year = parseInt(publicationYear, 10);
      if (!Number.isInteger(year) || year < 1000 || year > new Date().getFullYear() + 1) {
        await connection.rollback();
        return res.status(400).json({ success: false, error: 'Publication year is not valid.' });
      }
    }

    await connection.query(
      `UPDATE book_titles
       SET title = COALESCE(?, title), author = COALESCE(?, author), category = COALESCE(?, category),
           publisher = COALESCE(?, publisher), edition = COALESCE(?, edition),
           publication_year = COALESCE(?, publication_year)
       WHERE isbn = ?`,
      [clean(title), clean(author), clean(category), clean(publisher), clean(edition), year, targetIsbn]
    );
    await connection.commit();

    return res.json({ success: true, message: 'Book details updated successfully', isbn: targetIsbn });
  } catch (error) {
    await connection.rollback();
    console.error('Error updating book:', error);
    return res.status(500).json({ success: false, error: 'Failed to update book' });
  } finally {
    connection.release();
  }
};

// Mark Copy as Lost or Damaged (FR-Catalog.Remove-01, Remove-02, Remove-03)
exports.updateCopyStatus = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { accessionNumber } = req.params;
    const { status, remarks } = req.body; // status in ['Lost', 'Damaged', 'Available']

    if (!['Lost', 'Damaged', 'Available'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid copy status. Must be "Lost", "Damaged", or "Available".'
      });
    }

    await connection.beginTransaction();

    const [copies] = await connection.query(
      'SELECT accession_number, isbn, copy_status FROM book_copies WHERE accession_number = ? FOR UPDATE',
      [accessionNumber]
    );

    if (copies.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Accession number not found' });
    }

    const copy = copies[0];

    // FR-Catalog.Remove-02: The system shall prevent removal of a book copy that is currently on loan (status = "Issued")
    if (copy.copy_status === 'Issued') {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'Cannot mark or retire a copy that is currently on loan (status = "Issued"). It must be processed through the return or fine-resolution workflow first (FR-Catalog.Remove-02).'
      });
    }

    const previousStatus = copy.copy_status;
    if (previousStatus === status) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: `Copy is already marked ${status}.` });
    }
    await connection.query(
      'UPDATE book_copies SET copy_status = ? WHERE accession_number = ?',
      [status, accessionNumber]
    );

    // A copy held for a reservation cannot be retired silently: release the hold so the patron keeps their queue place.
    if (previousStatus === 'Reserved_Hold') {
      await connection.query(
        "UPDATE reservations SET held_accession_number = NULL, hold_expires_at = NULL WHERE held_accession_number = ? AND status = 'Active'",
        [accessionNumber]
      );
      if (status === 'Available') {
        await connection.query('UPDATE book_titles SET available_copies = available_copies + 1 WHERE isbn = ?', [copy.isbn]);
      }
    }

    // FR-Catalog.Remove-03: When a copy is marked "Lost" or "Damaged", decrement available copies count
    if (previousStatus === 'Available' && (status === 'Lost' || status === 'Damaged')) {
      await connection.query(
        'UPDATE book_titles SET available_copies = GREATEST(0, available_copies - 1) WHERE isbn = ?',
        [copy.isbn]
      );
    } else if ((previousStatus === 'Lost' || previousStatus === 'Damaged') && status === 'Available') {
      await connection.query(
        'UPDATE book_titles SET available_copies = available_copies + 1 WHERE isbn = ?',
        [copy.isbn]
      );
    }

    if (status === 'Available') await assignFreeCopiesToQueue(connection, copy.isbn);

    // Log the transaction
    await connection.query(
      `INSERT INTO transaction_logs (action_type, performed_by, performed_by_name, accession_number, details)
       VALUES (?, ?, ?, ?, ?)`,
      [
        'COPY_STATUS_CHANGE',
        req.session?.user?.id || null,
        req.session?.user?.fullName || 'Staff',
        accessionNumber,
        `Changed copy status from ${previousStatus} to ${status}. Remark: ${remarks || 'None'}`
      ]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: `Copy ${accessionNumber} status updated to ${status}`
    });
  } catch (error) {
    await connection.rollback();
    if (isRetryable(error)) throw error;
    console.error('Error updating copy status:', error);
    return res.status(500).json({ success: false, error: 'Failed to update copy status' });
  } finally {
    connection.release();
  }
};

// Get List of Categories for Dropdown Filters
exports.getCategories = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT DISTINCT category FROM book_titles ORDER BY category ASC');
    const categories = rows.map(r => r.category).filter(Boolean);
    return res.json({ success: true, categories });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
};

for (const name of ['addCopies', 'updateCopyStatus']) {
  exports[name] = withDeadlockRetry(exports[name]);
}
