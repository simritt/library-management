/**
 * Fine and Due Date Calculator
 * Follows BR-1, BR-2, BR-4, BR-5, BR-6
 */
const { localDateString, dayNumber, addDays } = require('./dates');

/**
 * Calculates due date based on member type (BR-2)
 * Student: 14 days, Faculty: 30 days (or an explicit requested duration)
 */
function calculateDueDate(issueDateStr, memberType, requestedDays) {
  const issueDate = issueDateStr || localDateString();
  const defaultDays = memberType === 'Faculty' ? 30 : 14;
  const days = Number.isInteger(Number(requestedDays)) && Number(requestedDays) > 0 ? Number(requestedDays) : defaultDays;
  return addDays(issueDate, days);
}

/**
 * Calculates fine based on due date and return date (BR-5, BR-6)
 * Rs. 2 per day per book overdue, capped at Rs. 200 per loan
 */
function calculateFine(dueDateStr, returnDateStr, ratePerDay = 2.0, maxCap = 200.0) {
  const diffDays = dayNumber(returnDateStr || localDateString()) - dayNumber(dueDateStr);

  if (diffDays <= 0) {
    return { daysOverdue: 0, fineAmount: 0.0, isOverdue: false };
  }

  const rawFine = diffDays * ratePerDay;
  const fineAmount = Math.min(rawFine, maxCap);

  return {
    daysOverdue: diffDays,
    fineAmount: parseFloat(fineAmount.toFixed(2)),
    isOverdue: true,
    isCapped: rawFine >= maxCap
  };
}

module.exports = { calculateDueDate, calculateFine };
