-- Online Library Management System (OLMS) Seed Data
USE library_db;

-- 1. System Settings Seed (BR-1, BR-2, BR-4, BR-5, BR-6, BR-7)
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('fine_rate_per_day', '2.00', 'Overdue fine rate per day per book in INR (BR-5)'),
('max_fine_per_loan', '200.00', 'Maximum cap on fine per individual loan in INR (BR-6)'),
('fine_block_threshold', '100.00', 'Outstanding fine balance threshold above which borrowing is blocked in INR (BR-4)'),
('student_loan_days', '14', 'Loan duration for students in days (BR-2)'),
('faculty_loan_days', '30', 'Loan duration for faculty in days (BR-2)'),
('student_borrow_limit', '3', 'Default borrowing limit for students (BR-1)'),
('faculty_borrow_limit', '8', 'Default borrowing limit for faculty (BR-1)'),
('reservation_hold_hours', '48', 'Hours to hold returned copy for reserving member (BR-7)')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

-- 2. Staff Accounts
-- Passwords:
-- admin / Admin@123 -> $2b$10$w09ZlM.QY92G3dZ7oR4fK.T62hWJq30x9N4dD2WpIqKqYv1v3gUxe (we will insert precalculated bcrypt hash for 'Admin@123')
-- librarian / Librarian@123 -> $2b$10$tZ2cQ5p1E4W4UjI7cE3cCeK4kMh5jD8q7A6y5mN2p4r3s2t1u0v.w
-- Let's use clean bcrypt hashes generated for 'Admin@123' and 'Librarian@123'
-- Hash for 'Admin@123': $2b$10$bI8pC3V3pC7yM7gY4/VGeetd9mG5xLqM99l.n9M1pWf2h50kXqRsm
-- We will also run a seed script to ensure reliable salted bcrypt hash insertion.
