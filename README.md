# Online Library Management System (OLMS)

A full-stack library application based on the SPIT OLMS SRS. The application uses React + Vite + Tailwind CSS, a Node.js/Express REST API, MySQL 8, bcrypt password hashes, and HTTP-only session cookies. It runs locally; no Supabase account or cloud service is required.

## What is implemented

- **Public catalogue:** search by title, author, ISBN/keyword; filter, sort, view title/copy availability and details.
- **Catalog administration:** add/update title records, validate ISBN-10/ISBN-13 check digits, prevent duplicate ISBNs, create uniquely numbered physical copies, and mark copies lost/damaged with inventory updates.
- **Member management:** register student/faculty patrons, generate membership IDs, search/update members, set the correct default borrowing limit, and guard deactivation when loans or unpaid fines remain.
- **Staff circulation desk:** issue an available physical copy after eligibility checks, use configured loan duration, return/mark damaged, update inventory transactionally, display receipts, and search active/overdue loans.
- **Fines:** Rs. 2/day by default, Rs. 200 per-loan cap by default, partial collection receipts, recorded payments, admin-only waivers with a mandatory audit reason, and a Rs. 100 borrowing-block threshold. These rules are configurable through Administrator settings.
- **Patron requests:** patrons submit book title, checksum-validated ISBN, note, and desired loan duration within their student/faculty day limit. Staff approve/reject requests; an approved request can be fulfilled from the issue desk and is marked Fulfilled when its loan transaction succeeds.
- **Two complete ledgers:** patrons see their own borrowing history, issue/due/return dates, elapsed/remaining/overdue days, fine charged/collected/waived/due, reservations, request status and receipts. Staff can inspect a member ledger or a title-level ledger showing each borrower and every physical-copy loan record. Current overdue accrual is shown as an estimate until the book is returned and the fine is assessed.
- **Reservations:** first-come queue, duplicate-active reservation prevention, 48-hour holds (configurable), cancellation/hold transfer, and automatic expiry processing while the backend is running.
- **Reports and audit records:** inventory, overdue circulation, circulation counts, fine summary, CSV exports where available, settings, and transaction logs for circulation/payment/waiver operations.
- **Desk conveniences:** issue preview (eligibility + due date before confirming), reservation offer when no copy is free, Lost/Damaged handling, in-place fine collection and a Fines tab with receipts, member edit, copy-condition controls, date-ranged reports with CSV export.
- **Access control:** public catalogue, separate staff/patron logins, role-protected pages/API routes, password hashing, account lockout after repeated staff login failures, and session cookies.

The SRS identifies email/SMS reminders as a future-release dependency; this version does not pretend to send those notifications.

## Technology

- Frontend: React, Vite, Tailwind CSS, React Router, Lucide icons
- Backend: Node.js, Express, `mysql2`, `express-session`, `bcryptjs`
- Database: MySQL 8 with foreign keys and transactional issue/return workflows
- Tests: Node.js built-in test runner (server), Playwright-core browser walkthrough (tests-ui)

## Project layout

```text
library-management/
├── client/                  # React/Vite application
├── server/                  # Express API, controllers, routes, tests
│   ├── .env.example          # Copy to .env and configure locally
│   └── src/
├── tests-ui/                # Optional browser walkthrough (Playwright-core + installed Edge/Chrome)
├── CHANGES.md               # Record of changes made to complete the SRS scope
├── database/
│   ├── schema.sql            # Database schema (safe to re-run for new tables)
│   └── seed.sql              # SQL reference seed; use npm run seed for full demo data
├── .gitignore
└── README.md
```

## Setup on Windows + VS Code

### 1. Install prerequisites

Install Node.js LTS and MySQL Server 8.0. In VS Code, open this extracted project folder. Open **Terminal → New Terminal** (PowerShell).

Check installations:

```powershell
node -v
npm -v
mysql --version
```

### 2. Create databases

Run from the project root (`library-management`, not `server` or `client`):

```powershell
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS library_db; CREATE DATABASE IF NOT EXISTS library_test_db;"
```

Load/update the schema. This does not drop existing tables:

```powershell
Get-Content .\database\schema.sql -Raw | mysql -u root -p library_db
```

Enter your MySQL root password when prompted.

### 3. Configure backend credentials

In VS Code Explorer, open `server/.env.example`, copy its contents into a new file named `server/.env`, and edit **the file** (do not type environment assignments in the terminal). Replace `DB_PASSWORD` with the password you actually use for `mysql -u root -p`.

Example `server/.env`:

```env
PORT=5000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_ACTUAL_MYSQL_PASSWORD
DB_NAME=library_db
TEST_DB_NAME=library_test_db
SESSION_SECRET=replace_with_a_long_random_secret_value
NODE_ENV=development
```

Do not share or commit `server/.env`.

### 4. Install, seed and start backend

In the first terminal:

```powershell
cd server
npm install
npm run seed
npm test      # rebuilds library_test_db, then runs all server tests (never touches library_db)
npm run dev
```

`npm run seed` can be run more than once; it resets the demonstration passwords and ensures sample catalogue/member records exist. If tests fail because MySQL cannot be reached, first verify the `.env` password and database setup. The API should listen on `http://localhost:5000`.

Health check: open `http://localhost:5000/api/health`.

### 5. Start frontend in a second terminal

Use the terminal panel's **+** button to open another terminal. It should start in the project root:

```powershell
cd client
npm install
npm run build
npm run dev
```

Open the URL Vite prints, normally `http://localhost:5173`. Keep both backend and frontend terminals open while using the app.

## Demo credentials

Seed accounts use bcrypt hashes in MySQL:

| Account | Login ID | Password |
|---|---|---|
| Administrator | `admin` | `Admin@123` |
| Librarian | `librarian` | `Librarian@123` |
| Student patron | `MEM-2026-0001` (or institutional ID `2024300274`) | `Member@123` |
| Student patron | `MEM-2026-0002` | `Member@123` |
| Faculty patron | `MEM-2026-0003` | `Member@123` |

Use these only in your local academic demo. Change demo credentials before any real deployment.

## Demo data (for presentations)

After `npm run seed`, load a small presentation dataset (safe to run once; it picks free copies, never edits or removes anything you already have, and says so if it was already loaded):

```powershell
cd server
npm run seed:demo
```

| Account | What it shows |
|---|---|
| `MEM-2026-0001` Parth (student) | A book **10 days overdue** (Rs. 20 accruing), an earlier late return with the fine **fully paid**, and an **active reservation** for *Head First Design Patterns* |
| `MEM-2026-0002` Simrit (student) | A late return with a fine **part-paid** (Rs. 10 of Rs. 16, **Rs. 6 due**, receipt shown), two books on time, a **Pending** book request |
| `MEM-2026-0003` Dr. Surekha (faculty) | Faculty 30-day loans on time, a returned loan, a copy of *Head First* |
| `MEM-2026-0004` Aarav (student) | A late return whose Rs. 14 fine was **waived by the Administrator** (with remark), an **Approved** request ready to issue |
| Catalogue | *Head First Design Patterns* has every copy issued, so the **Reserve** flow and queue are demonstrable; one **Damaged** copy of *The C Programming Language* |
| Staff views | Active Loans shows the overdue row; Reservations shows the queue; Requests shows Pending / Approved / Rejected; Ledgers and Reports have paid, part-paid and waived fines to display |

## Manual end-to-end test plan

Do this once the app is running (`http://localhost:5173`). It walks every role and every module, and each
block ends with a **DB check** you can run in MySQL Workbench or the `mysql` CLI so you can see that the
data really persists. Use a normal window for staff and a private/incognito window for patrons so the two
sessions don't overwrite each other. Run it against `library_db` (your real data) or, if you want a
throw-away copy, start the API with `NODE_ENV=test` after `npm run test:setup` (it then uses `library_test_db`).

Shortcut for DB checks (PowerShell, from the project root):

```powershell
mysql -u root -p library_db -e "SELECT ... ;"
```

### Part 0: Smoke check
1. Open `http://localhost:5000/api/health`: JSON with `"status":"healthy"`.
2. Open `http://localhost:5173`: you land on the public **Catalogue** with the 8 seeded books.

### Part 1: Public visitor (not signed in)
| # | Do this | Expect |
|---|---|---|
| 1.1 | Search `algorithms` and press Enter | Only *Introduction to Algorithms* |
| 1.2 | Search `zzzz` | "no results" message suggesting you clear filters |
| 1.3 | Clear search; filter by a category; tick **Available only**; change **Sort** (title / author / year) | List narrows and re-orders |
| 1.4 | Open any book | Copies table with accession numbers and status. **No borrower column / names** |
| 1.5 | Type `/circulation` or `/admin/reports` in the address bar | Redirected to the staff login |

### Part 2: Librarian (`librarian` / `Librarian@123`)
**Login and access**
- 2.1 Wrong password → "Invalid username or password (n attempts remaining)". Five wrong attempts lock the account for 15 minutes (to unlock during testing: `UPDATE users SET failed_attempts=0, locked_until=NULL WHERE username='librarian';`).
- 2.2 Correct login → **Overview** dashboard with live counts.
- 2.3 Open `/admin/reports` → "This area is restricted" (Administrator only).

**Members** (`Members`)
- 2.4 **Register New Member**: fill all fields (Student). Success banner shows the generated `MEM-YYYY-NNNN`. *DB:* `SELECT * FROM members ORDER BY created_at DESC LIMIT 1;` → limit 3, status Active. A Faculty member gets limit 8.
- 2.5 Register again with the same Institutional ID → error "already registered". Same e-mail → error.
- 2.6 Click **Edit** on that member, change the phone → success. The *Borrowing limit* field is **not** shown to a librarian.
- 2.7 Search by name / membership ID; filter Type and Status.

**Books** (`Books`)
- 2.8 **Add New Book Title**: ISBN `9780201633610`, 2 copies → banner lists `ACC-9780201633610-001`, `-002`. *DB:* `SELECT * FROM book_copies WHERE isbn='9780201633610';`
- 2.9 Add again with the same ISBN → "already exists… add more copies". Try ISBN `9780201633611` → "Invalid ISBN-13 checksum".
- 2.10 **+ Copies** (add 1) → new accession `-003`, totals update. **Edit** → change publisher/edition, save.
- 2.11 Open the book (**View**) → in *Copy condition* click **Mark lost** on an available copy (enter a remark) → status Lost and *Available* count drops by 1. Click **Restore** → back to Available.

**Issue** (`Circulation → Issue Book`)
- 2.12 In **Member**, type a name (e.g. `aarav`) or the ID and pick the member from the suggestions. A green card shows name, type, `0 / 3` borrowed, fine due, **max loan 14 days** and **"Due date if issued today"** before you confirm.
- 2.13 Either type a title in *Search the catalogue by title or author* and pick the book (the ISBN fills itself and shows how many copies are free), or enter ISBN `9780201633610` → **Verify Eligibility & Confirm Issue** → receipt (loan id, accession, issue + due date). *DB:* `loans` row `Issued`; `book_copies.copy_status='Issued'`; `book_titles.available_copies` decreased.
- 2.14 Issue the other copy using its **Accession Number** instead of ISBN. Issue a third book so the member holds 3, then try a 4th → red card/refusal: borrowing limit reached.
- 2.15 Try Loan duration `99` → the field is blocked (over the policy maximum shown in the card; the server enforces it too). `7` → due date is today + 7.
- 2.16 With every copy of a title issued, issue it to another member → "No copies… available" plus a button **Place `<member>` in the reservation queue**. Click it → "queue position #1". *DB:* `SELECT * FROM reservations;`

**Return, overdue fines and payments**
- 2.17 `Return Book` → enter an accession number of an on-time loan → "Returned on time, no fine", copy Available, count restored.
- 2.18 Make a loan overdue (no waiting): `UPDATE loans SET due_date = DATE_SUB(CURDATE(), INTERVAL 5 DAY) WHERE loan_id = <id>;` then return it → *5 days overdue, Rs. 10.00*. Click **Collect Rs. 10.00 now** → receipt number shown. *DB:* `fines` (charged 10, paid 10) and `fine_payments`.
- 2.19 Overdue again with a bigger gap, e.g. 150 days → fine capped at **Rs. 200.00**.
- 2.20 Return an overdue book **without** collecting. Open `Circulation → Fines`, look up the member, type a **partial** amount (e.g. 4) and **Collect** → receipt shows the remaining balance. Collect the rest → "Settled".
- 2.21 With fines above Rs. 100 unpaid, try to issue a book to that member → the preview card turns red and the issue is refused (fine threshold). Pay down below Rs. 100 → issue works again.
- 2.22 Return with **Flag as Damaged** → copy status Damaged, available count unchanged (not restocked). Return with **Mark as Lost** → loan status Lost, Rs. 200 charged, copy Lost.
- 2.23 Return an accession that isn't on loan → "No active loan found".
- 2.24 `Active Loans` tab: search, tick **Overdue Loans Only**, use the row **Return** shortcut.

**Reservations** (`Reservations`)
- 2.25 Reserve a title as in 2.16 (and as a patron in Part 3). Return the issued copy → return summary shows **Reservation Hold Placed… held for 48 hours** for the first patron. *DB:* `book_copies.copy_status='Reserved_Hold'`; `reservations.held_accession_number` and `hold_expires_at` set.
- 2.26 While held, try to issue that title to someone else → refused. Issue it to the patron who holds the reservation → works and the reservation becomes Fulfilled.
- 2.27 Hold expiry: `UPDATE reservations SET hold_expires_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE reservation_id = <id>;` and wait up to a minute (the API sweeps every minute) → reservation `Expired`, copy passed to the next in queue or back to Available.
- 2.28 Reservation desk: filter by status, search, **Cancel** a reservation.

**Requests** (`Requests`)
- 2.29 After Part 3's request: **Approve** (with optional note) → status Approved → **Issue approved request** opens the issue desk pre-filled with the requested days → confirm → request becomes **Fulfilled**. **Decline** shows on the patron's side with your note.

**Ledgers** (`Ledgers`)
- 2.30 *Member ledger*: choose the test member → every loan with issue / due / return dates, days held / remaining / overdue, fine charged / collected / due, plus fine and payment history. *Book ledger*: choose a title → every borrower of every copy.

### Part 3: Patron (`MEM-2026-0002` or the member you registered; password `Member@123`)
- 3.1 Sign in at **Patron sign in** (institutional ID also works as the login). You land on **My account**: borrowed count and limit, overdue count, fines collected / due, current loans with days left, loan ledger, reservations with live queue position, payments and receipts.
- 3.2 Try `/circulation` and `/admin/reports` → "restricted". Try `/patron/MEM-2026-0001` (someone else) → "Access denied".
- 3.3 **Book requests**: start typing a title (e.g. `clean`) and pick it from the catalogue suggestions. The ISBN fills itself; typing a known ISBN fills the title instead. For a book the library doesn't hold, type the title and its ISBN yourself. Then choose days within your limit (≤ 14 student / 30 faculty) → "submitted for library review", status Pending. Days above your limit are blocked, and a bad ISBN checksum shows an error. Submit the same ISBN again → "already have a pending or approved request". **Cancel request** works only while Pending.
- 3.4 Open a book with **no free copy** → **Place Reservation (Queue)** → "position #n". Click again → "already have an active reservation". Reservations also appear on My account with a **Cancel** button.
- 3.5 After the librarian returns the copy (2.25) → your reservation shows **ready to collect** with the held accession number.
- 3.6 Your fines and payment receipts appear under *Payments & dues* after the librarian collects a payment.

### Part 4: Administrator (`admin` / `Admin@123`)
- 4.1 Everything a librarian can do, plus: in **Members**, **Edit** shows *Borrowing limit*; **Deactivate** / **Reactivate** buttons appear.
- 4.2 Deactivate a member who still has a loan or an unpaid fine → "Deactivation Blocked" listing what's outstanding. Clear it and deactivate again → status Inactive; trying to issue to that member → refused (inactive). **Reactivate** restores it.
- 4.3 Open a member's profile (`Members → View`): on a fine row click **Waive**. Submitting without a remark is blocked; with a remark the waived amount and remark are stored. *DB:* `SELECT waived_amount, waived_by, waiver_remark FROM fines;` and `transaction_logs` (`FINE_WAIVE`). A librarian's profile view has **no** Waive button.
- 4.4 **Reports** (`Reports`):
  - *Inventory*: totals match the *Books* page; **Export CSV**.
  - *Overdue Loans*: the loan you backdated, with days overdue and accruing fine; **Export CSV**.
  - *Circulation*: pick a **From/To** date range → issue/return counts and daily rows; a future range shows "No circulation activity"; **Export CSV**.
  - *Fines Collection*: choose a range → assessed / collected / waived / outstanding cards and the fines table; **Export fine ledger CSV**.
  - *Policy Rules*: change the fine rate (e.g. 3), save, then repeat 2.18 → fine now uses 3/day. Enter an invalid value (e.g. 2000) → inline error. Restore the rate to 2. Other editable rules: cap, block threshold, loan days, default borrowing limits, reservation hold hours.
- 4.5 **Sign out** → back to the public catalogue; typing `/admin/reports` asks you to sign in again.

### Part 5: Database CRUD checklist
| Entity | Create | Read | Update | Remove |
|---|---|---|---|---|
| Book title | Books → Add | Catalogue, Books, Reports | Books → Edit, + Copies | Not deleted: copies are retired as Lost / Damaged (SRS FR-Catalog.Remove) |
| Book copy | Add title / + Copies | Book details | Mark lost / damaged / restore | Retire (see above) |
| Member | Members → Register | Members, profile, ledger | Members → Edit | Deactivate / Reactivate (never deleted: audit and 3-year retention, OR-1) |
| Loan | Issue | Active Loans, ledgers | Return (Returned / Lost) | Never deleted (audit trail) |
| Fine | Created on overdue / lost return | Profile, Fines tab, ledgers, reports | Pay (partial/full), Waive (admin) | Never deleted |
| Reservation | Patron / staff reserve | Reservation desk, My account | Auto hold, fulfil, expire | Cancel |
| Book request | Patron request | Requests desk, My account | Approve / Decline / Fulfil | Patron cancel (Pending only) |
| Policy settings | Seeded | Reports → Policy Rules | Reports → Policy Rules | n/a |
| Audit log | Automatic on issue / return / payment / waiver / registration / copy change | `SELECT * FROM transaction_logs;` | n/a | n/a |

## Automated testing

`npm test` in `server/` rebuilds the **isolated** `library_test_db` (never `library_db`) and runs:

- unit tests (ISBN checksum, due date and fine rules),
- API tests,
- `tests/e2e.test.js`: ~370 assertions across authentication/lockout, role permissions, catalogue, members, issue/return, fine calculation and cap, payments and waivers, borrowing and fine thresholds, policy changes, reservations (queue, 48-hour hold, expiry, restore), patron requests, ledgers, reports and CSV, concurrency, and inventory-consistency invariants.

Browser walkthrough (optional, uses your installed Edge or Chrome via `playwright-core`):

```powershell
cd server;  node src/scripts/setupTestDb.js          # fresh test DB
$env:NODE_ENV="test"; npm start                      # API on :5000 using library_test_db (terminal 1)
cd ../client; npm run dev                            # UI on :5173 (terminal 2)
cd ../tests-ui; npm install; npm test                # 42 UI steps (terminal 3); screenshots in tests-ui/screenshots
```

Set `BROWSER_PATH` if your Edge/Chrome is in a non-standard place.

## Known limitations

- **Notifications:** e-mail/SMS reminders and reservation alerts are a future-release item in the SRS (SI-3, CI-2). Staff see the on-screen hold notice and patrons see "ready to collect" in My account.
- **Barcode/RFID hardware** is out of scope (SRS 3.2); accession numbers are typed or pasted.
- **Account administration:** the SRS lists a System Administrator role for account provisioning, but there is no UI for it. Staff accounts are created by seeding/SQL, and there is no password change or reset screen for staff or patrons (patrons start with `Member@123`).
- **TLS (CI-3, SE-7):** the dev server uses HTTP and non-secure cookies. For deployment, serve behind HTTPS and set the session cookie to `secure: true` in `server/src/server.js`.
- **Lost books:** a Lost return charges the maximum fine (BR-6) and retires the copy; the separate lost-book recovery procedure is out of scope per BR-6.
- **Verified vs not verified:** functional behaviour is covered by the automated tests above. Measured locally with a small dataset: 100 concurrent searches p95 ≈ 0.25 s, 100 concurrent issues / returns p95 ≈ 0.8 / 1.0 s, no oversold copies. That is indicative only, not a formal performance test. Not verified: Firefox, tablet (1024×768) layout, keyboard-only navigation (UI-4), and the 99 % availability target.

## Troubleshooting

- **`Access denied for user 'root'`:** Correct `DB_PASSWORD` in `server/.env`. Test separately with `mysql -u root -p -D library_db -e "SELECT 1;"`.
- **`EADDRINUSE` on port 5000:** Stop the older backend terminal with `Ctrl+C`, or find its PID using `netstat -ano | findstr :5000` and stop that PID.
- **Login returns Internal Server Error:** Read the backend terminal first. Confirm the database is reachable and run `npm run seed` from `server`.
- **Request table missing:** From the project root, re-run the schema import in Step 2 so the `book_requests` table is added.
- **Frontend cannot reach the API:** Start the backend on port 5000 and use the Vite URL on port 5173.
