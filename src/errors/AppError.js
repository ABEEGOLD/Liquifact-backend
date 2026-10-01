'use strict';

const formatProblemDetails = require('../utils/problemDetails');

/**
 * @fileoverview RFC 7807-compliant application error class.
 *
 * # Compatibility contract
 *
 * Every property listed below MUST remain stable across refactors.
 * They are read by: mapError, problemJson, errorHandler, smeAuth, auth,
 * validationHelper, invoiceService, adminKyc, sorobanSim, and ~37 other
 * modules and test suites.
 *
 * ## Instance properties (always present after construction)
 *
 * | Property    | Type             | Notes                                            |
 * |-------------|------------------|--------------------------------------------------|
 * | name        | string           | Always `'AppError'` — used for duck-typing       |
 * | type        | string           | RFC 7807 type URI (falls back to `about:blank`)  |
 * | title       | string           | Short human-readable summary                     |
 * | status      | number           | HTTP status code (falls back to `500`)           |
 * | detail      | string|undefined | Per-occurrence explanation                       |
 * | instance    | string|undefined | URI of the specific occurrence                   |
 * | code        | string|undefined | Machine-readable code for callers                |
 * | retryable   | boolean          | Whether the caller may safely retry              |
 * | retryHint   | string|undefined | camelCase on the instance (NOT `retry_hint`)     |
 * | fieldErrors | object|undefined | Present ONLY when explicitly supplied in params  |
 * | context     | unknown|null     | Always `null` when not supplied                  |
 * | message     | string           | Inherited from Error — equals `title`            |
 * | stack       | string           | Captured via captureStackTrace                   |
 *
 * ## Static properties
 *
 * | Property               | Type   | Value                      |
 * |------------------------|--------|----------------------------|
 * | FENCING_TOKEN_REJECTED | string | `'FENCING_TOKEN_REJECTED'` |
 *
 * ## Wire-format invariant
 *
 * `retryHint` is camelCase on the **instance**.
 * `formatProblemDetails` serialises it as snake_case `retry_hint` on the
 * **wire** (JSON response body). Callers MUST NOT read `error.retry_hint`;
 * they MUST read `error.retryHint`.
 *
 * ## Type-guard invariant
 *
 * Both `instanceof AppError` and `error.name === 'AppError'` identify an
 * AppError. The dual check is required because Jest's module cache can
 * produce multiple class instances from different `require` calls.
 *
 * @see https://tools.ietf.org/html/rfc7807
 * @module errors/AppError
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `status` is a finite integer in the HTTP range [100, 599].
 *
 * @param {unknown} status
 * @returns {boolean}
 */
function isValidHttpStatus(status) {
  return (
    typeof status === 'number' &&
    Number.isFinite(status) &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
  );
}

// ---------------------------------------------------------------------------
// AppError
// ---------------------------------------------------------------------------

/**
 * RFC 7807-compliant application error.
 *
 * Extends the built-in `Error` class to carry structured Problem Details
 * (type, title, status, detail, instance) along with extension fields
 * (code, retryable, retryHint, fieldErrors, context).
 *
 * All field assembly and defaulting is delegated to `formatProblemDetails`
 * so the wire format remains consistent regardless of which code path
 * constructs the error.
 *
 * @extends {Error}
 *
 * @example <caption>Direct construction</caption>
 * throw new AppError({
 *   type:     'https://liquifact.com/probs/not-found',
 *   title:    'Not Found',
 *   status:   404,
 *   detail:   'Invoice inv_123 does not exist.',
 *   code:     'NOT_FOUND',
 *   instance: req.originalUrl,
 * });
 *
 * @example <caption>Static factory</caption>
 * throw AppError.notFound('Invoice inv_123 does not exist.', {
 *   code:     'INVOICE_NOT_FOUND',
 *   instance: req.originalUrl,
 * });
 */
class AppError extends Error {
  /**
   * Validates HTTP status code is within valid range.
   *
   * @param {unknown} status - Status code to validate.
   * @throws {TypeError} If status is not a number or is out of valid range.
   * @static
   */
  static _validateStatus(status) {
    if (status !== undefined && status !== null) {
      if (typeof status !== 'number') {
        throw new TypeError(`AppError status must be a number, received: ${typeof status}`);
      }
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        throw new RangeError(`AppError status must be an integer between 100 and 599, received: ${status}`);
      }
    }
  }

  /**
   * Validates type is a string when provided.
   *
   * @param {unknown} type - Type URI to validate.
   * @throws {TypeError} If type is not a string when provided.
   * @static
   */
  static _validateType(type) {
    if (type !== undefined && type !== null && typeof type !== 'string') {
      throw new TypeError(`AppError type must be a string, received: ${typeof type}`);
    }
  }

  /**
   * Validates retryable/retryHint consistency.
   *
   * @param {unknown} retryable - Retryable flag.
   * @param {unknown} retryHint - Retry hint.
   * @static
   */
  static _validateRetryConsistency(retryable, retryHint) {
    if (retryable === true && !retryHint) {
      // Log warning but don't throw - this is a soft invariant
      console.warn('[AppError] retryable=true without retryHint is discouraged');
    }
  }

  /**
   * Creates a new AppError instance.
   *
   * All parameters are optional at the call site; the constructor applies
   * RFC 7807 defaults for any omitted fields.
   *
   * @param {object}  [params]                  - Problem Details parameters.
   * @param {string}  [params.type]             - RFC 7807 type URI. Defaults to `'about:blank'`.
   * @param {string}  [params.title]            - Short human-readable summary. Defaults to `'An unexpected error occurred'`.
   * @param {number}  [params.status=500]       - HTTP status code [100–599]. Invalid values default to 500.
   * @param {string}  [params.detail]           - Human-readable explanation specific to this occurrence.
   * @param {string}  [params.instance]         - URI reference identifying the specific occurrence.
   * @param {string}  [params.code]             - Machine-readable application error code.
   * @param {boolean} [params.retryable=false]  - Whether the caller may safely retry.
   * @param {string}  [params.retryHint]        - camelCase retry advice (serialised as snake_case on the wire).
   * @param {object}  [params.fieldErrors]      - Field-level errors; present on the instance only when explicitly supplied.
   * @param {unknown} [params.context]          - Arbitrary contextual data; defaults to `null`.
   */
  constructor(params) {
    // ── Normalise params ──────────────────────────────────────────────────
    const safeParams = (params !== null && typeof params === 'object') ? params : {};

    // Validate status — guard against NaN, floats, strings, and out-of-range
    // values without crashing callers; fall back to 500 with a dev warning.
    const rawStatus = safeParams.status;
    let effectiveStatus = 500;

    if (rawStatus !== undefined) {
      if (isValidHttpStatus(rawStatus)) {
        effectiveStatus = rawStatus;
      } else if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(
          `[AppError] Invalid HTTP status "${rawStatus}" — defaulting to 500.`
        );
      }
    }

    const title =
      typeof safeParams.title === 'string' && safeParams.title.length > 0
        ? safeParams.title
        : 'An unexpected error occurred';

    // ── Error base class ──────────────────────────────────────────────────
    // `message` is set to `title` so generic Error handlers that read only
    // `error.message` still surface a useful value.
    super(title);

    /**
     * Always `'AppError'`.
     *
     * Used for duck-type checks in `mapError` and `problemJson` when Jest
     * module isolation creates separate class instances from the same file.
     * @type {string}
     */
    this.name = 'AppError';

    // ── Delegate field assembly to the canonical RFC 7807 builder ─────────
    // We strip `stack` so it never leaks into the serialised problem object,
    // pass the already-validated `title` (normalised above) and the corrected
    // `effectiveStatus` so defaulting is consistent throughout the stack.
    const problem = formatProblemDetails({
      ...safeParams,
      title,
      status: effectiveStatus,
      stack: undefined,
    });

    // ── RFC 7807 core fields ──────────────────────────────────────────────

    /**
     * RFC 7807 problem type URI.
     * Falls back to `'about:blank'` when not supplied.
     * @type {string}
     */
    this.type = problem.type;

    /**
     * Short human-readable summary of the problem type.
     * @type {string}
     */
    this.title = problem.title;

    /**
     * HTTP status code associated with this error.
     * @type {number}
     */
    this.status = problem.status;

    /**
     * Human-readable explanation specific to this occurrence of the problem.
     * `undefined` when not supplied.
     * @type {string|undefined}
     */
    this.detail = problem.detail;

    /**
     * URI reference that identifies the specific occurrence of the problem.
     * `undefined` when not supplied.
     * @type {string|undefined}
     */
    this.instance = problem.instance;

    // ── Extension fields ──────────────────────────────────────────────────

    /**
     * Machine-readable application error code.
     *
     * `undefined` when not supplied; `mapError` falls back to
     * `httpStatusToCode(status)` in that case.
     * @type {string|undefined}
     */
    this.code = problem.code;

    /**
     * Whether the caller may safely retry the request without modification.
     *
     * Explicitly defaults to `false` (not `undefined`) so downstream boolean
     * checks never need a fallback guard.
     * @type {boolean}
     */
    this.retryable = typeof problem.retryable === 'boolean' ? problem.retryable : false;

    /**
     * Human-readable retry advice in **camelCase** on the instance.
     *
     * Invariant: this property is `retryHint` (camelCase) on the instance.
     * `formatProblemDetails` serialises it as `retry_hint` (snake_case) on
     * the wire. Callers MUST NOT read `error.retry_hint`.
     * @type {string|undefined}
     */
    this.retryHint = problem.retry_hint;

    // ── Conditional extension fields ──────────────────────────────────────

    /**
     * Map of field path → first error message for validation failures.
     *
     * Present on the instance **only** when `fieldErrors` was explicitly
     * supplied in the constructor params (checked via `hasOwnProperty`).
     * This preserves the contract relied upon by `validationHelper.js` which
     * does its own `hasOwnProperty` check before accessing field errors.
     * @type {object|undefined}
     */
    if (Object.prototype.hasOwnProperty.call(safeParams, 'fieldErrors')) {
      this.fieldErrors = safeParams.fieldErrors;
    }

    /**
     * Arbitrary contextual data attached to the error (e.g. tenant metadata,
     * invoice IDs). Always `null` (never `undefined`) when not supplied, so
     * downstream null-checks never need an additional undefined guard.
     * @type {unknown}
     */
    this.context = Object.prototype.hasOwnProperty.call(safeParams, 'context')
      ? safeParams.context
      : null;

    // ── Stack trace ───────────────────────────────────────────────────────
    // Capture from the actual throw site, excluding this constructor frame.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  // ---------------------------------------------------------------------------
  // Static factories
  // ---------------------------------------------------------------------------

  /**
   * Creates a 400 Bad Request AppError.
   *
   * @param {string} detail - Human-readable explanation.
   * @param {object} [options] - Additional fields (code, instance, fieldErrors, …).
   * @returns {AppError}
   *
   * @example
   * throw AppError.badRequest('Body must be a JSON object.', {
   *   code:     'INVALID_BODY',
   *   instance: req.originalUrl,
   * });
   */
  static badRequest(detail, options = {}) {
    return new AppError({
      type: 'https://liquifact.com/probs/bad-request',
      title: 'Bad Request',
      status: 400,
      detail,
      ...options,
    });
  }

  /**
   * Creates a 401 Unauthorized AppError.
   *
   * @param {string} [detail='Authentication is required.'] - Human-readable explanation.
   * @param {object} [options] - Additional fields (code, instance, …).
   * @returns {AppError}
   */
  static unauthorized(detail = 'Authentication is required.', options = {}) {
    return new AppError({
      type: 'https://liquifact.com/probs/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail,
      ...options,
    });
  }

  /**
   * Creates a 403 Forbidden AppError.
   *
   * @param {string} [detail='Access is forbidden.'] - Human-readable explanation.
   * @param {object} [options] - Additional fields (code, instance, …).
   * @returns {AppError}
   */
  static forbidden(detail = 'Access is forbidden.', options = {}) {
    return new AppError({
      type: 'https://liquifact.com/probs/forbidden',
      title: 'Forbidden',
      status: 403,
      detail,
      ...options,
    });
  }

  /**
   * Creates a 404 Not Found AppError.
   *
   * @param {string} [detail='The requested resource was not found.'] - Human-readable explanation.
   * @param {object} [options] - Additional fields (code, instance, …).
   * @returns {AppError}
   */
  static notFound(detail = 'The requested resource was not found.', options = {}) {
    return new AppError({
      type: 'https://liquifact.com/probs/not-found',
      title: 'Not Found',
      status: 404,
      detail,
      ...options,
    });
  }

  /**
   * Creates a 409 Conflict AppError.
   *
   * @param {string} [detail='A conflict occurred.'] - Human-readable explanation.
   * @param {object} [options] - Additional fields (code, instance, retryable, …).
   * @returns {AppError}
   */
  static conflict(detail = 'A conflict occurred.', options = {}) {
    return new AppError({
      type: 'https://liquifact.com/probs/conflict',
      title: 'Conflict',
      status: 409,
      detail,
      ...options,
    });
  }

  /**
   * Creates a 422 Unprocessable Entity AppError.
   *
   * @param {string} [detail='The request is unprocessable.'] - Human-readable explanation.
   * @param {object} [options] - Additional fields (code, fieldErrors, instance, …).
   * @returns {AppError}
   */
  static unprocessableEntity(detail = 'The request is unprocessable.', options = {}) {
    return new AppError({
      type: 'https://liquifact.com/probs/unprocessable-entity',
      title: 'Unprocessable Entity',
      status: 422,
      detail,
      ...options,
    });
  }

  /**
   * Creates a 429 Too Many Requests AppError.
   *
   * Defaults `retryable` to `true` and supplies a sensible `retryHint`.
   * Either can be overridden via `options`.
   *
   * @param {string} [detail='Too many requests. Please slow down.'] - Human-readable explanation.
   * @param {object} [options] - Additional fields (code, retryHint, …).
   * @returns {AppError}
   */
  static tooManyRequests(detail = 'Too many requests. Please slow down.', options = {}) {
    return new AppError({
      type: 'https://liquifact.com/probs/too-many-requests',
      title: 'Too Many Requests',
      status: 429,
      detail,
      retryable: true,
      retryHint: 'Wait for the rate-limit window to reset and try again.',
      ...options,
    });
  }

  /**
   * Creates a 500 Internal Server Error AppError.
   *
   * @param {string} [detail='An internal server error occurred.'] - Human-readable explanation.
   * @param {object} [options] - Additional fields (code, context, …).
   * @returns {AppError}
   */
  static internal(detail = 'An internal server error occurred.', options = {}) {
    return new AppError({
      type: 'https://liquifact.com/probs/internal-server-error',
      title: 'Internal Server Error',
      status: 500,
      detail,
      ...options,
    });
  }

  /**
   * Creates a 503 Service Unavailable AppError.
   *
   * Defaults `retryable` to `true` and supplies a sensible `retryHint`.
   * Either can be overridden via `options`.
   *
   * @param {string} [detail='The service is temporarily unavailable.'] - Human-readable explanation.
   * @param {object} [options] - Additional fields (code, retryHint, …).
   * @returns {AppError}
   */
  static serviceUnavailable(detail = 'The service is temporarily unavailable.', options = {}) {
    return new AppError({
      type: 'https://liquifact.com/probs/service-unavailable',
      title: 'Service Unavailable',
      status: 503,
      detail,
      retryable: true,
      retryHint: 'Retry the request in a few moments.',
      ...options,
    });
  }

  /**
   * Type-guard that identifies AppError instances even across Jest module
   * boundaries where `instanceof` may return `false` due to separate
   * `require()` cache entries for the same source file.
   *
   * @param {unknown} value - Any value.
   * @returns {value is AppError}
   */
  static isAppError(value) {
    return Boolean(
      value &&
      typeof value === 'object' &&
      (value instanceof AppError || value.name === 'AppError')
    );
  }
}

// ---------------------------------------------------------------------------
// Static constants
// ---------------------------------------------------------------------------

/**
 * Error code indicating that a job-lease fencing token was rejected.
 *
 * Returned when a worker attempts a write or completion operation after
 * its lease has expired or been reassigned to another worker. This error
 * is **non-retryable by default** because the original lease is permanently
 * invalid.
 *
 * Callers MUST treat this as a signal to abort the current job attempt
 * rather than retry immediately.
 *
 * Defined via `Object.defineProperty` with `writable: false` and
 * `configurable: false` to prevent accidental mutation.
 *
 * @type {string}
 * @constant
 */
Object.defineProperty(AppError, 'FENCING_TOKEN_REJECTED', {
  value: 'FENCING_TOKEN_REJECTED',
  writable: false,
  enumerable: true,
  configurable: false,
});

module.exports = AppError;
