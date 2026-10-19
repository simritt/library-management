/**
 * Date helpers. The database compares against CURDATE() in the server's local
 * timezone, so application code must also use local calendar dates (not UTC via
 * toISOString, which is a day behind in IST between 00:00 and 05:30).
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Local calendar date as YYYY-MM-DD. */
function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parse YYYY-MM-DD (or a DATETIME string) to a UTC-midnight day number for timezone-safe day maths. */
function dayNumber(dateStr) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Add whole days to a YYYY-MM-DD string and return YYYY-MM-DD. */
function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  const result = new Date(Date.UTC(y, m - 1, d + Number(days)));
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

module.exports = { localDateString, dayNumber, addDays };
