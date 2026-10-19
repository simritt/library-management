# Change record

Record of significant changes made while completing the SRS scope on top of the existing codebase
(React + Vite + Tailwind, Express, MySQL). Nothing was rebuilt; the existing structure, UI style and
workflow were kept.

## Starting point (audit of the existing work)

Already built and kept: auth (staff + patron, lockout), catalogue search, catalogue maintenance, member
registration, issue/return transactions, fines/payments/waivers, reservations with holds and expiry
sweep, patron requests, ledgers, reports, settings, and a set of API tests.

Problems found during the audit:

| Finding | Severity |
|---|---|
| `book_requests` table was missing from the live `library_db` (schema never re-applied), so the requests feature would fail with 500 | High |
| `npm test` ran against the **live** database, and its deactivation test really deactivated member `MEM-2026-0001` | High |
| `GET /api/catalog/books/:isbn` is public but returned each copy's borrower name and membership ID | High (SE-6, OR-3) |
| Dates used `toISOString()` (UTC) while MySQL uses local `CURDATE()`: wrong day between 00:00–05:30 IST | Medium |
| Concurrent issues of the same title deadlocked in MySQL (user saw a 500; data stayed consistent) | Medium (found by load test) |
| SRS features with a backend but no screen: edit member, mark copy Lost/Damaged, collect fine at desk | Medium |
| Reports ignored date ranges in the UI; fines detail list never shown; circulation not exportable; 3 of 8 policy settings not editable | Medium |
| Stored queue position went stale when earlier patrons cancelled/were served | Low |

## Changes

### Database / operations
- Applied `database/schema.sql` to `library_db` (creates `book_requests`); restored `MEM-2026-0001` to Active.
- New `server/src/scripts/setupTestDb.js` rebuilds an isolated `library_test_db` (refuses to run against `DB_NAME`).
  `npm test` now runs it first; all test files force `NODE_ENV=test`.

### Backend
- `utils/dates.js` (new) and `utils/fineCalculator.js`: timezone-safe local-date and day-difference maths.
- `utils/txRetry.js` (new): transparent retry when MySQL aborts a transaction (deadlock / lock wait).
- `circulationController`:
  - Lock order fixed (member → title → copy; loan → title on return) to remove the issue deadlock; handlers retry on abort.
  - `GET /api/circulation/issue/preview` (new): member eligibility, limits, fine and the computed due date before confirming (FR-Issue.DueDate-01).
  - Return supports **Lost** (SRS Fig. B.2 Issued→Lost): loan closes as Lost, copy retired, maximum per-loan fine charged (BR-6).
  - Return response includes `fineId` so the fine can be collected immediately (FR-Return.Fine-02).
  - Issue rejects an ISBN that does not match the given accession number.
  - Reservation response returns the true live queue position.
- `catalogController`:
  - Borrower identity only returned to staff.
  - ISBN edit implemented per FR-Catalog.Update-02 (allowed until first issue, checksum + duplicate validated; FKs cascade). Previously silently ignored.
  - Adding copies / restoring a Lost or Damaged copy now serves any waiting reservation queue (new `services/reservationQueue.js`); retiring a held copy releases the hold without losing the patron's place.
  - Copy numbering uses max suffix; no-op status changes rejected; actions are logged.
- `ledgerController`, `memberController`: live queue position.
- `reportsController`: validated `startDate`/`endDate` for circulation and fines (and their CSV), new circulation CSV export, fine report totals consistent per period, simplified daily breakdown query.

### Frontend
- **Circulation Desk**: live eligibility + due-date preview, duration limit from policy, "place member in reservation queue" when no copy is free, "Mark as Lost", Collect-now button on overdue return, hold hours shown, new **Fines** tab (look up member, partial/full payment, receipt).
- **Members**: Edit member modal (Administrator also sees borrowing-limit override); inline errors/notices instead of `alert`.
- **Book details**: staff copy-condition controls (Mark lost / Mark damaged / Restore); staff no longer shown a patron-only reserve button.
- **Catalogue search**: "Reserve" action on unavailable titles.
- **Catalogue management**: ISBN editable with the FR-Catalog.Update-02 rule explained.
- **Reports**: date-range filter, circulation CSV, fines detail table, all 8 policy settings editable, inline errors.
- **Patron dashboard / member profile**: live queue position, "ready to collect", full payment history, waived amounts.
- **Help**: removed an unsupported claim (renewals) and documented the features that exist.

### Tests
- `server/tests/e2e.test.js` (new, 27 scenarios, ~370 assertions): auth/lockout/RBAC, catalogue, members, issue/return, fine calculation and cap, payments, waivers, thresholds, policy changes, reservations (queue, hold, expiry, restore), requests, ledgers, reports/CSV, concurrency, inventory-integrity invariants.
- `tests-ui/ui-walkthrough.cjs` (new): 42-step browser walkthrough (Patron, Librarian, Administrator), including the autocomplete forms.
- Existing tests kept; the deactivation test now passes because it runs on an isolated DB.

## Follow-up: faster request / issue entry and demo data

- New `components/Autocomplete.jsx` (keyboard accessible combobox, closes on blur). Used in:
  - **Patron book request**: typing a title suggests catalogue books (with author, ISBN and availability) and fills the ISBN; typing a known ISBN fills the title; editing the title afterwards clears an autofilled ISBN; books not held by the library can still be requested by typing both. Title and ISBN remain required.
  - **Issue desk**: find the member by name or ID, and find the book by title or author (fills the ISBN and shows availability).
- New `server/src/scripts/seedDemo.js` (`npm run seed:demo`): small presentation dataset (10 loans, 3 fines paid / part-paid / waived, 1 reservation, 1 damaged copy, 3 requests). Picks free copies, idempotent, never touches existing records; separate from the test seed. Loaded into `library_db`.
- Walkthrough extended with autocomplete steps; one step re-pointed at a member without loans.
