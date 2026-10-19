const test = require('node:test');
const assert = require('node:assert/strict');
const { validateISBN, isValidISBN10, isValidISBN13 } = require('../src/utils/isbnValidator');
const { calculateDueDate, calculateFine } = require('../src/utils/fineCalculator');

test('ISBN Checksum Validation (FR-Catalog.Add-02)', async (t) => {
  await t.test('Validates authentic ISBN-10 numbers', () => {
    assert.strictEqual(isValidISBN10('0-13-110362-8'), true);
    assert.strictEqual(isValidISBN10('0131103628'), true);
    assert.strictEqual(validateISBN('0-13-110362-8').valid, true);
  });

  await t.test('Validates authentic ISBN-13 numbers', () => {
    assert.strictEqual(isValidISBN13('978-0-13-235088-4'), true);
    assert.strictEqual(isValidISBN13('9780132350884'), true);
    assert.strictEqual(validateISBN('9780132350884').valid, true);
  });

  await t.test('Rejects invalid checksums and improper formats', () => {
    assert.strictEqual(isValidISBN10('0131103629'), false); // bad check digit
    assert.strictEqual(isValidISBN13('9780132350885'), false); // bad check digit
    assert.strictEqual(validateISBN('12345').valid, false);
    assert.strictEqual(validateISBN('').valid, false);
  });
});

test('Due Date and Fine Rules (BR-1, BR-2, BR-5, BR-6)', async (t) => {
  await t.test('Computes 14 days loan period for students and 30 days for faculty', () => {
    const issueDate = '2026-10-01';
    assert.strictEqual(calculateDueDate(issueDate, 'Student'), '2026-10-15');
    assert.strictEqual(calculateDueDate(issueDate, 'Faculty'), '2026-10-31');
  });

  await t.test('Honours a requested loan duration when it is within policy (book requests)', () => {
    assert.strictEqual(calculateDueDate('2026-10-01', 'Student', 7), '2026-10-08');
    assert.strictEqual(calculateDueDate('2026-10-01', 'Faculty', 21), '2026-10-22');
  });

  await t.test('Returns 0 fine if returned on or before due date', () => {
    const res = calculateFine('2026-10-15', '2026-10-14', 2.0, 200.0);
    assert.strictEqual(res.isOverdue, false);
    assert.strictEqual(res.fineAmount, 0);
  });

  await t.test('Calculates Rs. 2 per day for overdue returns', () => {
    const res = calculateFine('2026-10-10', '2026-10-15', 2.0, 200.0);
    assert.strictEqual(res.isOverdue, true);
    assert.strictEqual(res.daysOverdue, 5);
    assert.strictEqual(res.fineAmount, 10.0);
  });

  await t.test('Enforces Rs. 200 maximum cap on single loan fine (BR-6)', () => {
    const res = calculateFine('2026-01-01', '2026-06-01', 2.0, 200.0);
    assert.strictEqual(res.isOverdue, true);
    assert.strictEqual(res.fineAmount, 200.0);
    assert.strictEqual(res.isCapped, true);
  });
});
