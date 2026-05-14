/**
 * Retry wrapper for async operations.
 * @param {Function} fn - async function to retry
 * @param {Object} opts
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.baseDelay=500] - ms, doubles each retry
 * @param {string} [opts.label] - for logging
 */
async function withRetry(fn, { maxRetries = 3, baseDelay = 500, label = "operation" } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[withRetry] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`, err.message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

module.exports = { withRetry };
