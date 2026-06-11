/**
 * init-db-retry.js
 * Bounded retry around the boot-time database connection in init-db.js.
 * In orchestrated hosting the database often comes up slightly after the
 * app, so the first connection attempts can fail with connection-level
 * errors that resolve themselves seconds later.
 */

// Node errnos surfaced on err.parent.code / err.original.code when the
// database server is unreachable. These are NOT Postgres SQLSTATEs.
const CONNECTION_ERRNOS = [
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "EAI_AGAIN",
];

// Postgres SQLSTATEs that indicate auth/config problems, never a
// database that is still starting up. The postgres dialect does NOT
// throw SequelizeAccessDeniedError (that's mysql-only): bad credentials
// arrive as a generic SequelizeConnectionError whose parent.code is a
// class-28 SQLSTATE (28000/28P01 invalid authorization), and a missing
// default database as 3D000 (invalid catalog name). These must fail
// fast, so check them before the class-name check below.
function isNonRetryableSqlState(code) {
  return code.startsWith("28") || code === "3D000";
}

// Sequelize connection-error class names worth retrying. Note that with
// the postgres dialect, auth failures also surface as
// SequelizeConnectionError — they are excluded above via their SQLSTATE
// (28*/3D000) on err.parent.code before this list is consulted.
const CONNECTION_ERROR_NAMES = [
  "SequelizeConnectionError",
  "SequelizeConnectionRefusedError",
  "SequelizeConnectionTimedOutError",
  "SequelizeHostNotFoundError",
  "SequelizeHostNotReachableError",
];

// True only for connection-level failures worth retrying: Node errnos,
// Sequelize connection-error classes, or the Postgres connection SQLSTATEs
// (class 08, or 53300 too_many_connections). Permission/config errors
// (e.g. 42501, bad credentials) are not retryable.
function isRetryableConnectionError(err) {
  if (!err) return false;

  const code = (err.parent && err.parent.code) || (err.original && err.original.code);
  if (typeof code === "string") {
    if (isNonRetryableSqlState(code)) return false;
    if (CONNECTION_ERRNOS.includes(code)) return true;
    if (code.startsWith("08") || code === "53300") return true;
  }

  if (CONNECTION_ERROR_NAMES.includes(err.name)) return true;

  return false;
}

// Calls sequelizeInstance.authenticate(), retrying connection-level
// failures up to maxAttempts with delayMs between attempts. Any other
// error (or an exhausted budget) rethrows so the caller fails fast.
async function authenticateWithRetry(sequelizeInstance, options) {
  const maxAttempts = Math.max(options.maxAttempts || 1, 1);
  const delayMs = Math.max(options.delayMs || 0, 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sequelizeInstance.authenticate();
    } catch (err) {
      if (!isRetryableConnectionError(err) || attempt === maxAttempts) {
        throw err;
      }
      if (typeof options.onRetry === "function") {
        options.onRetry(attempt, maxAttempts, delayMs, err);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { isRetryableConnectionError, authenticateWithRetry };
