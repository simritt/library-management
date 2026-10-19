-- Online Library Management System (OLMS) Schema
-- Strictly aligned with SRS Release 1.0 (SPIT Mumbai)
-- Conforms to 3NF relational data model

CREATE DATABASE IF NOT EXISTS library_db;
USE library_db;

-- 1. Configuration & Business Rules Table (BR-1, BR-2, BR-4, BR-5, BR-6, BR-7)
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(50) PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL,
    description VARCHAR(255) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Staff & System Users (Librarian, Library Administrator)
-- Supports SE-1, SE-3, SE-4, SE-8 (salted bcrypt hashes, failed login tracking & 15m lockout)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    role ENUM('Librarian', 'Administrator') NOT NULL DEFAULT 'Librarian',
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Members / Patrons Table (Students & Faculty)
-- FR-Member.Register-01 to 04, BR-1
CREATE TABLE IF NOT EXISTS members (
    membership_id VARCHAR(30) PRIMARY KEY, -- Unique Library Membership ID (e.g. MEM-2026-001)
    name VARCHAR(100) NOT NULL,
    institutional_id VARCHAR(50) NOT NULL UNIQUE, -- Roll / Employee No (e.g. 2024300274)
    department VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(20) NOT NULL,
    member_type ENUM('Student', 'Faculty') NOT NULL,
    account_status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    borrowing_limit INT NOT NULL DEFAULT 3, -- 3 for Student, 8 for Faculty by default
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_institutional_id (institutional_id),
    INDEX idx_member_status (account_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optional Patron Web Account Login credentials (SE-1, SE-6, FR-Member.View-02)
CREATE TABLE IF NOT EXISTS member_credentials (
    membership_id VARCHAR(30) PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (membership_id) REFERENCES members(membership_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Book Titles (Catalog)
-- FR-Catalog.Add-01 to 03, FR-Catalog.Update-01 to 02
CREATE TABLE IF NOT EXISTS book_titles (
    isbn VARCHAR(20) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    author VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    publisher VARCHAR(150) NOT NULL,
    edition VARCHAR(50) NOT NULL,
    publication_year INT NULL,
    total_copies INT NOT NULL DEFAULT 0,
    available_copies INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_title (title),
    INDEX idx_author (author),
    INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Physical Book Copies
-- FR-Catalog.Add-04, FR-Catalog.Remove-01 to 03
CREATE TABLE IF NOT EXISTS book_copies (
    accession_number VARCHAR(40) PRIMARY KEY, -- Unique barcode / accession ID (e.g. ACC-9780132350884-01)
    isbn VARCHAR(20) NOT NULL,
    copy_status ENUM('Available', 'Issued', 'Lost', 'Damaged', 'Reserved_Hold') NOT NULL DEFAULT 'Available',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (isbn) REFERENCES book_titles(isbn) ON UPDATE CASCADE ON DELETE RESTRICT,
    INDEX idx_copy_isbn (isbn),
    INDEX idx_copy_status (copy_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Loans (Book Issues & Returns)
-- FR-Issue, FR-Return, BR-2, BR-3
CREATE TABLE IF NOT EXISTS loans (
    loan_id INT AUTO_INCREMENT PRIMARY KEY,
    membership_id VARCHAR(30) NOT NULL,
    accession_number VARCHAR(40) NOT NULL,
    isbn VARCHAR(20) NOT NULL,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    return_date DATE NULL,
    loan_status ENUM('Issued', 'Returned', 'Lost') NOT NULL DEFAULT 'Issued',
    issued_by INT NULL, -- Staff User ID
    received_by INT NULL, -- Staff User ID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (membership_id) REFERENCES members(membership_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (accession_number) REFERENCES book_copies(accession_number) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (isbn) REFERENCES book_titles(isbn) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_loan_member (membership_id),
    INDEX idx_loan_accession (accession_number),
    INDEX idx_loan_status (loan_status),
    INDEX idx_loan_due (due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Fines
-- FR-Fine, BR-4, BR-5, BR-6, BR-8
CREATE TABLE IF NOT EXISTS fines (
    fine_id INT AUTO_INCREMENT PRIMARY KEY,
    loan_id INT NOT NULL,
    membership_id VARCHAR(30) NOT NULL,
    amount_charged DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    date_charged TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    waived_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    waived_by INT NULL, -- Admin User ID
    waiver_remark VARCHAR(255) NULL,
    FOREIGN KEY (loan_id) REFERENCES loans(loan_id) ON DELETE RESTRICT,
    FOREIGN KEY (membership_id) REFERENCES members(membership_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (waived_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_fine_member (membership_id),
    INDEX idx_fine_loan (loan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. Fine Payments Audit History
-- FR-Fine.Pay-01, FR-Fine.Pay-02
CREATE TABLE IF NOT EXISTS fine_payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    fine_id INT NOT NULL,
    membership_id VARCHAR(30) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    collected_by INT NULL,
    receipt_number VARCHAR(50) NOT NULL UNIQUE,
    FOREIGN KEY (fine_id) REFERENCES fines(fine_id) ON DELETE CASCADE,
    FOREIGN KEY (membership_id) REFERENCES members(membership_id) ON DELETE RESTRICT,
    FOREIGN KEY (collected_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. Reservations
-- FR-Reserve, BR-7
CREATE TABLE IF NOT EXISTS reservations (
    reservation_id INT AUTO_INCREMENT PRIMARY KEY,
    membership_id VARCHAR(30) NOT NULL,
    isbn VARCHAR(20) NOT NULL,
    queue_position INT NOT NULL,
    reservation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Active', 'Fulfilled', 'Cancelled', 'Expired') NOT NULL DEFAULT 'Active',
    held_accession_number VARCHAR(40) NULL,
    hold_expires_at DATETIME NULL,
    FOREIGN KEY (membership_id) REFERENCES members(membership_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (isbn) REFERENCES book_titles(isbn) ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (held_accession_number) REFERENCES book_copies(accession_number) ON DELETE SET NULL,
    INDEX idx_res_member (membership_id),
    INDEX idx_res_isbn (isbn),
    INDEX idx_res_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 10. Audit / Transaction Logs
-- SA-1, BR-8
CREATE TABLE IF NOT EXISTS transaction_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    action_type ENUM('ISSUE', 'RETURN', 'FINE_PAYMENT', 'FINE_WAIVE', 'MEMBER_REGISTER', 'MEMBER_DEACTIVATE', 'COPY_STATUS_CHANGE') NOT NULL,
    performed_by INT NULL,
    performed_by_name VARCHAR(100) NULL,
    membership_id VARCHAR(30) NULL,
    accession_number VARCHAR(40) NULL,
    details TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_log_action (action_type),
    INDEX idx_log_date (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 11. Patron book requests (self-service request workflow)
-- A patron may request a title by name/ISBN and desired loan duration.
-- ISBN is deliberately not a foreign key: a patron may request a title not yet in the catalogue.
CREATE TABLE IF NOT EXISTS book_requests (
    request_id INT AUTO_INCREMENT PRIMARY KEY,
    membership_id VARCHAR(30) NOT NULL,
    requested_title VARCHAR(255) NOT NULL,
    requested_isbn VARCHAR(20) NOT NULL,
    requested_days INT NOT NULL,
    request_note VARCHAR(500) NULL,
    request_status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled', 'Fulfilled') NOT NULL DEFAULT 'Pending',
    staff_note VARCHAR(500) NULL,
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_book_request_member FOREIGN KEY (membership_id) REFERENCES members(membership_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_book_request_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_book_request_days CHECK (requested_days >= 1),
    INDEX idx_book_request_member (membership_id),
    INDEX idx_book_request_status (request_status),
    INDEX idx_book_request_isbn (requested_isbn),
    INDEX idx_book_request_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
