'use strict';

/**
 * @fileoverview Structured error for KYC webhook handlers.
 *
 * Carries an HTTP status, a machine-readable error code, and optional
 * observability context (smeId, tenantId, requestId) through the Express
 * error chain so that {@link module:middleware/kycWebhookErrorHandler}
 * can produce a consistent structured response and structured log line
 * without per-handler duplication.
 *
 * ## Backward compatibility
 *
 * The three-argument form `new KycWebhookError(message, status, code)` is
 * preserved exactly.  The optional fourth argument `context` is additive:
 * all existing call sites work without modification.
 *
 * ## Retryability contract
 *
 * `isRetryable()` is the single authoritative source of truth for whether
 * a client should retry.  `kycWebhookErrorHandler` delegates to this method
 * rather than duplicating the RETRYABLE_CODES / RETRYABLE_STATUSES sets.
 *
 * @module errors/KycWebhookError
 */

/**
 * HTTP status codes that are considered retryable regardless of code.
 * @type {ReadonlySet<number>}
 */
const RETRYABLE_STATUSES = Object.freeze(new Set([429, 503]));

/**
 * Error codes that are explicitly retryable regardless of HTTP status.
 * @type {ReadonlySet<string>}
 */
const RETRYABLE_CODES = Object.freeze(new Set(['missing_secret', 'CIRCUIT_OPEN']));

/**
 * Structured error for KYC webhook ingestion and listing endpoints.
 *
 * Carries an HTTP status, a machine-readable error code, and optional
 * observability context so downstream handlers and log aggregators can
 * correlate failures without repeating the retryability logic.
 *
 * @example
 * // Backward-compatible three-argument form (all existing call sites unchanged)
 * throw new KycWebhookError('Missing secret', 503, 'missing_secret');
 *
 * @example
 * // Enriched form with observability context
 * throw new KycWebhookError(
 *   'Tenant scope mismatch.',
 *   403,
 *   'tenant_mismatch',
 *   { smeId: 'sme_123', tenantId: 'tenant_abc', requestId: 'req_xyz' }
 * );
 */
class KycWebhookError extends Error {
  /**
   * @param {string} message     - Human-readable error description.
   * @param {number} status      - HTTP status code (400, 401, 403, 500, 503, …).
   * @param {string} code        - Machine-readable error code (e.g. 'missing_secret').
   * @param {Object} [context]   - Optional observability context (never leaked to callers).
   * @param {string} [context.smeId]     - SME identifier associated with this error.
   * @param {string} [context.tenantId]  - Tenant identifier associated with this error.
   * @param {string} [context.requestId] - Correlation/request identifier for log joins.
   */
  constructor(message, status, code, context = {}) {
    super(message);
    this.name = 'KycWebhookError';
    this.status = status;
    this.code = code;

    // Observability context — stored internally, never serialised into HTTP
    // responses.  toLogContext() selects only safe, non-sensitive fields.
    this._context = {
      smeId: context && typeof context.smeId === 'string' ? context.smeId : undefined,
      tenantId: context && typeof context.tenantId === 'string' ? context.tenantId : undefined,
      requestId: context && typeof context.requestId === 'string' ? context.requestId : undefined,
    };
  }

  /**
   * Returns `true` when the error is transient and the caller may safely
   * retry the request without risk of duplicate side-effects.
   *
   * This is the single authoritative retryability predicate — all
   * downstream code (error handler, delivery jobs, tests) delegates here.
   *
   * @returns {boolean}
   */
  isRetryable() {
    return RETRYABLE_CODES.has(this.code) || RETRYABLE_STATUSES.has(this.status);
  }

  /**
   * Returns a safe, structured object suitable for structured logging.
   *
   * Keys map directly onto the pino JSON fields emitted by
   * `kycWebhookErrorHandler`.  All values are already strings or undefined;
   * no sensitive provider data, raw body bytes, or PII is ever included.
   *
   * @returns {{code: string, status: number, smeId?: string, tenantId?: string, requestId?: string}}
   */
  toLogContext() {
    const ctx = {
      code: this.code,
      status: this.status,
    };
    if (this._context.smeId !== undefined) {ctx.smeId = this._context.smeId;}
    if (this._context.tenantId !== undefined) {ctx.tenantId = this._context.tenantId;}
    if (this._context.requestId !== undefined) {ctx.requestId = this._context.requestId;}
    return ctx;
  }

  /**
   * Returns the client-facing retry hint as a string.
   *
   * @returns {string} Empty string when the error is not retryable.
   */
  toRetryHint() {
    if (RETRYABLE_CODES.has(this.code) || this.status === 503) {
      return 'Retry the request in a few moments.';
    }
    if (this.status === 429) {
      return 'Wait for the rate limit window to reset before retrying.';
    }
    return '';
  }
}

module.exports = KycWebhookError;
// Exported for test introspection and downstream consumers that need to
// apply the same policy (e.g. kycWebhookErrorHandler).
module.exports.RETRYABLE_STATUSES = RETRYABLE_STATUSES;
module.exports.RETRYABLE_CODES = RETRYABLE_CODES;
