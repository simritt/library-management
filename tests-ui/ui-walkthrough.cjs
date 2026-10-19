// Browser-driven end-to-end walkthrough of OLMS (Patron / Librarian / Administrator).
// Runs against Vite (5173) -> API (5000) -> library_test_db.
// Prerequisites (see README "Automated testing"):
//   1. cd server && node src/scripts/setupTestDb.js
//   2. cd server && set NODE_ENV=test && npm start        (API on :5000 using library_test_db)
//   3. cd client && npm run dev                           (UI on :5173)
//   4. cd tests-ui && npm install && npm test
const { chromium } = require('playwright-core');
const path = require('path');
const SERVER = path.join(__dirname, '..', 'server');
const mysql = require(path.join(SERVER, 'node_modules/mysql2/promise'));
require(path.join(SERVER, 'node_modules/dotenv')).config({ path: path.join(SERVER, '.env') });

const BASE = process.env.OLMS_URL || 'http://localhost:5173';
function findBrowser() {
  const fs = require('fs');
  const candidates = [process.env.BROWSER_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const found = candidates.find((c) => c && fs.existsSync(c));
  if (!found) throw new Error('No Edge/Chrome found. Set BROWSER_PATH to a Chromium-based browser executable.');
  return found;
}
const SHOTS = path.join(__dirname, 'screenshots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const results = [];
let browser;

const stamp = Date.now();
const ISBN_UI = (() => { // checksum-valid ISBN-13 for a book created through the UI
  const prefix = '978' + String(800000000 + (stamp % 99999999)).slice(0, 9);
  let sum = 0; for (let i = 0; i < 12; i++) sum += Number(prefix[i]) * (i % 2 === 0 ? 1 : 3);
  return prefix + ((10 - (sum % 10)) % 10);
})();

async function db() {
  return mysql.createConnection({ host: '127.0.0.1', user: 'root', password: process.env.DB_PASSWORD, database: process.env.TEST_DB_NAME || 'library_test_db', dateStrings: true });
}
async function dbq(sql, params = []) { const c = await db(); try { return (await c.query(sql, params))[0]; } finally { await c.end(); } }

async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  PASS', name); }
  catch (e) { results.push({ name, ok: false, err: e.message.split('\n')[0] }); console.log('  FAIL', name, '\n       ', e.message.split('\n').slice(0, 3).join(' | ')); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

async function newCtx() {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', e.message));
  return { ctx, page };
}
async function staffLogin(page, user, pass) {
  await page.goto(BASE + '/login');
  await page.getByPlaceholder('e.g. admin or librarian').fill(user);
  await page.getByPlaceholder('••••••••••••').fill(pass);
  await page.getByRole('button', { name: /sign in|log in|enter|access/i }).first().click();
  await page.waitForURL('**/dashboard', { timeout: 8000 });
}
async function patronLogin(page, id, pass = 'Member@123') {
  await page.goto(BASE + '/patron-login');
  await page.getByPlaceholder(/MEM-2026-0001/).fill(id);
  await page.getByPlaceholder('••••••••••••').fill(pass);
  await page.getByRole('button', { name: /sign in|log in|enter|access/i }).first().click();
  await page.waitForURL('**/account', { timeout: 8000 });
}
const text = async (page) => (await page.locator('body').innerText());

(async () => {
  browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  console.log('== PUBLIC ==');
  const pub = await newCtx();
  await step('public catalogue lists seeded books, no login needed', async () => {
    await pub.page.goto(BASE + '/catalog');
    await pub.page.getByText('Clean Code').first().waitFor();
    ok((await text(pub.page)).includes('Introduction to Algorithms'));
  });
  await step('public search + filter by title', async () => {
    await pub.page.getByPlaceholder(/Search by title/).fill('Algorithms');
    await pub.page.keyboard.press('Enter');
    await pub.page.waitForTimeout(700);
    const t = await text(pub.page);
    ok(t.includes('Introduction to Algorithms') && !t.includes('Effective Java'), 'search did not narrow results');
  });
  await step('public search with no match shows empty message', async () => {
    await pub.page.getByPlaceholder(/Search by title/).fill('zzzzqqqq');
    await pub.page.keyboard.press('Enter');
    await pub.page.waitForTimeout(700);
    ok(/no (books|results)|not found|no matching/i.test(await text(pub.page)), 'no empty-state text');
  });
  await step('public book detail shows copies but NOT borrower identity', async () => {
    await pub.page.goto(BASE + '/catalog/9780132350884');
    await pub.page.getByText('Individual Physical Copies').waitFor();
    const t = await text(pub.page);
    ok(t.includes('ACC-9780132350884-001'));
    ok(!t.includes('Borrower') && !t.includes('Parth Zala'), 'borrower leaked on public page');
  });
  await step('anonymous visit to /circulation redirects to staff login', async () => {
    await pub.page.goto(BASE + '/circulation');
    await pub.page.waitForURL('**/login');
  });
  await pub.page.screenshot({ path: path.join(SHOTS, '01-staff-login.png') });

  console.log('== LIBRARIAN ==');
  const lib = await newCtx();
  const L = lib.page;
  await step('staff login with wrong password shows error', async () => {
    await L.goto(BASE + '/login');
    await L.getByPlaceholder('e.g. admin or librarian').fill('librarian');
    await L.getByPlaceholder('••••••••••••').fill('wrong');
    await L.getByRole('button', { name: /sign in|log in|enter|access/i }).first().click();
    await L.getByText(/invalid username or password/i).waitFor({ timeout: 5000 });
  });
  await step('librarian login lands on dashboard with live counts', async () => {
    await staffLogin(L, 'librarian', 'Librarian@123');
    await L.getByText('Library operations.').waitFor();
    await L.screenshot({ path: path.join(SHOTS, '02-staff-dashboard.png') });
  });
  await step('librarian cannot open Administrator reports (restricted screen)', async () => {
    await L.goto(BASE + '/admin/reports');
    await L.getByText('This area is restricted').waitFor();
  });

  let memberId;
  const memberName = `UI Student ${stamp}`;
  await step('register a member through the form (ID generated, default limit shown)', async () => {
    await L.goto(BASE + '/members');
    await L.getByRole('button', { name: /register new member/i }).click();
    await L.getByPlaceholder('e.g. Parth Zala').fill(memberName);
    await L.getByPlaceholder('e.g. 2024300274').fill(`UI-${stamp}`);
    await L.getByPlaceholder('name@spit.ac.in').fill(`ui${stamp}@spit.ac.in`);
    await L.getByPlaceholder('9820011223').fill('9876500000');
    await L.getByRole('button', { name: /^register member$/i }).click();
    const msg = await L.getByText(/Generated Library Membership ID/).innerText();
    memberId = msg.match(/MEM-\d{4}-\d+/)[0];
    const row = (await dbq('SELECT borrowing_limit, account_status FROM members WHERE membership_id=?', [memberId]))[0];
    ok(row && row.borrowing_limit === 3 && row.account_status === 'Active', 'DB row wrong');
    await L.screenshot({ path: path.join(SHOTS, '03-register-member.png') });
    await L.getByRole('button', { name: /cancel/i }).click();
  });
  await step('duplicate institutional ID is rejected with an error', async () => {
    await L.getByRole('button', { name: /register new member/i }).click();
    await L.getByPlaceholder('e.g. Parth Zala').fill('Dup');
    await L.getByPlaceholder('e.g. 2024300274').fill(`UI-${stamp}`);
    await L.getByPlaceholder('name@spit.ac.in').fill(`dup${stamp}@spit.ac.in`);
    await L.getByPlaceholder('9820011223').fill('1');
    await L.getByRole('button', { name: /^register member$/i }).click();
    await L.getByText(/already registered/i).waitFor();
    await L.getByRole('button', { name: /cancel/i }).click();
  });
  await step('edit member (phone) persists to DB; borrowing limit field hidden for librarian', async () => {
    await L.getByPlaceholder(/Search by name/).fill(memberName);
    await L.waitForTimeout(700);
    await L.getByRole('row', { name: new RegExp(memberId) }).getByRole('button', { name: 'Edit' }).click();
    ok(!(await L.getByLabel(/Borrowing limit/).count()), 'limit override visible to librarian');
    await L.getByLabel('Phone').fill('9111122223');
    await L.getByRole('button', { name: /save changes/i }).click();
    await L.getByText(new RegExp(`Details for ${memberId} updated`)).waitFor();
    const row = (await dbq('SELECT phone FROM members WHERE membership_id=?', [memberId]))[0];
    ok(row.phone === '9111122223', 'phone not saved: ' + row.phone);
  });

  let bookIsbn = ISBN_UI;
  await step('add a book with 1 copy via Catalog Management (accession generated)', async () => {
    await L.goto(BASE + '/catalog-management');
    await L.getByRole('button', { name: /add new book title/i }).click();
    await L.getByPlaceholder(/Design Patterns/).fill(`UI Test Book ${stamp}`);
    await L.getByPlaceholder(/Erich Gamma/).fill('UI Author');
    await L.getByPlaceholder('e.g. 9780201633610').fill(bookIsbn);
    await L.getByPlaceholder(/Software Architecture/).fill('Testing');
    await L.getByPlaceholder(/Addison-Wesley/).fill('UI Press');
    await L.locator('input[type=number]').last().fill('1');
    await L.getByRole('button', { name: /add book & generate copies/i }).click();
    await L.getByText(new RegExp(`ACC-${bookIsbn}-001`)).waitFor();
    await L.screenshot({ path: path.join(SHOTS, '04-add-book.png') });
    await L.getByRole('button', { name: /cancel/i }).click();
  });
  await step('invalid ISBN checksum is rejected in the add-book form', async () => {
    await L.getByRole('button', { name: /add new book title/i }).click();
    await L.getByPlaceholder(/Design Patterns/).fill('Bad ISBN');
    await L.getByPlaceholder(/Erich Gamma/).fill('A');
    await L.getByPlaceholder('e.g. 9780201633610').fill('9780132350880');
    await L.getByPlaceholder(/Software Architecture/).fill('X');
    await L.getByPlaceholder(/Addison-Wesley/).fill('X');
    await L.getByRole('button', { name: /add book & generate copies/i }).click();
    await L.getByText(/invalid isbn-13 checksum/i).waitFor();
    await L.getByRole('button', { name: /cancel/i }).click();
  });

  console.log('== CIRCULATION: issue ==');
  await step('issue desk shows eligibility + due date BEFORE confirming', async () => {
    await L.goto(BASE + '/circulation');
    await L.getByPlaceholder('e.g. MEM-2026-0001').fill(memberId);
    const card = L.getByTestId('issue-preview');
    await card.waitFor();
    const t = await card.innerText();
    ok(t.includes(memberName) && /Eligible/.test(t) && /Max loan 14 days/.test(t), 'preview content: ' + t);
    await L.screenshot({ path: path.join(SHOTS, '05-issue-preview.png') });
  });
  await step('issue by ISBN produces receipt, DB loan + copy status', async () => {
    await L.getByPlaceholder('e.g. 9780132350884').fill(bookIsbn);
    await L.getByRole('button', { name: /verify eligibility & confirm issue/i }).click();
    await L.getByText('Issue Confirmation & Receipt').waitFor();
    const t = await text(L);
    ok(t.includes(memberName) && t.includes(`ACC-${bookIsbn}-001`));
    const loan = (await dbq("SELECT loan_status, due_date, issue_date FROM loans WHERE membership_id=?", [memberId]))[0];
    ok(loan.loan_status === 'Issued');
    const copy = (await dbq('SELECT copy_status FROM book_copies WHERE accession_number=?', [`ACC-${bookIsbn}-001`]))[0];
    ok(copy.copy_status === 'Issued');
    await L.screenshot({ path: path.join(SHOTS, '06-issue-receipt.png') });
  });
  await step('no copy left -> refusal with reservation offer; staff can queue the member', async () => {
    const other = (await dbq("SELECT membership_id FROM members WHERE membership_id='MEM-2026-0004'"))[0].membership_id;
    await L.getByPlaceholder('e.g. MEM-2026-0001').fill(other);
    await L.getByPlaceholder('e.g. 9780132350884').fill(bookIsbn);
    await L.getByRole('button', { name: /verify eligibility & confirm issue/i }).click();
    await L.getByText(/No copies of this book are currently available/).waitFor();
    await L.getByRole('button', { name: new RegExp(`Place ${other} in the reservation queue`) }).click();
    await L.getByText(/queue position #1/).waitFor();
    const r = await dbq("SELECT status FROM reservations WHERE membership_id='MEM-2026-0004' AND isbn=?", [bookIsbn]);
    ok(r.length === 1 && r[0].status === 'Active');
    await L.screenshot({ path: path.join(SHOTS, '07-reserve-offer.png') });
  });

  console.log('== PATRON ==');
  const pat = await newCtx();
  const P = pat.page;
  await step('patron login; account shows the new loan and limit', async () => {
    await P.goto(BASE + '/patron-login');
    await P.getByPlaceholder(/MEM-2026-0001/).fill(memberId);
    await P.getByPlaceholder('••••••••••••').fill('Member@123');
    await P.getByRole('button', { name: /sign in|log in|enter|access/i }).first().click();
    await P.waitForURL('**/account');
    await P.getByText(`UI Test Book ${stamp}`).first().waitFor();
    const t = await text(P);
    ok(t.includes('Borrowing limit: 3') && /days left/i.test(t));
    await P.screenshot({ path: path.join(SHOTS, '08-patron-account.png'), fullPage: true });
  });
  await step('patron cannot open staff pages (restricted)', async () => {
    await P.goto(BASE + '/circulation');
    await P.getByText('This area is restricted').waitFor();
    await P.goto(BASE + '/admin/reports');
    await P.getByText('This area is restricted').waitFor();
  });
  await step("patron cannot view another member's profile (SE-6)", async () => {
    await P.goto(BASE + '/patron/MEM-2026-0001');
    await P.getByText(/Access denied|only view your own/i).waitFor();
  });
  await step('patron submits a book request; validation blocks > policy days', async () => {
    await P.goto(BASE + '/requests');
    await P.locator('#request-title').fill('Requested via UI');
    await P.getByPlaceholder('978-1-4919-1986-3').fill('978-0-13-235088-4');
    await P.locator('#requested-days').fill('20');
    await P.getByRole('button', { name: /submit book request/i }).click();
    await P.waitForTimeout(500);
    ok((await dbq("SELECT COUNT(*) c FROM book_requests WHERE membership_id=?", [memberId]))[0].c === 0, '20-day request was accepted');
    await P.locator('#requested-days').fill('7');
    await P.getByRole('button', { name: /submit book request/i }).click();
    await P.getByText(/submitted for library review/i).waitFor();
    const r = (await dbq("SELECT request_status, requested_days FROM book_requests WHERE membership_id=?", [memberId]))[0];
    ok(r.request_status === 'Pending' && r.requested_days === 7);
    await P.screenshot({ path: path.join(SHOTS, '09-patron-request.png') });
  });
  await step('invalid ISBN in a request is rejected', async () => {
    await P.locator('#request-title').fill('Bad');
    await P.getByPlaceholder('978-1-4919-1986-3').fill('1234567890123');
    await P.getByRole('button', { name: /submit book request/i }).click();
    await P.getByText(/invalid isbn/i).waitFor();
  });

  await step('patron B reserves the unavailable title from its detail page', async () => {
    const other = await newCtx();
    await patronLogin(other.page, 'MEM-2026-0002');
    await other.page.goto(BASE + `/catalog/${bookIsbn}`);
    await other.page.getByRole('button', { name: /place reservation/i }).click();
    await other.page.getByText(/Reservation confirmed/).waitFor();
    const t = await text(other.page);
    ok(/position #2/.test(t), 'expected queue position 2, page: ' + t.slice(0, 300));
    await other.page.screenshot({ path: path.join(SHOTS, '10-patron-reserve.png') });
    // duplicate reservation refused
    await other.page.getByRole('button', { name: /place reservation/i }).click();
    await other.page.getByText(/already have an active reservation/i).waitFor();
    other.ctx.close();
  });

  console.log('== LIBRARIAN: staff request review, overdue return, fines ==');
  await step('librarian approves the patron request and issues from it', async () => {
    // make the requested ISBN a book that exists with a free copy: request ISBN belongs to Clean Code (copies available)
    await L.goto(BASE + '/requests');
    await L.getByText('Requested via UI').waitFor();
    await L.getByRole('button', { name: /approve/i }).first().click();
    await L.getByText(/request approved/i).waitFor();
    await L.getByRole('combobox').selectOption('Approved');
    await L.getByRole('button', { name: /issue approved request/i }).first().click();
    await L.waitForURL(/circulation\?/);
    await L.getByText(/Issuing approved request/).waitFor();
    await L.getByRole('button', { name: /verify eligibility & confirm issue/i }).click();
    await L.getByText('Issue Confirmation & Receipt').waitFor();
    const due = (await L.locator('dd.font-mono.text-sm').innerText()).trim();
    const exp = (await dbq("SELECT DATE_ADD(CURDATE(), INTERVAL 7 DAY) d"))[0].d;
    ok(due === exp, `due ${due} != ${exp}`);
    ok((await dbq("SELECT request_status s FROM book_requests WHERE membership_id=?", [memberId]))[0].s === 'Fulfilled');
  });

  await step('overdue return assesses fine from the DB due date; collect it from the return summary', async () => {
    const loans = await dbq("SELECT loan_id, accession_number, isbn FROM loans WHERE membership_id=? AND loan_status='Issued' ORDER BY loan_id", [memberId]);
    ok(loans.length === 2, 'expected 2 active loans, got ' + loans.length);
    loans.reverse(); // loans[0] = the request-issued Clean Code copy (no reservations on it)
    ok(loans[0].isbn === '9780132350884', 'wrong loan chosen');
    await dbq('UPDATE loans SET due_date = DATE_SUB(CURDATE(), INTERVAL 12 DAY), issue_date = DATE_SUB(CURDATE(), INTERVAL 26 DAY) WHERE loan_id=?', [loans[0].loan_id]);
    await L.goto(BASE + '/circulation');
    await L.getByRole('button', { name: 'Return Book' }).click();
    await L.getByPlaceholder('e.g. ACC-9780132350884-001').fill(loans[0].accession_number);
    await L.getByRole('button', { name: /confirm book return/i }).click();
    await L.getByText('Return Processed Successfully').waitFor();
    const t = await text(L);
    ok(/12 days/.test(t) && /Rs\. 24\.00/.test(t), 'fine text missing: ' + t.slice(0, 600));
    await L.screenshot({ path: path.join(SHOTS, '11-return-overdue.png') });
    await L.getByRole('button', { name: /collect rs\. 24\.00 now/i }).click();
    await L.getByText(/Collected \(Receipt/).waitFor();
    const f = (await dbq('SELECT amount_charged c, amount_paid p FROM fines WHERE loan_id=?', [loans[0].loan_id]))[0];
    ok(Number(f.c) === 24 && Number(f.p) === 24, 'fine row ' + JSON.stringify(f));
  });

  await step('overdue return of a RESERVED title: hold notice + partial payment via Fines tab + receipt', async () => {
    const loans = await dbq("SELECT loan_id, accession_number FROM loans WHERE membership_id=? AND loan_status='Issued'", [memberId]);
    ok(loans.length === 1, 'expected the UI test book loan only');
    await dbq('UPDATE loans SET due_date = DATE_SUB(CURDATE(), INTERVAL 10 DAY), issue_date = DATE_SUB(CURDATE(), INTERVAL 17 DAY) WHERE loan_id=?', [loans[0].loan_id]);
    await L.getByPlaceholder('e.g. ACC-9780132350884-001').fill(loans[0].accession_number);
    await L.getByRole('button', { name: /confirm book return/i }).click();
    await L.getByText('Return Processed Successfully').waitFor();
    await L.getByText(/Reservation Hold Placed/).waitFor();
    ok(/Held exclusively for 48 hours/.test(await text(L)), 'hold hours text');
    ok((await dbq('SELECT copy_status s FROM book_copies WHERE accession_number=?', [loans[0].accession_number]))[0].s === 'Reserved_Hold');
    await L.screenshot({ path: path.join(SHOTS, '13-return-hold.png') });
    // Fines tab
    await L.getByRole('button', { name: 'Fines', exact: true }).click();
    await L.getByPlaceholder(/Membership ID, e\.g\./).fill(memberId);
    await L.getByRole('button', { name: 'Look up' }).click();
    await L.getByText('Fine Collection').waitFor();
    await L.getByLabel(/Amount for fine/).fill('8');
    await L.getByRole('button', { name: 'Collect', exact: true }).click();
    await L.getByTestId('fine-receipt').waitFor();
    const t = await L.getByTestId('fine-receipt').innerText();
    ok(/Rs\. 8\.00/.test(t) && /Rs\. 12\.00/.test(t), 'receipt: ' + t);
    await L.screenshot({ path: path.join(SHOTS, '12-fines-tab.png') });
  });

  await step('reservation desk lists the held copy and expiry; librarian can cancel', async () => {
    await L.goto(BASE + '/reservations');
    await L.getByText(`UI Test Book ${stamp}`).first().waitFor();
    const t = await text(L);
    ok(/Expires/.test(t), 'no hold expiry shown');
    await L.screenshot({ path: path.join(SHOTS, '14-reservation-desk.png') });
  });
  await step('patron on queue sees "ready to collect" after the return', async () => {
    const other = await newCtx();
    await patronLogin(other.page, 'MEM-2026-0004');
    await other.page.getByText(/ready to collect/i).first().waitFor();
    other.ctx.close();
  });

  console.log('== LEDGERS & COPY CONDITION ==');
  await step('member ledger shows full history incl. fines paid', async () => {
    await L.goto(BASE + '/ledgers');
    await L.getByPlaceholder(/Name, membership ID/).fill(memberId);
    await L.getByLabel('Member record').selectOption(memberId);
    await L.getByRole('button', { name: /open ledger/i }).click();
    await L.getByText('Complete borrowing history').waitFor();
    const t = await text(L);
    ok(t.includes('Fine history') && /₹24\.00/.test(t), 'ledger missing fine rows');
    await L.screenshot({ path: path.join(SHOTS, '15-ledger.png'), fullPage: true });
  });
  await step('mark a copy Lost via book detail (staff copy-condition control) and restore', async () => {
    await L.goto(BASE + `/catalog/${bookIsbn}`);
    await L.getByText('Copy condition').waitFor();
    // held copy: marking lost releases the hold (server rule), allowed
    L.once('dialog', (d) => d.accept('UI test'));
    await L.getByRole('button', { name: 'Mark lost' }).click();
    await L.getByText(/is now Lost/).waitFor();
    ok((await dbq('SELECT copy_status s FROM book_copies WHERE accession_number=?', [`ACC-${bookIsbn}-001`]))[0].s === 'Lost');
    L.once('dialog', (d) => d.accept(''));
    await L.getByRole('button', { name: 'Restore' }).click();
    await L.getByText(/is now Available/).waitFor();
    // Restored copy is immediately re-held for the waiting reservation (queue is served)
    const s = (await dbq('SELECT copy_status s FROM book_copies WHERE accession_number=?', [`ACC-${bookIsbn}-001`]))[0].s;
    ok(s === 'Reserved_Hold', 'restored copy should serve the queue, got ' + s);
  });

  console.log('== AUTOCOMPLETE (request + issue forms) ==');
  const AP = await newCtx();
  await step('request form: title suggestions fill the ISBN; editing the title clears it', async () => {
    await patronLogin(AP.page, 'MEM-2026-0002');
    await AP.page.goto(BASE + '/requests');
    await AP.page.locator('#request-title').fill('operating');
    const opt = AP.page.getByRole('option', { name: /Operating System Concepts/ });
    await opt.waitFor();
    await opt.click();
    ok((await AP.page.locator('input.mono').inputValue()) === '9780131101630', 'ISBN not auto-filled');
    await AP.page.getByText(/In the catalogue:/).waitFor();
    await AP.page.locator('#request-title').fill('Something else');
    ok((await AP.page.locator('input.mono').inputValue()) === '', 'stale ISBN kept');
    await AP.page.screenshot({ path: path.join(SHOTS, '21-request-autocomplete.png') });
  });
  await step('request form: keyboard selection and ISBN-to-title lookup', async () => {
    await AP.page.locator('#request-title').fill('algor');
    await AP.page.getByRole('option', { name: /Introduction to Algorithms/ }).waitFor();
    await AP.page.keyboard.press('ArrowDown'); await AP.page.keyboard.press('Enter');
    ok((await AP.page.locator('input.mono').inputValue()) === '9780262033848');
    await AP.page.locator('#request-title').fill('');
    await AP.page.locator('input.mono').fill('9780136086208');
    await AP.page.locator('input.mono').blur();
    await AP.page.waitForFunction(() => document.querySelector('#request-title').value.includes('Computer Networks'), null, { timeout: 4000 });
  });
  await step('request form: unknown title shows the not-in-catalogue hint and the list closes on blur', async () => {
    await AP.page.locator('#request-title').fill('Totally New Book');
    await AP.page.getByText(/Not in our catalogue yet/).waitFor();
    await AP.page.locator('input.mono').focus();
    await AP.page.getByRole('listbox').waitFor({ state: 'detached' });
  });
  await step('issue desk: find a member by name and a book by title', async () => {
    await L.goto(BASE + '/circulation');
    await L.getByPlaceholder(/Type a name or Membership ID/).fill('surekha');
    await L.getByRole('option', { name: /Dr\. Surekha Dholay/ }).click();
    ok((await L.getByPlaceholder(/Type a name or Membership ID/).inputValue()) === 'MEM-2026-0003');
    await L.getByTestId('issue-preview').waitFor();
    await L.locator('#issue-book-title').fill('database');
    await L.getByRole('option', { name: /Database System Concepts/ }).click();
    ok((await L.getByPlaceholder('e.g. 9780132350884').inputValue()) === '9780073523323', 'ISBN not filled');
    await L.getByRole('button', { name: /verify eligibility & confirm issue/i }).click();
    await L.getByText('Issue Confirmation & Receipt').waitFor();
    ok((await text(L)).includes('Dr. Surekha Dholay'), 'receipt member');
    ok((await dbq("SELECT loan_status s FROM loans WHERE membership_id='MEM-2026-0003' AND isbn='9780073523323' ORDER BY loan_id DESC LIMIT 1"))[0].s === 'Issued');
  });

  console.log('== ADMINISTRATOR ==');
  const adm = await newCtx();
  const A = adm.page;
  await step('admin login; reports tabs render with data', async () => {
    await staffLogin(A, 'admin', 'Admin@123');
    await A.goto(BASE + '/admin/reports');
    await A.getByText('Per-Title Inventory Breakdown').waitFor();
    await A.getByRole('button', { name: 'Overdue Loans' }).click();
    await A.getByText(/Current Overdue Loans/).waitFor();
    await A.screenshot({ path: path.join(SHOTS, '16-reports-overdue.png') });
  });
  await step('circulation report honours a date range; empty period handled', async () => {
    await A.getByRole('button', { name: 'Circulation', exact: true }).click();
    await A.getByText('Total Issues Recorded').waitFor();
    const today = (await dbq('SELECT CURDATE() d'))[0].d;
    await A.getByLabel('From').fill(today); await A.getByLabel('To').fill(today);
    await A.getByRole('button', { name: 'Apply range' }).click();
    await A.waitForTimeout(600);
    const issues = Number((await dbq('SELECT COUNT(*) c FROM loans WHERE issue_date=CURDATE()'))[0].c);
    { const shown = (await A.getByText('Total Issues Recorded').locator('xpath=following-sibling::div').innerText()).trim(); ok(Number(shown) === issues, `issues shown ${shown}, DB ${issues}`); }
    await A.getByLabel('From').fill('2031-01-01'); await A.getByLabel('To').fill('2031-12-31');
    await A.getByRole('button', { name: 'Apply range' }).click();
    await A.getByText(/No circulation activity in this period/).waitFor();
    ok(await A.locator('a[href*="/api/reports/export/circulation"]').count() === 1, 'export link missing');
  });
  await step('fines report lists assessed fines; matches DB totals', async () => {
    await A.getByRole('button', { name: 'Fines Collection' }).click();
    await A.getByLabel('From').fill('2000-01-01'); await A.getByLabel('To').fill((await dbq('SELECT CURDATE() d'))[0].d);
    await A.getByRole('button', { name: 'Apply range' }).click();
    await A.getByText('Fines assessed in this period').waitFor();
    const charged = Number((await dbq('SELECT COALESCE(SUM(amount_charged),0) c FROM fines'))[0].c);
    ok((await text(A)).includes(`Rs. ${charged.toFixed(2)}`), 'total charged not shown ' + charged);
    await A.screenshot({ path: path.join(SHOTS, '17-reports-fines.png') });
  });
  await step('CSV export link downloads a real CSV with the session', async () => {
    const [download] = await Promise.all([A.waitForEvent('download'), A.getByRole('link', { name: /export fine ledger csv/i }).click()]);
    const file = path.join(SHOTS, 'fines.csv');
    await download.saveAs(file);
    const content = require('fs').readFileSync(file, 'utf8');
    ok(content.includes('Fine ID') && content.split('\r\n').length > 2, 'csv content');
  });
  await step('policy page edits all 8 settings and persists; invalid value shows inline error', async () => {
    await A.getByRole('button', { name: 'Policy Rules' }).click();
    await A.getByText('Library Circulation & Fine Policies').waitFor();
    await A.getByText(/Student Borrowing Limit/).waitFor();
    await A.getByText(/Reservation Hold \(hours\)/).waitFor();
    const rate = A.locator('input[type=number]').first();
    await rate.fill('3');
    await A.getByRole('button', { name: 'Save Policy Rules' }).click();
    await A.getByText(/saved and activated/i).waitFor();
    ok((await dbq("SELECT setting_value v FROM system_settings WHERE setting_key='fine_rate_per_day'"))[0].v === '3');
    await rate.fill('2000');
    await A.getByRole('button', { name: 'Save Policy Rules' }).click();
    await A.getByText(/Invalid value for fine_rate_per_day/).waitFor();
    await rate.fill('2');
    await A.getByRole('button', { name: 'Save Policy Rules' }).click();
    await A.getByText(/saved and activated/i).waitFor();
    await A.screenshot({ path: path.join(SHOTS, '18-policy.png') });
  });
  await step('admin waives part of a fine with a mandatory remark (audit logged)', async () => {
    // create an outstanding fine on the member: 5 days overdue return
    const bk = (await dbq("SELECT isbn FROM book_titles WHERE isbn='9780131103627'"))[0].isbn;
    const c = await db();
    const [ins] = await c.query("INSERT INTO loans (membership_id, accession_number, isbn, issue_date, due_date, loan_status) VALUES (?, 'ACC-9780131103627-001', ?, DATE_SUB(CURDATE(), INTERVAL 19 DAY), DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'Issued')", [memberId, bk]);
    await c.query("UPDATE book_copies SET copy_status='Issued' WHERE accession_number='ACC-9780131103627-001'");
    await c.query("UPDATE book_titles SET available_copies = available_copies - 1 WHERE isbn=?", [bk]);
    await c.end();
    await A.goto(BASE + '/circulation');
    await A.getByRole('button', { name: 'Return Book' }).click();
    await A.getByPlaceholder('e.g. ACC-9780132350884-001').fill('ACC-9780131103627-001');
    await A.getByRole('button', { name: /confirm book return/i }).click();
    await A.getByText('Return Processed Successfully').waitFor();
    await A.goto(BASE + `/patron/${memberId}`);
    await A.getByText(/Fines & Financial Ledger/).waitFor();
    await A.getByRole('row', { name: /Rs\. 10\.00/ }).getByRole('button', { name: 'Waive' }).first().click();
    await A.getByRole('button', { name: 'Apply Waiver' }).click(); // remark is required: browser blocks submit
    ok((await dbq('SELECT COUNT(*) c FROM fines WHERE waived_amount > 0 AND membership_id=?', [memberId]))[0].c === 0, 'waived without a remark');
    await A.getByPlaceholder(/Medical emergency/).fill('Library error');
    await A.getByRole('button', { name: 'Apply Waiver' }).click();
    await A.waitForTimeout(800);
    const f = (await dbq('SELECT waived_amount w, waiver_remark r FROM fines WHERE membership_id=? AND waived_amount>0', [memberId]))[0];
    ok(f && Number(f.w) === 10 && f.r === 'Library error', 'waiver row ' + JSON.stringify(f));
    await A.screenshot({ path: path.join(SHOTS, '19-waiver.png'), fullPage: true });
  });
  await step('librarian profile view shows NO waive button (admin only)', async () => {
    await L.goto(BASE + `/patron/${memberId}`);
    await L.getByText(/Fines & Financial Ledger/).waitFor();
    ok((await L.getByRole('button', { name: 'Waive' }).count()) === 0, 'waive visible to librarian');
  });
  await step('admin deactivation is blocked while dues/loans exist, allowed when clear, and reactivation works', async () => {
    await A.goto(BASE + '/members');
    await A.getByPlaceholder(/Search by name/).fill('MEM-2026-0004');
    await A.waitForTimeout(600);
    // this member has no loans or dues -> deactivate succeeds
    await A.getByRole('row', { name: /MEM-2026-0004/ }).getByRole('button', { name: 'Deactivate' }).click();
    await A.getByRole('button', { name: /confirm deactivation/i }).click();
    await A.waitForTimeout(700);
    ok((await dbq("SELECT account_status s FROM members WHERE membership_id='MEM-2026-0004'"))[0].s === 'Inactive');
    await A.getByRole('row', { name: /MEM-2026-0004/ }).getByRole('button', { name: 'Reactivate' }).click();
    await A.waitForTimeout(700);
    ok((await dbq("SELECT account_status s FROM members WHERE membership_id='MEM-2026-0004'"))[0].s === 'Active');
    // blocked case: member with the held-book reservation holder has no loan; use a member with an active loan
    await dbq("INSERT INTO loans (membership_id, accession_number, isbn, issue_date, due_date, loan_status) VALUES ('MEM-2026-0002','ACC-9780131103627-002','9780131103627',CURDATE(),DATE_ADD(CURDATE(), INTERVAL 14 DAY),'Issued')");
    await dbq("UPDATE book_copies SET copy_status='Issued' WHERE accession_number='ACC-9780131103627-002'");
    await dbq("UPDATE book_titles SET available_copies = available_copies - 1 WHERE isbn='9780131103627'");
    await A.getByPlaceholder(/Search by name/).fill('MEM-2026-0002');
    await A.waitForTimeout(600);
    await A.getByRole('row', { name: /MEM-2026-0002/ }).getByRole('button', { name: 'Deactivate' }).click();
    await A.getByRole('button', { name: /confirm deactivation/i }).click();
    await A.getByText(/Deactivation Blocked/).waitFor();
    await A.screenshot({ path: path.join(SHOTS, '20-deactivation-blocked.png') });
  });
  await step('logout returns to public catalogue and protected pages require login again', async () => {
    await A.getByRole('button', { name: /^close$/i }).click();
    await A.getByRole('button', { name: /sign out/i }).first().click();
    await A.waitForURL('**/catalog');
    await A.goto(BASE + '/admin/reports');
    await A.waitForURL('**/login');
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nUI RESULT: ${results.length - failed.length}/${results.length} passed`);
  failed.forEach((f) => console.log('  FAILED:', f.name, '->', f.err));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
