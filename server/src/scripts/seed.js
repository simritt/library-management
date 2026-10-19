const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

async function seedDatabase() {
  const connection = await pool.getConnection();
  try {
    console.log('--- Starting OLMS Database Seeding ---');
    await connection.beginTransaction();

    // 1. Seed System Settings
    const settings = [
      ['fine_rate_per_day', '2.00', 'Overdue fine rate per day per book in INR (BR-5)'],
      ['max_fine_per_loan', '200.00', 'Maximum cap on fine per individual loan in INR (BR-6)'],
      ['fine_block_threshold', '100.00', 'Outstanding fine balance threshold above which borrowing is blocked in INR (BR-4)'],
      ['student_loan_days', '14', 'Loan duration for students in days (BR-2)'],
      ['faculty_loan_days', '30', 'Loan duration for faculty in days (BR-2)'],
      ['student_borrow_limit', '3', 'Default borrowing limit for students (BR-1)'],
      ['faculty_borrow_limit', '8', 'Default borrowing limit for faculty (BR-1)'],
      ['reservation_hold_hours', '48', 'Hours to hold returned copy for reserving member (BR-7)']
    ];

    for (const [k, v, desc] of settings) {
      await connection.query(
        'INSERT INTO system_settings (setting_key, setting_value, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
        [k, v, desc]
      );
    }
    console.log('✓ System Settings seeded');

    // 2. Staff Accounts (Administrator and Librarian)
    const adminPassHash = await bcrypt.hash('Admin@123', 10);
    const libPassHash = await bcrypt.hash('Librarian@123', 10);

    await connection.query(
      `INSERT INTO users (username, password_hash, full_name, email, role)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), full_name = VALUES(full_name), role = VALUES(role)`,
      ['admin', adminPassHash, 'Chief Librarian Admin', 'admin@library.spit.ac.in', 'Administrator']
    );

    await connection.query(
      `INSERT INTO users (username, password_hash, full_name, email, role)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), full_name = VALUES(full_name), role = VALUES(role)`,
      ['librarian', libPassHash, 'Circulation Desk Librarian', 'librarian@library.spit.ac.in', 'Librarian']
    );
    console.log('✓ Staff Accounts seeded: admin (Admin@123) & librarian (Librarian@123)');

    // 3. Books & Copies (Realistic Computer Science & Engineering Library Books with valid ISBNs)
    const books = [
      {
        isbn: '9780132350884',
        title: 'Clean Code: A Handbook of Agile Software Craftsmanship',
        author: 'Robert C. Martin',
        category: 'Software Engineering',
        publisher: 'Prentice Hall',
        edition: '1st Edition',
        publicationYear: 2008,
        copies: 4
      },
      {
        isbn: '9780262033848',
        title: 'Introduction to Algorithms',
        author: 'Thomas H. Cormen, Charles E. Leiserson, Ronald L. Rivest, Clifford Stein',
        category: 'Algorithms & Data Structures',
        publisher: 'MIT Press',
        edition: '3rd Edition',
        publicationYear: 2009,
        copies: 5
      },
      {
        isbn: '9780131103627',
        title: 'The C Programming Language',
        author: 'Brian W. Kernighan, Dennis M. Ritchie',
        category: 'Programming Languages',
        publisher: 'Prentice Hall',
        edition: '2nd Edition',
        publicationYear: 1988,
        copies: 3
      },
      {
        isbn: '9780134685991',
        title: 'Effective Java',
        author: 'Joshua Bloch',
        category: 'Programming Languages',
        publisher: 'Addison-Wesley',
        edition: '3rd Edition',
        publicationYear: 2017,
        copies: 4
      },
      {
        isbn: '9780596007126',
        title: 'Head First Design Patterns',
        author: 'Eric Freeman, Elisabeth Robson',
        category: 'Software Engineering',
        publisher: "O'Reilly Media",
        edition: '1st Edition',
        publicationYear: 2004,
        copies: 3
      },
      {
        isbn: '9780131101630',
        title: 'Operating System Concepts',
        author: 'Abraham Silberschatz, Peter B. Galvin, Greg Gagne',
        category: 'Operating Systems',
        publisher: 'John Wiley & Sons',
        edition: '9th Edition',
        publicationYear: 2012,
        copies: 4
      },
      {
        isbn: '9780136086208',
        title: 'Computer Networks',
        author: 'Andrew S. Tanenbaum, David J. Wetherall',
        category: 'Computer Networks',
        publisher: 'Pearson',
        edition: '5th Edition',
        publicationYear: 2010,
        copies: 3
      },
      {
        isbn: '9780073523323',
        title: 'Database System Concepts',
        author: 'Abraham Silberschatz, Henry F. Korth, S. Sudarshan',
        category: 'Database Systems',
        publisher: 'McGraw-Hill',
        edition: '6th Edition',
        publicationYear: 2010,
        copies: 4
      }
    ];

    for (const b of books) {
      await connection.query(
        `INSERT INTO book_titles (isbn, title, author, category, publisher, edition, publication_year, total_copies, available_copies)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), author = VALUES(author), category = VALUES(category), publisher = VALUES(publisher), edition = VALUES(edition), publication_year = VALUES(publication_year)`,
        [b.isbn, b.title, b.author, b.category, b.publisher, b.edition, b.publicationYear, b.copies, b.copies]
      );

      // Create copies
      for (let i = 1; i <= b.copies; i++) {
        const acc = `ACC-${b.isbn}-${String(i).padStart(3, '0')}`;
        await connection.query(
          'INSERT INTO book_copies (accession_number, isbn, copy_status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE isbn = VALUES(isbn)',
          [acc, b.isbn, 'Available']
        );
      }
    }
    console.log(`✓ Seeded ${books.length} book titles and physical copies`);

    // 4. Seed Members (Students & Faculty)
    const memberPassHash = await bcrypt.hash('Member@123', 10);
    const members = [
      {
        membershipId: 'MEM-2026-0001',
        name: 'Parth Zala',
        instId: '2024300274',
        dept: 'Computer Engineering',
        email: 'parth.zala@spit.ac.in',
        phone: '9820011223',
        type: 'Student',
        limit: 3
      },
      {
        membershipId: 'MEM-2026-0002',
        name: 'Simrit Kaur',
        instId: '2024300276',
        dept: 'Computer Engineering',
        email: 'simrit.kaur@spit.ac.in',
        phone: '9820011224',
        type: 'Student',
        limit: 3
      },
      {
        membershipId: 'MEM-2026-0003',
        name: 'Dr. Surekha Dholay',
        instId: 'FAC-COMP-101',
        dept: 'Computer Engineering',
        email: 'surekha.dholay@spit.ac.in',
        phone: '9820099881',
        type: 'Faculty',
        limit: 8
      },
      {
        membershipId: 'MEM-2026-0004',
        name: 'Aarav Sharma',
        instId: '2024300280',
        dept: 'Information Technology',
        email: 'aarav.sharma@spit.ac.in',
        phone: '9819922334',
        type: 'Student',
        limit: 3
      }
    ];

    for (const m of members) {
      await connection.query(
        `INSERT INTO members (membership_id, name, institutional_id, department, email, phone, member_type, account_status, borrowing_limit)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), department = VALUES(department), phone = VALUES(phone), borrowing_limit = VALUES(borrowing_limit)`,
        [m.membershipId, m.name, m.instId, m.dept, m.email, m.phone, m.type, m.limit]
      );

      await connection.query(
        `INSERT INTO member_credentials (membership_id, password_hash)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
        [m.membershipId, memberPassHash]
      );
    }
    console.log(`✓ Seeded ${members.length} members with credentials (default password: Member@123)`);

    // 5. Seed a sample active loan & past returned loan
    // Issue Clean Code copy 001 to Parth Zala
    const sampleAcc = 'ACC-9780132350884-001';
    const [loanExists] = await connection.query('SELECT loan_id FROM loans WHERE accession_number = ? LIMIT 1', [sampleAcc]);
    if (loanExists.length === 0) {
      await connection.query(
        `INSERT INTO loans (membership_id, accession_number, isbn, issue_date, due_date, loan_status)
         VALUES ('MEM-2026-0001', ?, '9780132350884', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 14 DAY), 'Issued')`,
        [sampleAcc]
      );
      await connection.query('UPDATE book_copies SET copy_status = "Issued" WHERE accession_number = ?', [sampleAcc]);
      console.log('✓ Seeded sample active loan');
    }

    // Reconcile title counts from the physical copy ledger so repeated seed runs remain consistent.
    await connection.query(
      `UPDATE book_titles b
       SET b.total_copies = (SELECT COUNT(*) FROM book_copies c WHERE c.isbn = b.isbn),
           b.available_copies = (SELECT COUNT(*) FROM book_copies c WHERE c.isbn = b.isbn AND c.copy_status = 'Available')`
    );

    await connection.commit();
    console.log('--- Database Seeding Completed Successfully ---');
  } catch (error) {
    await connection.rollback();
    console.error('Seeding failed:', error);
    throw error;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  seedDatabase().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { seedDatabase };
