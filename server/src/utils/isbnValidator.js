/**
 * ISBN Validator according to international standards (ISBN-10 and ISBN-13 checksums)
 * FR-Catalog.Add-02
 */
function cleanISBN(isbn) {
  if (typeof isbn !== 'string') return '';
  return isbn.replace(/[-\s]/g, '').trim().toUpperCase();
}

function isValidISBN10(isbn) {
  const cleaned = cleanISBN(isbn);
  if (!/^\d{9}[\dX]$/.test(cleaned)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned[i], 10) * (10 - i);
  }
  const lastChar = cleaned[9];
  const checkDigit = lastChar === 'X' ? 10 : parseInt(lastChar, 10);
  sum += checkDigit;

  return sum % 11 === 0;
}

function isValidISBN13(isbn) {
  const cleaned = cleanISBN(isbn);
  if (!/^\d{13}$/.test(cleaned)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(cleaned[i], 10);
    sum += (i % 2 === 0) ? digit : digit * 3;
  }
  const checkDigit = parseInt(cleaned[12], 10);
  const calculatedCheck = (10 - (sum % 10)) % 10;

  return calculatedCheck === checkDigit;
}

function validateISBN(isbn) {
  const cleaned = cleanISBN(isbn);
  if (!cleaned) return { valid: false, error: 'ISBN is required' };

  if (cleaned.length === 10) {
    if (isValidISBN10(cleaned)) {
      return { valid: true, cleaned, type: 'ISBN-10' };
    }
    return { valid: false, error: 'Invalid ISBN-10 checksum' };
  } else if (cleaned.length === 13) {
    if (isValidISBN13(cleaned)) {
      return { valid: true, cleaned, type: 'ISBN-13' };
    }
    return { valid: false, error: 'Invalid ISBN-13 checksum' };
  } else {
    return { valid: false, error: 'ISBN must be either 10 or 13 digits' };
  }
}

module.exports = {
  cleanISBN,
  isValidISBN10,
  isValidISBN13,
  validateISBN
};
