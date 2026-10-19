process.env.NODE_ENV = 'test'; // isolated library_test_db only
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/server');
const { pool } = require('../src/config/db');
const { sweepExpiredReservationHolds } = require('../src/services/reservationExpiry');
const { localDateString, addDays } = require('../src/utils/dates');

let server;
let base;
const today = () => localDateString();

/** Minimal HTTP client with its own cookie jar per signed-in user. */
function client() {
  const jar = { cookie: '' };
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(jar.cookie ? { Cookie: jar.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) jar.cookie = set[0].split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  };
  return {
    get: (p) => call('GET', p), post: (p, b) => call('POST', p, b || {}), put: (p, b) => call('PUT', p, b),
    patch: (p, b) => call('PATCH', p, b), jar
  };
}

/** Generate a checksum-valid ISBN-13 from a unique 12-digit prefix. */
let isbnSeq = 100000;
function newIsbn() {
  const prefix = '978' + String(900000000 + (isbnSeq++)).slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(prefix[i]) * (i % 2 === 0 ? 1 : 3);
  return prefix + ((10 - (sum % 10)) % 10);
}

const q = async (sql, params = []) => (await pool.query(sql, params))[0];
const one = async (sql, params = []) => (await q(sql, params))[0];

let seq = 0;
async function makeBook(staff, copies = 1, extra = {}) {
  const isbn = newIsbn();
  const res = await staff.post('/api/catalog/books', {
    isbn, title: `Test Book ${isbn}`, author: 'Test Author', category: 'Testing', publisher: 'Test Press',
    edition: '1st', publicationYear: 2020, copiesCount: copies, ...extra
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return { isbn, accessions: res.data.accessionNumbers };
}
async function makeMember(staff, type = 'Student') {
  seq += 1;
  const res = await staff.post('/api/members/register', {
    name: `Tester ${seq}`, institutionalId: `T-${Date.now()}-${seq}`, department: 'Testing',
    email: `tester${Date.now()}${seq}@spit.ac.in`, phone: '9000000000', memberType: type
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const patron = client();
  const login = await patron.post('/api/auth/patron-login', { membershipId: res.data.membershipId, password: 'Member@123' });
  assert.equal(login.status, 200);
  return { id: res.data.membershipId, patron, limit: res.data.borrowingLimit };
}
const backdate = (loanId, daysOverdue) => q(
  'UPDATE loans SET due_date = DATE_SUB(CURDATE(), INTERVAL ? DAY), issue_date = DATE_SUB(CURDATE(), INTERVAL ? DAY) WHERE loan_id = ?',
  [daysOverdue, daysOverdue + 14, loanId]
);
const copyStatus = async (acc) => (await one('SELECT copy_status FROM book_copies WHERE accession_number = ?', [acc])).copy_status;
const title = (isbn) => one('SELECT * FROM book_titles WHERE isbn = ?', [isbn]);

test('OLMS end-to-end', async (t) => {
  await new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
  t.after(async () => { server.close(); await pool.end(); });

  const admin = client();
  const lib = client();
  assert.equal((await admin.post('/api/auth/login', { username: 'admin', password: 'Admin@123' })).status, 200);
  assert.equal((await lib.post('/api/auth/login', { username: 'librarian', password: 'Librarian@123' })).status, 200);

  // ───────────────────────── Auth & access control ─────────────────────────
  await t.test('AUTH: anonymous access rules (SE-1, SE-2)', async () => {
    const anon = client();
    assert.equal((await anon.get('/api/catalog/books')).status, 200);
    assert.equal((await anon.get('/api/catalog/books/9780132350884')).status, 200);
    for (const p of ['/api/circulation/loans', '/api/members', '/api/reports/inventory', '/api/ledger/me', '/api/requests/mine', '/api/circulation/reservations']) {
      assert.equal((await anon.get(p)).status, 401, p);
    }
    assert.equal((await anon.post('/api/circulation/reserve', { isbn: '9780132350884' })).status, 401);
    assert.equal((await anon.get('/api/auth/me')).data.user, null);
  });

  await t.test('AUTH: bad credentials, remaining attempts, validation', async () => {
    const c = client();
    const bad = await c.post('/api/auth/login', { username: 'admin', password: 'nope' });
    assert.equal(bad.status, 401);
    assert.match(bad.data.error, /attempts remaining/);
    assert.equal((await c.post('/api/auth/login', { username: 'admin' })).status, 400);
    assert.equal((await c.post('/api/auth/login', { username: 'ghost', password: 'x' })).status, 401);
    assert.equal((await c.post('/api/auth/patron-login', { membershipId: 'MEM-0000', password: 'x' })).status, 401);
    await q('UPDATE users SET failed_attempts = 0 WHERE username = ?', ['admin']);
  });

  await t.test('AUTH: 5 failed logins lock the account for 15 minutes (SE-8)', async () => {
    const c = client();
    let last;
    for (let i = 0; i < 5; i++) last = await c.post('/api/auth/login', { username: 'locktest', password: 'wrong' });
    assert.equal(last.status, 401); // user does not exist yet
    const bcrypt = require('bcryptjs');
    await q("INSERT INTO users (username, password_hash, full_name, email, role) VALUES ('locktest', ?, 'Lock Test', 'lock@test.in', 'Librarian')", [await bcrypt.hash('Right@123', 10)]);
    for (let i = 0; i < 4; i++) assert.equal((await c.post('/api/auth/login', { username: 'locktest', password: 'wrong' })).status, 401);
    assert.equal((await c.post('/api/auth/login', { username: 'locktest', password: 'wrong' })).status, 429);
    const correct = await c.post('/api/auth/login', { username: 'locktest', password: 'Right@123' });
    assert.equal(correct.status, 429, 'correct password must still be refused while locked');
    const row = await one("SELECT locked_until FROM users WHERE username = 'locktest'");
    assert.ok(row.locked_until);
    await q("UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE username = 'locktest'");
    assert.equal((await c.post('/api/auth/login', { username: 'locktest', password: 'Right@123' })).status, 200);
  });

  await t.test('AUTH: passwords are stored as salted bcrypt hashes (SE-3)', async () => {
    const rows = await q('SELECT password_hash FROM users UNION ALL SELECT password_hash FROM member_credentials');
    assert.ok(rows.length >= 6);
    for (const r of rows) assert.match(r.password_hash, /^\$2[aby]\$\d\d\$/);
  });

  await t.test('RBAC: patrons and librarians are fenced to their roles (SE-4, SE-5, SE-6)', async () => {
    const p = await makeMember(lib);
    assert.equal((await p.patron.get('/api/circulation/loans')).status, 403);
    assert.equal((await p.patron.post('/api/circulation/issue', { membershipId: p.id, isbn: '9780132350884' })).status, 403);
    assert.equal((await p.patron.post('/api/members/register', {})).status, 403);
    assert.equal((await p.patron.get('/api/reports/inventory')).status, 403);
    assert.equal((await p.patron.post('/api/catalog/books', {})).status, 403);
    assert.equal((await p.patron.get('/api/ledger/members/MEM-2026-0001')).status, 403);
    assert.equal((await p.patron.get('/api/members/MEM-2026-0001')).status, 403);
    assert.equal((await p.patron.get(`/api/members/${p.id}`)).status, 200);
    assert.equal((await p.patron.get('/api/requests')).status, 403);
    assert.equal((await lib.get('/api/reports/inventory')).status, 403);
    assert.equal((await lib.put('/api/reports/settings', { settings: { fine_rate_per_day: 3 } })).status, 403);
    assert.equal((await lib.post('/api/circulation/fines/waive', { fineId: 1, waiveAmount: 1, remark: 'x' })).status, 403);
    assert.equal((await lib.post('/api/members/MEM-2026-0002/deactivate')).status, 403);
    const own = await p.patron.get('/api/ledger/me');
    assert.equal(own.status, 200);
    assert.equal(own.data.member.membership_id, p.id);
  });

  await t.test('AUTH: logout destroys the session', async () => {
    const c = client();
    await c.post('/api/auth/login', { username: 'librarian', password: 'Librarian@123' });
    assert.ok((await c.get('/api/auth/me')).data.user);
    assert.equal((await c.post('/api/auth/logout')).status, 200);
    const after = await c.get('/api/circulation/loans');
    assert.equal(after.status, 401);
  });

  // ───────────────────────── Catalog ─────────────────────────
  await t.test('CATALOG: add title, accession numbers, validation (FR-Catalog.Add-01..04)', async () => {
    const { isbn, accessions } = await makeBook(lib, 3);
    assert.deepEqual(accessions, [1, 2, 3].map((n) => `ACC-${isbn}-00${n}`));
    const row = await title(isbn);
    assert.equal(row.total_copies, 3);
    assert.equal(row.available_copies, 3);
    const dup = await lib.post('/api/catalog/books', { isbn, title: 'x', author: 'x', category: 'x', publisher: 'x', edition: 'x', copiesCount: 1 });
    assert.equal(dup.status, 409);
    assert.equal(dup.data.isDuplicate, true);
    const badCheck = await lib.post('/api/catalog/books', { isbn: '9780132350880', title: 'x', author: 'x', category: 'x', publisher: 'x', edition: 'x' });
    assert.equal(badCheck.status, 400);
    assert.equal((await lib.post('/api/catalog/books', { isbn: newIsbn(), title: 'No author' })).status, 400);
    const bad2 = await lib.post('/api/catalog/books', { isbn: newIsbn(), title: 't', author: 'a', category: 'c', publisher: 'p', edition: 'e', copiesCount: 0 });
    assert.equal(bad2.status, 400);
    const isbn10 = await lib.post('/api/catalog/books', { isbn: '0-306-40615-2', title: 'ISBN10 Book', author: 'a', category: 'c', publisher: 'p', edition: 'e', copiesCount: 1 });
    assert.equal(isbn10.status, 201);
    assert.equal(isbn10.data.isbn, '0306406152');
  });

  await t.test('CATALOG: update, ISBN lock after issue (FR-Catalog.Update-01/02)', async () => {
    const { isbn } = await makeBook(lib, 2);
    const upd = await lib.put(`/api/catalog/books/${isbn}`, { title: 'Renamed Title', author: 'New Author', category: 'Renamed', publisher: 'P2', edition: '2nd', publicationYear: 2021 });
    assert.equal(upd.status, 200);
    const got = await lib.get(`/api/catalog/books/${isbn}`);
    assert.equal(got.data.book.title, 'Renamed Title');
    assert.equal(got.data.book.edition, '2nd');
    assert.equal(got.data.book.publication_year, 2021);
    assert.equal((await lib.put(`/api/catalog/books/${newIsbn()}`, { title: 'x' })).status, 404);
    assert.equal((await lib.put(`/api/catalog/books/${isbn}`, { publicationYear: 'abc' })).status, 400);

    // ISBN may change before any issue …
    const fresh = newIsbn();
    const moved = await lib.put(`/api/catalog/books/${isbn}`, { newIsbn: fresh });
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    assert.equal((await lib.get(`/api/catalog/books/${isbn}`)).status, 404);
    const after = await lib.get(`/api/catalog/books/${fresh}`);
    assert.equal(after.data.copies.length, 2);
    assert.equal((await lib.put(`/api/catalog/books/${fresh}`, { newIsbn: '9780132350880' })).status, 400);
    assert.equal((await lib.put(`/api/catalog/books/${fresh}`, { newIsbn: '9780132350884' })).status, 409);

    // … and is locked after an issue.
    const m = await makeMember(lib);
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: m.id, isbn: fresh })).status, 201);
    const locked = await lib.put(`/api/catalog/books/${fresh}`, { newIsbn: newIsbn() });
    assert.equal(locked.status, 400);
    assert.match(locked.data.error, /FR-Catalog.Update-02/);
  });

  await t.test('CATALOG: add copies and mark Lost/Damaged (FR-Catalog.Remove-01..03)', async () => {
    const { isbn, accessions } = await makeBook(lib, 2);
    const add = await lib.post(`/api/catalog/books/${isbn}/copies`, { count: 2 });
    assert.equal(add.status, 200);
    assert.deepEqual(add.data.accessionNumbers, [`ACC-${isbn}-003`, `ACC-${isbn}-004`]);
    let row = await title(isbn);
    assert.equal(row.total_copies, 4); assert.equal(row.available_copies, 4);
    assert.equal((await lib.post(`/api/catalog/books/${isbn}/copies`, { count: 0 })).status, 400);

    assert.equal((await lib.patch(`/api/catalog/copies/${accessions[0]}/status`, { status: 'Lost', remarks: 'Not on shelf' })).status, 200);
    assert.equal(await copyStatus(accessions[0]), 'Lost');
    row = await title(isbn);
    assert.equal(row.available_copies, 3); assert.equal(row.total_copies, 4);
    assert.equal((await lib.patch(`/api/catalog/copies/${accessions[0]}/status`, { status: 'Lost' })).status, 400, 'no-op rejected');
    assert.equal((await lib.patch(`/api/catalog/copies/${accessions[1]}/status`, { status: 'Damaged' })).status, 200);
    assert.equal((await title(isbn)).available_copies, 2);
    assert.equal((await lib.patch(`/api/catalog/copies/${accessions[0]}/status`, { status: 'Available' })).status, 200);
    assert.equal((await title(isbn)).available_copies, 3);
    assert.equal((await lib.patch(`/api/catalog/copies/${accessions[0]}/status`, { status: 'Bogus' })).status, 400);
    assert.equal((await lib.patch('/api/catalog/copies/NOPE/status', { status: 'Lost' })).status, 404);

    // A copy on loan cannot be retired (Remove-02).
    const m = await makeMember(lib);
    const issued = await lib.post('/api/circulation/issue', { membershipId: m.id, accessionNumber: accessions[0] });
    assert.equal(issued.status, 201);
    const blocked = await lib.patch(`/api/catalog/copies/${accessions[0]}/status`, { status: 'Lost' });
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.error, /Remove-02/);
    assert.equal(await copyStatus(accessions[0]), 'Issued');
  });

  await t.test('SEARCH: query, filter, sort, paginate, empty (FR-Search.*)', async () => {
    const anon = client();
    const byIsbn = await anon.get('/api/catalog/books?q=9780132350884');
    assert.equal(byIsbn.data.data.length, 1);
    const byAuthor = await anon.get('/api/catalog/books?q=Robert');
    assert.ok(byAuthor.data.data.some((b) => b.isbn === '9780132350884'));
    const cat = await anon.get('/api/catalog/books?category=Operating%20Systems');
    assert.ok(cat.data.data.length >= 1 && cat.data.data.every((b) => b.category === 'Operating Systems'));
    const sorted = await anon.get('/api/catalog/books?sortBy=author&order=ASC&limit=50');
    const authors = sorted.data.data.map((b) => b.author);
    for (let i = 1; i < authors.length; i++) {
      assert.ok(authors[i - 1].toLowerCase() <= authors[i].toLowerCase(), `authors not ascending at ${i}: ${authors[i - 1]} / ${authors[i]}`);
    }
    const page1 = await anon.get('/api/catalog/books?limit=3&page=1');
    const page2 = await anon.get('/api/catalog/books?limit=3&page=2');
    assert.equal(page1.data.data.length, 3);
    assert.ok(page1.data.pagination.totalPages >= 2);
    assert.notEqual(page1.data.data[0].isbn, page2.data.data[0].isbn);
    const none = await anon.get('/api/catalog/books?q=zzzzzzzzqqqq');
    assert.equal(none.data.data.length, 0);
    const { isbn, accessions } = await makeBook(lib, 1);
    const m = await makeMember(lib);
    await lib.post('/api/circulation/issue', { membershipId: m.id, accessionNumber: accessions[0] });
    const onlyAvail = await anon.get(`/api/catalog/books?availableOnly=true&q=${isbn}`);
    assert.equal(onlyAvail.data.data.length, 0);
    const detail = await anon.get(`/api/catalog/books/${isbn}`);
    assert.equal(detail.data.book.available_copies, 0);
    assert.equal(detail.data.book.earliest_expected_return, addDays(today(), 14));
    assert.ok((await anon.get('/api/catalog/categories')).data.categories.length > 0);

    // Borrower identity must never leak to anonymous or patron callers (SE-6, OR-3).
    const issuedCopy = detail.data.copies.find((c) => c.copy_status === 'Issued');
    assert.ok(issuedCopy.due_date);
    for (const key of ['borrower_name', 'membership_id', 'loan_id', 'issue_date']) assert.ok(!(key in issuedCopy), `anonymous response leaks ${key}`);
    const patronView = await m.patron.get(`/api/catalog/books/${isbn}`);
    assert.ok(!('borrower_name' in patronView.data.copies.find((c) => c.copy_status === 'Issued')));
    const staffView = await lib.get(`/api/catalog/books/${isbn}`);
    assert.equal(staffView.data.copies.find((c) => c.copy_status === 'Issued').membership_id, m.id);
  });

  // ───────────────────────── Members ─────────────────────────
  await t.test('MEMBERS: register, defaults, uniqueness, overrides, update, view (FR-Member.*)', async () => {
    const stamp = Date.now();
    const reg = await lib.post('/api/members/register', { name: 'Reg Student', institutionalId: `S-${stamp}`, department: 'IT', email: `s${stamp}@spit.ac.in`, phone: '9111111111', memberType: 'Student' });
    assert.equal(reg.status, 201);
    assert.match(reg.data.membershipId, /^MEM-\d{4}-\d{4,}$/);
    assert.equal(reg.data.borrowingLimit, 3);
    assert.equal(reg.data.accountStatus, 'Active');
    const fac = await lib.post('/api/members/register', { name: 'Reg Faculty', institutionalId: `F-${stamp}`, department: 'IT', email: `f${stamp}@spit.ac.in`, phone: '9111111112', memberType: 'Faculty' });
    assert.equal(fac.data.borrowingLimit, 8);
    const dupInst = await lib.post('/api/members/register', { name: 'x', institutionalId: `S-${stamp}`, department: 'IT', email: `other${stamp}@spit.ac.in`, phone: '1', memberType: 'Student' });
    assert.equal(dupInst.status, 409);
    const dupEmail = await lib.post('/api/members/register', { name: 'x', institutionalId: `Z-${stamp}`, department: 'IT', email: `s${stamp}@spit.ac.in`, phone: '1', memberType: 'Student' });
    assert.equal(dupEmail.status, 409);
    assert.equal((await lib.post('/api/members/register', { name: 'x' })).status, 400);
    assert.equal((await lib.post('/api/members/register', { name: 'x', institutionalId: 'q', department: 'd', email: 'e@e.in', phone: '1', memberType: 'Alien' })).status, 400);
    const libOverride = await lib.post('/api/members/register', { name: 'x', institutionalId: `L-${stamp}`, department: 'd', email: `l${stamp}@e.in`, phone: '1', memberType: 'Student', customBorrowingLimit: 9 });
    assert.equal(libOverride.status, 403);
    const adminOverride = await admin.post('/api/members/register', { name: 'Admin Reg', institutionalId: `A-${stamp}`, department: 'd', email: `a${stamp}@e.in`, phone: '1', memberType: 'Student', customBorrowingLimit: 5 });
    assert.equal(adminOverride.status, 201);
    assert.equal(adminOverride.data.borrowingLimit, 5);

    const id = reg.data.membershipId;
    assert.equal((await lib.put(`/api/members/${id}`, { phone: '9222222222', department: 'CSE', email: `new${stamp}@spit.ac.in` })).status, 200);
    const row = await one('SELECT phone, department, email FROM members WHERE membership_id = ?', [id]);
    assert.deepEqual({ ...row }, { phone: '9222222222', department: 'CSE', email: `new${stamp}@spit.ac.in` });
    assert.equal((await lib.put(`/api/members/${id}`, { borrowingLimit: 6 })).status, 403);
    assert.equal((await admin.put(`/api/members/${id}`, { borrowingLimit: 6 })).status, 200);
    assert.equal((await admin.put(`/api/members/${id}`, { borrowingLimit: 0 })).status, 400);
    assert.equal((await lib.put(`/api/members/${id}`, { email: `f${stamp}@spit.ac.in` })).status, 409);
    assert.equal((await lib.put('/api/members/MEM-NOPE', { phone: '1' })).status, 404);
    assert.equal((await lib.put(`/api/members/${id}`, { accountStatus: 'Inactive' })).status, 400);

    const search = await lib.get(`/api/members?q=Reg%20Student`);
    assert.ok(search.data.data.some((m) => m.membership_id === id));
    const typeFilter = await lib.get('/api/members?memberType=Faculty');
    assert.ok(typeFilter.data.data.every((m) => m.member_type === 'Faculty'));
    const detail = await lib.get(`/api/members/${id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.outstandingFineBalance, 0);
  });

  await t.test('MEMBERS: deactivate/reactivate rules (FR-Member.Deactivate-01/02, BR-3)', async () => {
    const { isbn, accessions } = await makeBook(lib, 2);
    const m = await makeMember(lib);
    await lib.post('/api/circulation/issue', { membershipId: m.id, accessionNumber: accessions[0] });
    const blocked = await admin.post(`/api/members/${m.id}/deactivate`);
    assert.equal(blocked.status, 400);
    assert.equal(blocked.data.blockingReason.activeLoansCount, 1);
    const ret = await lib.post('/api/circulation/return', { accessionNumber: accessions[0] });
    assert.equal(ret.status, 200);

    // Unpaid fine blocks deactivation.
    const loan = await lib.post('/api/circulation/issue', { membershipId: m.id, accessionNumber: accessions[1] });
    await backdate(loan.data.receipt.loanId, 5);
    const retFine = await lib.post('/api/circulation/return', { accessionNumber: accessions[1] });
    assert.equal(retFine.data.returnSummary.fineAmount, 10);
    const blockedFine = await admin.post(`/api/members/${m.id}/deactivate`);
    assert.equal(blockedFine.status, 400);
    assert.equal(blockedFine.data.blockingReason.unpaidFineAmount, 10);
    const pay = await lib.post('/api/circulation/fines/pay', { fineId: retFine.data.returnSummary.fineId, amount: 10 });
    assert.equal(pay.status, 200);

    assert.equal((await admin.post(`/api/members/${m.id}/deactivate`)).status, 200);
    assert.equal((await one('SELECT account_status s FROM members WHERE membership_id = ?', [m.id])).s, 'Inactive');
    const refused = await lib.post('/api/circulation/issue', { membershipId: m.id, isbn });
    assert.equal(refused.status, 400);
    assert.equal(refused.data.reason, 'INACTIVE_ACCOUNT');
    const resv = await m.patron.post('/api/circulation/reserve', { isbn });
    assert.equal(resv.status, 400);
    assert.equal((await admin.post(`/api/members/${m.id}/reactivate`)).status, 200);
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: m.id, isbn })).status, 201);
    assert.equal((await admin.post('/api/members/MEM-NOPE/deactivate')).status, 404);
  });

  // ───────────────────────── Issue / Return ─────────────────────────
  await t.test('ISSUE: preview, issue, receipt, DB effects (FR-Issue.*)', async () => {
    const { isbn, accessions } = await makeBook(lib, 3);
    const m = await makeMember(lib);
    const prev = await lib.get(`/api/circulation/issue/preview?membershipId=${m.id}`);
    assert.equal(prev.status, 200);
    assert.equal(prev.data.eligible, true);
    assert.equal(prev.data.dueDate, addDays(today(), 14));
    assert.equal(prev.data.policy.maxLoanDays, 14);
    assert.equal((await lib.get('/api/circulation/issue/preview?membershipId=NOPE')).status, 404);
    assert.equal((await lib.get('/api/circulation/issue/preview')).status, 400);

    const res = await lib.post('/api/circulation/issue', { membershipId: m.id, isbn });
    assert.equal(res.status, 201);
    const r = res.data.receipt;
    assert.equal(r.issueDate, today());
    assert.equal(r.dueDate, addDays(today(), 14));
    assert.equal(r.memberName, (await one('SELECT name FROM members WHERE membership_id = ?', [m.id])).name);
    assert.equal(await copyStatus(r.accessionNumber), 'Issued');
    assert.equal((await title(isbn)).available_copies, 2);
    const loan = await one('SELECT * FROM loans WHERE loan_id = ?', [r.loanId]);
    assert.equal(loan.loan_status, 'Issued');
    assert.ok(loan.issued_by);
    const log = await one("SELECT * FROM transaction_logs WHERE action_type = 'ISSUE' AND membership_id = ? ORDER BY log_id DESC LIMIT 1", [m.id]);
    assert.ok(log && log.details.includes(r.accessionNumber));

    // same copy cannot be issued twice; specific copy; mismatched ISBN; unknown copy / member
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: m.id, accessionNumber: r.accessionNumber })).status, 400);
    const specific = await lib.post('/api/circulation/issue', { membershipId: m.id, accessionNumber: accessions[2] });
    assert.equal(specific.status, 201);
    assert.equal(specific.data.receipt.accessionNumber, accessions[2]);
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: m.id, accessionNumber: 'ACC-NOPE' })).status, 404);
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: 'MEM-NOPE', isbn })).status, 404);
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: m.id })).status, 400);
    const mismatch = await lib.post('/api/circulation/issue', { membershipId: m.id, accessionNumber: accessions[1], isbn: '9780132350884' });
    assert.equal(mismatch.status, 400);
    assert.equal(await copyStatus(accessions[1]), 'Available');
  });

  await t.test('ISSUE: borrowing limit, loan period, faculty, custom duration (BR-1, BR-2)', async () => {
    const { isbn } = await makeBook(lib, 10);
    const s = await makeMember(lib, 'Student');
    for (let i = 0; i < 3; i++) assert.equal((await lib.post('/api/circulation/issue', { membershipId: s.id, isbn })).status, 201);
    const fourth = await lib.post('/api/circulation/issue', { membershipId: s.id, isbn });
    assert.equal(fourth.status, 400);
    assert.equal(fourth.data.reason, 'BORROWING_LIMIT_EXCEEDED');
    assert.equal((await title(isbn)).available_copies, 7, 'refused issue must not change inventory');
    const prev = await lib.get(`/api/circulation/issue/preview?membershipId=${s.id}`);
    assert.equal(prev.data.eligible, false);

    const f = await makeMember(lib, 'Faculty');
    assert.equal(f.limit, 8);
    const fi = await lib.post('/api/circulation/issue', { membershipId: f.id, isbn });
    assert.equal(fi.data.receipt.dueDate, addDays(today(), 30));
    const custom = await lib.post('/api/circulation/issue', { membershipId: f.id, isbn, requestedDays: 7 });
    assert.equal(custom.data.receipt.dueDate, addDays(today(), 7));
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: f.id, isbn, requestedDays: 31 })).status, 400);
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: f.id, isbn, requestedDays: 0 })).status, 400);
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: f.id, isbn, requestedDays: 2.5 })).status, 400);
    // Admin override of a member's limit takes effect immediately.
    await admin.put(`/api/members/${s.id}`, { borrowingLimit: 4 });
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: s.id, isbn })).status, 201);
  });

  await t.test('RETURN: on time, locate errors, reserved flows untouched (FR-Return.*)', async () => {
    const { isbn, accessions } = await makeBook(lib, 1);
    const m = await makeMember(lib);
    await lib.post('/api/circulation/issue', { membershipId: m.id, isbn });
    assert.equal((await title(isbn)).available_copies, 0);
    const ret = await lib.post('/api/circulation/return', { accessionNumber: accessions[0] });
    assert.equal(ret.status, 200);
    const s = ret.data.returnSummary;
    assert.equal(s.isOverdue, false); assert.equal(s.fineAmount, 0); assert.equal(s.copyStatus, 'Available');
    assert.equal(await copyStatus(accessions[0]), 'Available');
    assert.equal((await title(isbn)).available_copies, 1);
    const loan = await one('SELECT * FROM loans WHERE loan_id = ?', [s.loanId]);
    assert.equal(loan.loan_status, 'Returned'); assert.equal(loan.return_date, today());
    assert.equal((await one('SELECT COUNT(*) c FROM fines WHERE loan_id = ?', [s.loanId])).c, 0);
    const again = await lib.post('/api/circulation/return', { accessionNumber: accessions[0] });
    assert.equal(again.status, 404);
    assert.equal((await lib.post('/api/circulation/return', { accessionNumber: 'ACC-NOPE' })).status, 404);
    assert.equal((await lib.post('/api/circulation/return', {})).status, 400);
    const byLoan = await lib.post('/api/circulation/issue', { membershipId: m.id, isbn });
    assert.equal((await lib.post('/api/circulation/return', { loanId: byLoan.data.receipt.loanId })).status, 200);
  });

  await t.test('FINES: calculation, cap, immediate payment, damaged, lost (FR-Fine.Calculate, FR-Return.Fine/Condition)', async () => {
    const { isbn, accessions } = await makeBook(lib, 5);
    const m = await makeMember(lib, 'Faculty');
    const issue = async (acc) => (await lib.post('/api/circulation/issue', { membershipId: m.id, accessionNumber: acc })).data.receipt.loanId;

    // 10 days late → Rs 20
    const l1 = await issue(accessions[0]); await backdate(l1, 10);
    const r1 = await lib.post('/api/circulation/return', { accessionNumber: accessions[0] });
    assert.equal(r1.data.returnSummary.daysOverdue, 10);
    assert.equal(r1.data.returnSummary.fineAmount, 20);
    const f1 = await one('SELECT * FROM fines WHERE loan_id = ?', [l1]);
    assert.equal(Number(f1.amount_charged), 20); assert.equal(Number(f1.amount_paid), 0);

    // 1 day late → Rs 2 (boundary)
    const l2 = await issue(accessions[1]); await backdate(l2, 1);
    assert.equal((await lib.post('/api/circulation/return', { accessionNumber: accessions[1] })).data.returnSummary.fineAmount, 2);

    // due today is NOT overdue
    const l3 = await issue(accessions[2]); await backdate(l3, 0);
    assert.equal((await lib.post('/api/circulation/return', { accessionNumber: accessions[2] })).data.returnSummary.isOverdue, false);

    // 150 days late → capped Rs 200 (BR-6)
    const l4 = await issue(accessions[3]); await backdate(l4, 150);
    const r4 = await lib.post('/api/circulation/return', { accessionNumber: accessions[3], payFineNow: true });
    assert.equal(r4.data.returnSummary.fineAmount, 200);
    assert.equal(r4.data.returnSummary.finePaid, true);
    const f4 = await one('SELECT * FROM fines WHERE loan_id = ?', [l4]);
    assert.equal(Number(f4.amount_paid), 200);
    const pay4 = await one('SELECT * FROM fine_payments WHERE fine_id = ?', [f4.fine_id]);
    assert.equal(Number(pay4.amount), 200); assert.ok(pay4.receipt_number);

    // Damaged return: copy not restocked, total unchanged, no overdue fine
    const before = await title(isbn);
    const l5 = await issue(accessions[4]);
    const r5 = await lib.post('/api/circulation/return', { accessionNumber: accessions[4], flagAsDamaged: true });
    assert.equal(r5.data.returnSummary.copyStatus, 'Damaged');
    assert.equal(await copyStatus(accessions[4]), 'Damaged');
    const after = await title(isbn);
    assert.equal(after.total_copies, before.total_copies);
    assert.equal(after.available_copies, before.available_copies - 1);
    assert.equal((await one('SELECT loan_status s FROM loans WHERE loan_id = ?', [l5])).s, 'Returned');
    assert.equal((await lib.post('/api/circulation/return', { accessionNumber: accessions[4], flagAsDamaged: true, flagAsLost: true })).status, 404);

    // Lost: loan → Lost, copy → Lost, capped fine charged
    const lostBook = await makeBook(lib, 1);
    const lm = await makeMember(lib);
    const ll = (await lib.post('/api/circulation/issue', { membershipId: lm.id, isbn: lostBook.isbn })).data.receipt.loanId;
    assert.equal((await lib.post('/api/circulation/return', { loanId: ll, flagAsLost: true, flagAsDamaged: true })).status, 400);
    const lost = await lib.post('/api/circulation/return', { loanId: ll, flagAsLost: true });
    assert.equal(lost.status, 200);
    assert.equal(lost.data.returnSummary.fineAmount, 200);
    assert.equal(await copyStatus(lostBook.accessions[0]), 'Lost');
    assert.equal((await one('SELECT loan_status s FROM loans WHERE loan_id = ?', [ll])).s, 'Lost');
    assert.equal((await title(lostBook.isbn)).available_copies, 0);
  });

  await t.test('FINES: payments, partial, over-payment, waiver, threshold (FR-Fine.*, BR-4, BR-8)', async () => {
    const { isbn, accessions } = await makeBook(lib, 4);
    const m = await makeMember(lib);
    // Create a Rs 200 fine (lost-level) via a 150-day overdue return.
    const loanId = (await lib.post('/api/circulation/issue', { membershipId: m.id, accessionNumber: accessions[0] })).data.receipt.loanId;
    await backdate(loanId, 150);
    const ret = await lib.post('/api/circulation/return', { accessionNumber: accessions[0] });
    const fineId = ret.data.returnSummary.fineId;
    assert.equal(ret.data.returnSummary.fineAmount, 200);

    // Threshold: Rs 200 > Rs 100 blocks issuing
    const blocked = await lib.post('/api/circulation/issue', { membershipId: m.id, isbn });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.data.reason, 'FINE_THRESHOLD_EXCEEDED');
    assert.equal((await lib.get(`/api/circulation/issue/preview?membershipId=${m.id}`)).data.eligible, false);

    // Patron sees balance (FR-Fine.View-01)
    const ledger = await m.patron.get('/api/ledger/me');
    assert.equal(ledger.data.summary.finesOutstanding, 200);
    assert.equal(ledger.data.fines.length, 1);

    // Invalid payments
    assert.equal((await lib.post('/api/circulation/fines/pay', { fineId, amount: 0 })).status, 400);
    assert.equal((await lib.post('/api/circulation/fines/pay', { fineId, amount: -5 })).status, 400);
    assert.equal((await lib.post('/api/circulation/fines/pay', { fineId, amount: 'abc' })).status, 400);
    assert.equal((await lib.post('/api/circulation/fines/pay', { fineId, amount: 500 })).status, 400);
    assert.equal((await lib.post('/api/circulation/fines/pay', { fineId: 999999, amount: 5 })).status, 404);
    assert.equal((await m.patron.post('/api/circulation/fines/pay', { fineId, amount: 5 })).status, 403);

    // Partial payment 120 → remaining 80 → below threshold → can borrow again
    const partial = await lib.post('/api/circulation/fines/pay', { fineId, amount: 120 });
    assert.equal(partial.status, 200);
    assert.equal(partial.data.receipt.remainingBalance, 80);
    assert.ok(partial.data.receipt.receiptNumber);
    assert.equal(Number((await one('SELECT amount_paid p FROM fines WHERE fine_id = ?', [fineId])).p), 120);
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: m.id, isbn })).status, 201);
    assert.equal((await m.patron.get('/api/ledger/me')).data.payments.length, 1);

    // Waiver: admin only, remark mandatory, cannot exceed outstanding
    assert.equal((await lib.post('/api/circulation/fines/waive', { fineId, waiveAmount: 10, remark: 'x' })).status, 403);
    assert.equal((await admin.post('/api/circulation/fines/waive', { fineId, waiveAmount: 10 })).status, 400);
    assert.equal((await admin.post('/api/circulation/fines/waive', { fineId, waiveAmount: 10, remark: '   ' })).status, 400);
    assert.equal((await admin.post('/api/circulation/fines/waive', { fineId, waiveAmount: 500, remark: 'too much' })).status, 400);
    assert.equal((await admin.post('/api/circulation/fines/waive', { fineId, waiveAmount: 30, remark: 'Medical emergency' })).status, 200);
    const waived = await one('SELECT * FROM fines WHERE fine_id = ?', [fineId]);
    assert.equal(Number(waived.waived_amount), 30);
    assert.equal(waived.waiver_remark, 'Medical emergency');
    assert.ok(waived.waived_by);
    assert.ok(await one("SELECT * FROM transaction_logs WHERE action_type = 'FINE_WAIVE' AND details LIKE '%Medical emergency%'"));
    assert.equal((await m.patron.get('/api/ledger/me')).data.summary.finesOutstanding, 50);

    // Pay the rest
    const rest = await lib.post('/api/circulation/fines/pay', { fineId, amount: 50 });
    assert.equal(rest.data.receipt.remainingBalance, 0);
    assert.equal((await lib.post('/api/circulation/fines/pay', { fineId, amount: 1 })).status, 400, 'nothing left to pay');
    const detail = await lib.get(`/api/members/${m.id}`);
    assert.equal(detail.data.outstandingFineBalance, 0);
    assert.equal(detail.data.payments.length, 2);
  });

  await t.test('POLICY: administrator settings take effect immediately (SE-5, BR-5)', async () => {
    assert.equal((await admin.put('/api/reports/settings', { settings: { fine_rate_per_day: -1 } })).status, 400);
    assert.equal((await admin.put('/api/reports/settings', { settings: { student_loan_days: 2.5 } })).status, 400);
    assert.equal((await admin.put('/api/reports/settings', { settings: { evil_key: 1 } })).status, 400);
    assert.equal((await admin.put('/api/reports/settings', { settings: {} })).status, 400);
    assert.equal((await admin.put('/api/reports/settings', { settings: { fine_rate_per_day: 5, student_loan_days: 10 } })).status, 200);
    try {
      const { isbn, accessions } = await makeBook(lib, 1);
      const m = await makeMember(lib);
      const issue = await lib.post('/api/circulation/issue', { membershipId: m.id, isbn });
      assert.equal(issue.data.receipt.dueDate, addDays(today(), 10));
      assert.equal((await lib.post('/api/circulation/issue', { membershipId: m.id, isbn, requestedDays: 11 })).status, 400);
      await backdate(issue.data.receipt.loanId, 3);
      const ret = await lib.post('/api/circulation/return', { accessionNumber: accessions[0] });
      assert.equal(ret.data.returnSummary.fineAmount, 15);
      const get = await admin.get('/api/reports/settings');
      assert.equal(get.data.settings.fine_rate_per_day, '5');
    } finally {
      await admin.put('/api/reports/settings', { settings: { fine_rate_per_day: 2, student_loan_days: 14 } });
    }
    assert.equal((await admin.get('/api/reports/settings')).data.settings.fine_rate_per_day, '2');
  });

  // ───────────────────────── Reservations ─────────────────────────
  await t.test('RESERVE: create, queue, rules, cancel (FR-Reserve.*)', async () => {
    const { isbn, accessions } = await makeBook(lib, 1);
    const a = await makeMember(lib); const b = await makeMember(lib); const c = await makeMember(lib);
    // cannot reserve while a copy is available
    const early = await b.patron.post('/api/circulation/reserve', { isbn });
    assert.equal(early.status, 400);
    assert.match(early.data.error, /Create-01/);
    await lib.post('/api/circulation/issue', { membershipId: a.id, isbn });
    const r1 = await b.patron.post('/api/circulation/reserve', { isbn });
    assert.equal(r1.status, 201); assert.equal(r1.data.reservation.queuePosition, 1);
    const r2 = await c.patron.post('/api/circulation/reserve', { isbn });
    assert.equal(r2.data.reservation.queuePosition, 2);
    const dup = await b.patron.post('/api/circulation/reserve', { isbn });
    assert.equal(dup.status, 400); assert.match(dup.data.error, /Create-02/);
    assert.equal((await b.patron.post('/api/circulation/reserve', { isbn: newIsbn() })).status, 404);
    assert.equal((await b.patron.post('/api/circulation/reserve', {})).status, 400);

    // staff see the whole queue (FR-Reserve.View-01)
    const queue = await lib.get(`/api/circulation/reservations?q=${isbn}`);
    assert.equal(queue.data.reservations.length, 2);
    assert.deepEqual(queue.data.reservations.map((r) => r.live_queue_position), [1, 2]);

    // patron can only cancel their own
    const foreign = await c.patron.post(`/api/circulation/reserve/${r1.data.reservation.reservationId}/cancel`);
    assert.equal(foreign.status, 404);
    // cancelling B moves C up
    assert.equal((await b.patron.post(`/api/circulation/reserve/${r1.data.reservation.reservationId}/cancel`)).status, 200);
    const cLedger = await c.patron.get('/api/ledger/me');
    assert.equal(cLedger.data.reservations[0].live_queue_position, 1);
    assert.equal((await b.patron.post(`/api/circulation/reserve/${r1.data.reservation.reservationId}/cancel`)).status, 404, 'already cancelled');
    // staff can reserve on behalf of a member (FR-Issue.Copy-02)
    const onBehalf = await lib.post('/api/circulation/reserve', { isbn, membershipId: b.id });
    assert.equal(onBehalf.status, 201);
    assert.equal(onBehalf.data.reservation.queuePosition, 2);
    // staff without a member id are refused
    assert.equal((await lib.post('/api/circulation/reserve', { isbn })).status, 400);
    assert.equal(await copyStatus(accessions[0]), 'Issued');
  });

  await t.test('RESERVE: return holds copy for first in queue, only they can issue it (FR-Return.Reservation-01, BR-7)', async () => {
    const { isbn, accessions } = await makeBook(lib, 1);
    const a = await makeMember(lib); const b = await makeMember(lib); const c = await makeMember(lib);
    await lib.post('/api/circulation/issue', { membershipId: a.id, isbn });
    await b.patron.post('/api/circulation/reserve', { isbn });
    await c.patron.post('/api/circulation/reserve', { isbn });

    const ret = await lib.post('/api/circulation/return', { accessionNumber: accessions[0] });
    assert.equal(ret.data.returnSummary.copyStatus, 'Reserved_Hold');
    assert.equal(ret.data.returnSummary.reservationHold.membershipId, b.id);
    assert.equal(ret.data.returnSummary.reservationHold.holdHours, 48);
    assert.equal(await copyStatus(accessions[0]), 'Reserved_Hold');
    assert.equal((await title(isbn)).available_copies, 0, 'held copy is not generally available');
    const res = await one("SELECT * FROM reservations WHERE membership_id = ? AND isbn = ?", [b.id, isbn]);
    assert.equal(res.held_accession_number, accessions[0]);
    const hours = (new Date(res.hold_expires_at) - Date.now()) / 3600000;
    assert.ok(hours > 47 && hours <= 48.1, `hold ≈ 48h, got ${hours}`);

    // C cannot take the held copy, neither by ISBN nor accession
    const cIsbn = await lib.post('/api/circulation/issue', { membershipId: c.id, isbn });
    assert.equal(cIsbn.status, 400); assert.equal(cIsbn.data.canReserve, true);
    const cAcc = await lib.post('/api/circulation/issue', { membershipId: c.id, accessionNumber: accessions[0] });
    assert.equal(cAcc.status, 400); assert.match(cAcc.data.error, /held for another/);
    // A (not in queue) cannot either
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: a.id, isbn })).status, 400);

    // B can: reservation becomes Fulfilled, inventory stays consistent
    const bIssue = await lib.post('/api/circulation/issue', { membershipId: b.id, isbn });
    assert.equal(bIssue.status, 201);
    assert.equal(bIssue.data.receipt.accessionNumber, accessions[0]);
    assert.equal((await one('SELECT status s FROM reservations WHERE reservation_id = ?', [res.reservation_id])).s, 'Fulfilled');
    assert.equal(await copyStatus(accessions[0]), 'Issued');
    assert.equal((await title(isbn)).available_copies, 0);

    // B returns → C gets the hold; C cancels → nobody waits → copy becomes Available
    await lib.post('/api/circulation/return', { accessionNumber: accessions[0] });
    const cRes = await one("SELECT * FROM reservations WHERE membership_id = ? AND isbn = ? AND status = 'Active'", [c.id, isbn]);
    assert.equal(cRes.held_accession_number, accessions[0]);
    const cancel = await c.patron.post(`/api/circulation/reserve/${cRes.reservation_id}/cancel`);
    assert.equal(cancel.status, 200);
    assert.equal(await copyStatus(accessions[0]), 'Available');
    assert.equal((await title(isbn)).available_copies, 1);
  });

  await t.test('RESERVE: hold expiry passes the copy down the queue, then releases it (FR-Reserve.Hold-01)', async () => {
    const { isbn, accessions } = await makeBook(lib, 1);
    const a = await makeMember(lib); const b = await makeMember(lib); const c = await makeMember(lib);
    await lib.post('/api/circulation/issue', { membershipId: a.id, isbn });
    await b.patron.post('/api/circulation/reserve', { isbn });
    await c.patron.post('/api/circulation/reserve', { isbn });
    await lib.post('/api/circulation/return', { accessionNumber: accessions[0] });

    await q("UPDATE reservations SET hold_expires_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE membership_id = ? AND isbn = ?", [b.id, isbn]);
    assert.deepEqual(await sweepExpiredReservationHolds(), { processed: 1 });
    assert.equal((await one('SELECT status s FROM reservations WHERE membership_id = ? AND isbn = ?', [b.id, isbn])).s, 'Expired');
    const cRes = await one('SELECT * FROM reservations WHERE membership_id = ? AND isbn = ?', [c.id, isbn]);
    assert.equal(cRes.held_accession_number, accessions[0]);
    assert.equal(await copyStatus(accessions[0]), 'Reserved_Hold');
    assert.equal((await title(isbn)).available_copies, 0);

    await q("UPDATE reservations SET hold_expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE membership_id = ? AND isbn = ?", [c.id, isbn]);
    assert.deepEqual(await sweepExpiredReservationHolds(), { processed: 1 });
    assert.equal(await copyStatus(accessions[0]), 'Available');
    assert.equal((await title(isbn)).available_copies, 1);
    assert.deepEqual(await sweepExpiredReservationHolds(), { processed: 0 }, 'sweep is idempotent');
  });

  await t.test('RESERVE: new/restored copies serve a waiting queue; retiring a held copy keeps the place', async () => {
    const { isbn, accessions } = await makeBook(lib, 1);
    const a = await makeMember(lib); const b = await makeMember(lib);
    await lib.post('/api/circulation/issue', { membershipId: a.id, isbn });
    await b.patron.post('/api/circulation/reserve', { isbn });

    const add = await lib.post(`/api/catalog/books/${isbn}/copies`, { count: 1 });
    assert.equal(add.data.reservationHolds.length, 1);
    const newAcc = add.data.accessionNumbers[0];
    assert.equal(await copyStatus(newAcc), 'Reserved_Hold');
    assert.equal((await title(isbn)).available_copies, 0);
    assert.equal((await one('SELECT held_accession_number h FROM reservations WHERE membership_id = ? AND isbn = ?', [b.id, isbn])).h, newAcc);

    // retire the held copy: reservation stays Active but loses the hold
    assert.equal((await lib.patch(`/api/catalog/copies/${newAcc}/status`, { status: 'Damaged' })).status, 200);
    const res = await one("SELECT * FROM reservations WHERE membership_id = ? AND isbn = ?", [b.id, isbn]);
    assert.equal(res.status, 'Active'); assert.equal(res.held_accession_number, null);
    assert.equal((await title(isbn)).available_copies, 0);
    // restore it: B is served again
    assert.equal((await lib.patch(`/api/catalog/copies/${newAcc}/status`, { status: 'Available' })).status, 200);
    assert.equal(await copyStatus(newAcc), 'Reserved_Hold');
    assert.equal((await title(isbn)).available_copies, 0);
    void accessions;
  });

  // ───────────────────────── Book requests ─────────────────────────
  await t.test('REQUESTS: patron submits, staff review, issue links request (patron request workflow)', async () => {
    const { isbn } = await makeBook(lib, 1);
    const m = await makeMember(lib);
    const policy = await m.patron.get('/api/requests/policy');
    assert.equal(policy.data.maxDays, 14);
    const payload = { title: 'Requested Book', isbn, requestedDays: 7, note: 'Need for exam' };
    assert.equal((await m.patron.post('/api/requests', { ...payload, isbn: '1234567890123' })).status, 400);
    assert.equal((await m.patron.post('/api/requests', { ...payload, title: '' })).status, 400);
    assert.equal((await m.patron.post('/api/requests', { ...payload, requestedDays: 15 })).status, 400);
    assert.equal((await m.patron.post('/api/requests', { ...payload, requestedDays: 0 })).status, 400);
    assert.equal((await lib.post('/api/requests', payload)).status, 403, 'staff are not patrons');
    const created = await m.patron.post('/api/requests', payload);
    assert.equal(created.status, 201);
    const id = created.data.request.requestId;
    assert.equal((await m.patron.post('/api/requests', payload)).status, 409, 'duplicate pending request');
    assert.equal((await m.patron.patch(`/api/requests/${id}/review`, { status: 'Approved' })).status, 403);
    assert.equal((await lib.patch(`/api/requests/${id}/review`, { status: 'Maybe' })).status, 400);
    assert.equal((await lib.patch(`/api/requests/${id}/review`, { status: 'Approved', staffNote: 'OK' })).status, 200);
    assert.equal((await lib.patch(`/api/requests/${id}/review`, { status: 'Rejected' })).status, 409);
    assert.equal((await m.patron.post(`/api/requests/${id}/cancel`)).status, 404, 'approved cannot be cancelled');
    const all = await lib.get('/api/requests?status=Approved');
    assert.ok(all.data.requests.some((r) => r.request_id === id && r.catalog_exists === 1));

    // Issue must use the request's own duration, ISBN and member
    const other = await makeMember(lib);
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: other.id, isbn, requestId: id })).status, 404);
    const wrongBook = await makeBook(lib, 1);
    assert.equal((await lib.post('/api/circulation/issue', { membershipId: m.id, isbn: wrongBook.isbn, requestId: id })).status, 400);
    const issued = await lib.post('/api/circulation/issue', { membershipId: m.id, isbn, requestId: id });
    assert.equal(issued.status, 201);
    assert.equal(issued.data.receipt.dueDate, addDays(today(), 7));
    assert.equal((await one('SELECT request_status s FROM book_requests WHERE request_id = ?', [id])).s, 'Fulfilled');
    const mine = await m.patron.get('/api/requests/mine');
    assert.equal(mine.data.requests[0].request_status, 'Fulfilled');

    // Pending request can be cancelled by its owner only
    const second = await m.patron.post('/api/requests', { ...payload, isbn: newIsbn() });
    assert.equal((await other.patron.post(`/api/requests/${second.data.request.requestId}/cancel`)).status, 404);
    assert.equal((await m.patron.post(`/api/requests/${second.data.request.requestId}/cancel`)).status, 200);
    const rejected = await m.patron.post('/api/requests', { ...payload, isbn: newIsbn() });
    assert.equal((await lib.patch(`/api/requests/${rejected.data.request.requestId}/review`, { status: 'Rejected', staffNote: 'Not available' })).status, 200);
    assert.equal((await lib.get('/api/requests?status=Bogus')).status, 400);
  });

  // ───────────────────────── Ledgers ─────────────────────────
  await t.test('LEDGER: member and book ledgers reflect persisted loans and live accrual', async () => {
    const { isbn, accessions } = await makeBook(lib, 2);
    const m = await makeMember(lib);
    const l1 = (await lib.post('/api/circulation/issue', { membershipId: m.id, accessionNumber: accessions[0] })).data.receipt.loanId;
    await lib.post('/api/circulation/issue', { membershipId: m.id, accessionNumber: accessions[1] });
    await backdate(l1, 4);
    const ml = await lib.get(`/api/ledger/members/${m.id}`);
    assert.equal(ml.data.summary.activeLoans, 2);
    const row = ml.data.loans.find((l) => l.loan_id === l1);
    assert.equal(row.days_overdue, 4);
    assert.equal(Number(row.fine_accrued_now), 8);
    assert.equal(ml.data.summary.finesOutstanding, 8, 'live overdue estimate counts until return');
    const bl = await lib.get(`/api/ledger/books/${isbn}`);
    assert.equal(bl.data.loans.length, 2);
    assert.equal(bl.data.book.currently_issued, 2);
    assert.equal((await lib.get('/api/ledger/books/0000')).status, 404);
    assert.equal((await lib.get('/api/ledger/members/MEM-NOPE')).status, 404);
  });

  // ───────────────────────── Reports ─────────────────────────
  await t.test('REPORTS: inventory, overdue, circulation, fines, CSV (FR-Report.*)', async () => {
    const inv = await admin.get('/api/reports/inventory');
    const sum = await one('SELECT COUNT(*) titles, SUM(total_copies) total, SUM(available_copies) avail FROM book_titles');
    assert.equal(inv.data.summary.totalTitles, sum.titles);
    assert.equal(Number(inv.data.summary.totalPhysicalCopies), Number(sum.total));
    assert.equal(Number(inv.data.summary.totalAvailableCopies), Number(sum.avail));

    const { isbn, accessions } = await makeBook(admin, 1);
    const m = await makeMember(lib);
    const loanId = (await lib.post('/api/circulation/issue', { membershipId: m.id, isbn })).data.receipt.loanId;
    await backdate(loanId, 6);
    const od = await admin.get('/api/reports/overdue');
    const hit = od.data.overdueLoans.find((l) => l.loan_id === loanId);
    assert.ok(hit); assert.equal(hit.days_overdue, 6); assert.equal(Number(hit.estimated_fine), 12);
    assert.equal(hit.member_name.startsWith('Tester'), true);

    const circ = await admin.get(`/api/reports/circulation?startDate=${today()}&endDate=${today()}`);
    const expectedIssues = (await one('SELECT COUNT(*) c FROM loans WHERE issue_date = ?', [today()])).c;
    assert.equal(circ.data.totalIssues, expectedIssues);
    const day = circ.data.dailyBreakdown.find((d) => d.activity_date === today());
    assert.ok(day && day.issues_count === expectedIssues);
    const future = await admin.get(`/api/reports/circulation?startDate=${addDays(today(), 30)}&endDate=${addDays(today(), 60)}`);
    assert.equal(future.data.totalIssues, 0); assert.equal(future.data.totalReturns, 0);
    assert.equal((await admin.get(`/api/reports/circulation?startDate=${addDays(today(), 5)}&endDate=${today()}`)).status, 400);

    await lib.post('/api/circulation/return', { accessionNumber: accessions[0], payFineNow: true });
    const fines = await admin.get(`/api/reports/fines?startDate=${today()}&endDate=${today()}`);
    const db = await one('SELECT SUM(amount_charged) c, SUM(waived_amount) w FROM fines WHERE DATE(date_charged) = ?', [today()]);
    const paid = await one('SELECT SUM(amount) a FROM fine_payments WHERE DATE(payment_date) = ?', [today()]);
    assert.equal(fines.data.totalCharged, Number(db.c));
    assert.equal(fines.data.totalWaived, Number(db.w));
    assert.equal(fines.data.totalCollected, Number(paid.a));
    assert.ok(fines.data.recentFines.some((f) => f.loan_id === loanId));
    const none = await admin.get(`/api/reports/fines?startDate=${addDays(today(), 10)}&endDate=${addDays(today(), 20)}`);
    assert.equal(none.data.totalCharged, 0); assert.equal(none.data.recentFines.length, 0);

    for (const type of ['inventory', 'overdue', 'circulation', 'fines']) {
      const res = await fetch(`${base}/api/reports/export/${type}?startDate=2000-01-01&endDate=${today()}`, { headers: { Cookie: admin.jar.cookie } });
      assert.equal(res.status, 200, type);
      assert.match(res.headers.get('content-type'), /text\/csv/);
      assert.match(res.headers.get('content-disposition'), /attachment/);
      const body = await res.text();
      assert.ok(body.split('\r\n').length >= 2, `${type} has header + rows`);
    }
    assert.equal((await admin.get('/api/reports/export/nonsense')).status, 400);
    const lcsv = await fetch(`${base}/api/reports/export/fines`, { headers: { Cookie: lib.jar.cookie } });
    assert.equal(lcsv.status, 403);
  });

  // ───────────────────────── Concurrency ─────────────────────────
  await t.test('CONCURRENCY: simultaneous issues/returns of one title do not deadlock or oversell (PE-1, Reliability-1)', async () => {
    const N = 30;
    const { isbn } = await makeBook(lib, N);
    const members = [];
    for (let i = 0; i < N; i++) members.push((await makeMember(lib)).id);
    const issued = await Promise.all(members.map((id) => lib.post('/api/circulation/issue', { membershipId: id, isbn })));
    assert.deepEqual([...new Set(issued.map((r) => r.status))], [201], 'every concurrent issue must succeed');
    assert.equal(new Set(issued.map((r) => r.data.receipt.accessionNumber)).size, N, 'no copy issued twice');
    const afterIssue = await title(isbn);
    assert.equal(afterIssue.available_copies, 0);
    const returned = await Promise.all(issued.map((r) => lib.post('/api/circulation/return', { accessionNumber: r.data.receipt.accessionNumber })));
    assert.deepEqual([...new Set(returned.map((r) => r.status))], [200]);
    assert.equal((await title(isbn)).available_copies, N);

    // 12 staff race for the single remaining copy: exactly one wins, the rest are refused cleanly
    const last = await makeBook(lib, 1);
    const race = await Promise.all(members.slice(0, 12).map((id) => lib.post('/api/circulation/issue', { membershipId: id, isbn: last.isbn })));
    assert.equal(race.filter((r) => r.status === 201).length, 1);
    assert.deepEqual([...new Set(race.filter((r) => r.status !== 201).map((r) => r.status))], [400]);
    assert.equal((await title(last.isbn)).available_copies, 0);
  });

  // ───────────────────────── Integrity ─────────────────────────
  await t.test('INTEGRITY: inventory counters match physical copies; every transaction is logged (SA-1)', async () => {
    const drift = await q(
      `SELECT b.isbn, b.total_copies, b.available_copies,
              (SELECT COUNT(*) FROM book_copies c WHERE c.isbn = b.isbn) AS real_total,
              (SELECT COUNT(*) FROM book_copies c WHERE c.isbn = b.isbn AND c.copy_status = 'Available') AS real_avail
       FROM book_titles b
       HAVING total_copies <> real_total OR available_copies <> real_avail`
    );
    assert.deepEqual(drift, [], `inventory drift: ${JSON.stringify(drift)}`);
    const orphanIssued = await q("SELECT c.accession_number FROM book_copies c WHERE c.copy_status = 'Issued' AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.accession_number = c.accession_number AND l.loan_status = 'Issued')");
    assert.deepEqual(orphanIssued, []);
    const doubleLoans = await q("SELECT accession_number FROM loans WHERE loan_status = 'Issued' GROUP BY accession_number HAVING COUNT(*) > 1");
    assert.deepEqual(doubleLoans, []);
    const orphanHolds = await q("SELECT c.accession_number FROM book_copies c WHERE c.copy_status = 'Reserved_Hold' AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.held_accession_number = c.accession_number AND r.status = 'Active')");
    assert.deepEqual(orphanHolds, []);
    const issues = await one("SELECT COUNT(*) c FROM transaction_logs WHERE action_type = 'ISSUE'");
    const loans = await one('SELECT COUNT(*) c FROM loans WHERE issued_by IS NOT NULL');
    assert.equal(issues.c, loans.c);
    const returns = await one("SELECT COUNT(*) c FROM transaction_logs WHERE action_type = 'RETURN'");
    assert.ok(returns.c > 10);
  });
});
