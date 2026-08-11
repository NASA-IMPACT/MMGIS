/**
 * dbPassword.js
 * Supplies the PostgreSQL password at connection time so the app tracks the
 * RDS-managed master-password rotation instead of freezing one copy at process
 * start.
 *
 * Two modes, selected purely by whether DB_SECRET_ARN is set:
 *
 *   - DB_SECRET_ARN unset (full deployment / local dev): getDbPassword() just
 *     returns process.env.DB_PASS, exactly as the connection code did before.
 *     Secrets Manager is never contacted and the SDK client is never loaded.
 *
 *   - DB_SECRET_ARN set (lean deployment): getDbPassword() returns the password
 *     from the RDS-managed master secret, fetched from Secrets Manager and
 *     cached in-process. RDS rotates that secret single-user (the previous
 *     password stops authenticating the moment the new one is set), and ECS
 *     secrets[] injection resolves only once at task launch — so a frozen copy
 *     breaks on the next rotation. node-postgres calls a `password` function and
 *     Sequelize runs its beforeConnect hook for every new physical connection,
 *     so fetching here keeps the credential current with no task restart.
 *
 * The cache refreshes on a bounded interval (DB_SECRET_REFRESH_MS) and can be
 * force-refreshed on demand — used to recover immediately when a new connection
 * sees SQLSTATE 28P01 (password authentication failed) between interval
 * refreshes.
 */

const logger = require("../../logger");

// Bounded cache lifetime. A new connection made after this window re-reads the
// secret, which caps how long a post-rotation credential can go unnoticed even
// on code paths that never surface a 28P01 to refresh on. RDS rotation is
// roughly weekly, so a value in the minutes is comfortably conservative.
const REFRESH_MS =
  parseInt(process.env.DB_SECRET_REFRESH_MS, 10) || 15 * 60 * 1000;

let client = null;
let cachedPassword = null;
let cachedAt = 0;
let inFlight = null;

function secretArn() {
  const arn = process.env.DB_SECRET_ARN;
  return typeof arn === "string" && arn.trim() !== "" ? arn.trim() : null;
}

// True only when a secret ARN is configured (lean deployment). Everything below
// short-circuits to process.env.DB_PASS when this is false.
function usesSecretsManager() {
  return secretArn() !== null;
}

function getClient() {
  if (!client) {
    const { SecretsManagerClient } = require("@aws-sdk/client-secrets-manager");
    client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  }
  return client;
}

async function fetchPassword() {
  const { GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
  const out = await getClient().send(
    new GetSecretValueCommand({ SecretId: secretArn() })
  );
  let parsed;
  try {
    parsed = JSON.parse(out.SecretString);
  } catch (err) {
    throw new Error(
      "DB_SECRET_ARN secret is not valid JSON; expected an RDS-managed {username,password} secret."
    );
  }
  if (!parsed || typeof parsed.password !== "string") {
    throw new Error(
      "DB_SECRET_ARN secret has no string 'password' key; expected an RDS-managed {username,password} secret."
    );
  }
  cachedPassword = parsed.password;
  cachedAt = Date.now();
  return cachedPassword;
}

// Collapse concurrent cache misses onto a single Secrets Manager call.
function fetchOnce() {
  if (!inFlight) {
    inFlight = fetchPassword().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * The current DB password. Full/local mode returns process.env.DB_PASS; lean
 * mode returns the cached RDS secret, fetching it when the cache is empty or
 * older than DB_SECRET_REFRESH_MS.
 */
async function getDbPassword() {
  if (!usesSecretsManager()) return process.env.DB_PASS;
  const fresh = cachedPassword != null && Date.now() - cachedAt < REFRESH_MS;
  if (fresh) return cachedPassword;
  return fetchOnce();
}

/**
 * Force the next getDbPassword() to re-read Secrets Manager. No-op in
 * full/local mode. Returns the refreshed password.
 */
async function refreshDbPassword() {
  if (!usesSecretsManager()) return process.env.DB_PASS;
  cachedPassword = null;
  cachedAt = 0;
  return fetchOnce();
}

/**
 * True when err is a Postgres "password authentication failed" (SQLSTATE
 * 28P01), including the forms Sequelize (err.parent) and node-postgres
 * (err.original) wrap it in.
 */
function isPasswordAuthError(err) {
  if (!err) return false;
  const code =
    err.code ||
    (err.parent && err.parent.code) ||
    (err.original && err.original.code);
  return code === "28P01";
}

/**
 * Run an operation that opens a new DB connection. If it fails with 28P01 while
 * running against Secrets Manager, refresh the cached secret once and retry the
 * operation exactly once. Any other error, or full/local mode, propagates
 * unchanged.
 */
async function withPasswordRefreshRetry(op) {
  try {
    return await op();
  } catch (err) {
    if (usesSecretsManager() && isPasswordAuthError(err)) {
      logger(
        "info",
        "DB password authentication failed; refreshing the RDS master secret and retrying once.",
        "dbPassword"
      );
      await refreshDbPassword();
      return op();
    }
    throw err;
  }
}

module.exports = {
  getDbPassword,
  refreshDbPassword,
  isPasswordAuthError,
  withPasswordRefreshRetry,
  usesSecretsManager,
};
