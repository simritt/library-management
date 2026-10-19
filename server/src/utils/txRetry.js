/**
 * MySQL can abort one of two competing transactions (deadlock / lock wait timeout).
 * The aborted transaction has already been rolled back, so it is safe to run the
 * whole request handler again. Handlers rethrow retryable errors from their catch
 * block (after rollback) instead of answering 500.
 */
const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

const isRetryable = (error) => Boolean(error && RETRYABLE.has(error.code));

function withDeadlockRetry(handler, attempts = 5) {
  return async (req, res, next) => {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await handler(req, res, next);
      } catch (error) {
        if (!isRetryable(error) || attempt === attempts || res.headersSent) {
          console.error('Request failed after transaction retries:', error);
          if (!res.headersSent) res.status(500).json({ success: false, error: 'The database was busy. Please try the action again.' });
          return undefined;
        }
        await new Promise((resolve) => setTimeout(resolve, 15 * attempt + Math.random() * 40));
      }
    }
    return undefined;
  };
}

module.exports = { isRetryable, withDeadlockRetry };
