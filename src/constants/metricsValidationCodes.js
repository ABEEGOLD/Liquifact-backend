'use strict';

/**
 * @fileoverview Validation and error code constants for the LiquiFact backend.
 *
 * ## Purpose
 *
 * This module is the **single source of truth** for all machine-readable error
 * codes emitted by the application.  Every domain (invoice state machine,
 * configuration, storage, escrow, SME, webhooks, metrics auth) defines its
 * codes here so that:
 *
 *   - Callers compare against named constants, not magic strings.
 *   - No two domains accidentally share a code string (enforced by uniqueness
 *     checks in the test suite).
 *   - The set of codes is deterministic and immutable at runtime — an attempt
 *     to add, delete, or mutate a code after import throws in strict mode.
 *
 * ## Immutability invariant
 *
 * Every exported group object and the top-level `VALIDATION_CODES` registry
 * are sealed with `Object.freeze()`.  This means:
 *
 *   - In strict mode (`'use strict'`), writing to a frozen property throws a
 *     `TypeError` immediately — callers cannot silently widen or overwrite codes.
 *   - In sloppy mode, the write is silently ignored.  The frozen guard is
 *     belt-and-suspenders documentation as much as it is a runtime guard.
 *   - `Object.isFrozen()` returns `true` for every exported constant, which
 *     the test suite asserts explicitly.
 *
 * ## How to add a new code
 *
 * 1. Add the constant to the relevant domain group below.
 * 2. Update the corresponding `@property` JSDoc on the group.
 * 3. The uniqueness test in `tests/unit/metricsValidationCodes.test.js` will
 *    catch any accidental collision with an existing code in another domain.
 *
 * ## How callers import codes
 *
 * ```js
 * // Import a specific domain group:
 * const { INVOICE_SM_CODES } = require('../constants/metricsValidationCodes');
 * throw Object.assign(new Error('bad state'), { code: INVOICE_SM_CODES.INVALID_TRANSITION });
 *
 * // Import the flat registry:
 * const { VALIDATION_CODES } = require('../constants/metricsValidationCodes');
 * if (err.code === VALIDATION_CODES.INVALID_TRANSITION) { ... }
 * ```
 *
 * @module constants/metricsValidationCodes
 */

// ---------------------------------------------------------------------------
// Invoice State Machine codes
//
// Invariants:
//   - INVALID_TRANSITION is returned when fromState→toState is not in
//     VALID_TRANSITIONS and neither state is terminal.
//   - TERMINAL_STATE is returned when fromState is in TERMINAL_STATES.
//   - ALREADY_IN_TARGET_STATE is returned when fromState === toState.
//   - MISSING_* codes are returned for absent required fields.
//   - MISSING_TRANSITION_REASON / TRANSITION_REASON_TOO_LONG guard terminal
//     transitions (REJECTED, CANCELLED) that mandate a reason string.
// ---------------------------------------------------------------------------

/**
 * Validation codes owned by the invoice state-machine layer.
 *
 * @readonly
 * @enum {string}
 * @property {string} INVALID_TRANSITION        - fromState→toState pair not in VALID_TRANSITIONS.
 * @property {string} TERMINAL_STATE            - Cannot transition from a terminal state.
 * @property {string} ALREADY_IN_TARGET_STATE   - Invoice is already in the requested state.
 * @property {string} INVALID_CURRENT_STATE     - currentState value is not a recognised invoice state.
 * @property {string} INVALID_TARGET_STATE      - targetState value is not a recognised invoice state.
 * @property {string} MISSING_INVOICE_ID        - invoiceId field absent or empty.
 * @property {string} MISSING_CURRENT_STATE     - currentState field absent or empty.
 * @property {string} MISSING_TARGET_STATE      - targetState field absent or empty.
 * @property {string} MISSING_ACTOR             - actor field absent or empty.
 * @property {string} MISSING_TRANSITION_REASON - reason required for REJECTED/CANCELLED but not supplied.
 * @property {string} TRANSITION_REASON_TOO_LONG- reason exceeds MAX_TRANSITION_REASON_LENGTH (1024).
 */
const INVOICE_SM_CODES = Object.freeze({
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  TERMINAL_STATE: 'TERMINAL_STATE',
  ALREADY_IN_TARGET_STATE: 'ALREADY_IN_TARGET_STATE',
  INVALID_CURRENT_STATE: 'INVALID_CURRENT_STATE',
  INVALID_TARGET_STATE: 'INVALID_TARGET_STATE',
  MISSING_INVOICE_ID: 'MISSING_INVOICE_ID',
  MISSING_CURRENT_STATE: 'MISSING_CURRENT_STATE',
  MISSING_TARGET_STATE: 'MISSING_TARGET_STATE',
  MISSING_ACTOR: 'MISSING_ACTOR',
  MISSING_TRANSITION_REASON: 'MISSING_TRANSITION_REASON',
  TRANSITION_REASON_TOO_LONG: 'TRANSITION_REASON_TOO_LONG',
});

// ---------------------------------------------------------------------------
// Configuration / DTO codes
//
// Invariants:
//   - CONFIG_MISSING_FIELD is emitted when a required env var is absent.
//   - CONFIG_VALIDATION_ERROR is emitted when a value is present but violates
//     a type or constraint rule (e.g. JWT_SECRET too short, PORT out of range).
//   - CONFIG_PARSE_ERROR is emitted when a JSON env var fails JSON.parse.
//   - CONFIG_UNEXPECTED_ERROR is emitted for any non-Zod thrown value during
//     config parsing (programming bugs, non-Error throws, etc.).
//   - All config errors set recoverable=false — a broken config must be fixed
//     before the process is allowed to serve traffic.
// ---------------------------------------------------------------------------

/**
 * Validation codes owned by the configuration / ConfigDto layer.
 *
 * @readonly
 * @enum {string}
 * @property {string} CONFIG_MISSING_FIELD    - Required env var absent from input.
 * @property {string} CONFIG_VALIDATION_ERROR - Value present but violates constraint.
 * @property {string} CONFIG_PARSE_ERROR      - JSON env var failed to parse.
 * @property {string} CONFIG_UNEXPECTED_ERROR - Unexpected non-Zod error during parse.
 */
const CONFIG_CODES = Object.freeze({
  CONFIG_MISSING_FIELD: 'CONFIG_MISSING_FIELD',
  CONFIG_VALIDATION_ERROR: 'CONFIG_VALIDATION_ERROR',
  CONFIG_PARSE_ERROR: 'CONFIG_PARSE_ERROR',
  CONFIG_UNEXPECTED_ERROR: 'CONFIG_UNEXPECTED_ERROR',
});

// ---------------------------------------------------------------------------
// Storage / upload codes
//
// Invariants:
//   - INVALID_FILENAME is set when a filename contains path traversal sequences
//     (../), null bytes, or other disallowed characters.
//   - INVALID_MIME_TYPE is set when the uploaded file is not on the MIME allowlist.
//   - FILE_TOO_LARGE is set when the payload exceeds BODY_LIMIT_INVOICE.
//   - INVALID_TENANT_ID / INVALID_INVOICE_ID are set when the route parameters
//     contain characters outside [a-zA-Z0-9_-].
//   - PRESIGNED_URL_EXPIRY_OUT_OF_RANGE is set when the requested expiry window
//     exceeds the allowed bounds (upload: 15 min, download: 1 h–24 h).
// ---------------------------------------------------------------------------

/**
 * Validation codes owned by the storage / object-upload layer.
 *
 * @readonly
 * @enum {string}
 * @property {string} INVALID_FILENAME                  - Filename fails allowlist/sanitization.
 * @property {string} INVALID_MIME_TYPE                 - File MIME type not on allowed list.
 * @property {string} FILE_TOO_LARGE                    - Payload exceeds configured body limit.
 * @property {string} INVALID_TENANT_ID                 - Tenant ID contains disallowed characters.
 * @property {string} INVALID_INVOICE_ID                - Invoice ID contains disallowed characters.
 * @property {string} PRESIGNED_URL_EXPIRY_OUT_OF_RANGE - Requested URL expiry outside allowed window.
 */
const STORAGE_CODES = Object.freeze({
  INVALID_FILENAME: 'INVALID_FILENAME',
  INVALID_MIME_TYPE: 'INVALID_MIME_TYPE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_TENANT_ID: 'INVALID_TENANT_ID',
  INVALID_INVOICE_ID: 'INVALID_INVOICE_ID',
  PRESIGNED_URL_EXPIRY_OUT_OF_RANGE: 'PRESIGNED_URL_EXPIRY_OUT_OF_RANGE',
});

// ---------------------------------------------------------------------------
// Escrow / on-chain codes
//
// Invariants:
//   - INVALID_CONTRACT_ID is set when a contract address fails Stellar
//     base-32 format validation.
//   - RPC_ERROR is set when the Soroban RPC endpoint returns an error or
//     is unreachable.
//   - ESCROW_NOT_FOUND is set when no escrow record exists for an invoice.
//   - ESCROW_ALREADY_LINKED is set when an attempt is made to link an invoice
//     that already has an active escrow.
//   - INVALID_ASSET is set when a Stellar asset code is malformed.
//   - RECONCILIATION_MISMATCH is set when DB funded total ≠ on-chain amount.
// ---------------------------------------------------------------------------

/**
 * Validation codes owned by the escrow / on-chain layer.
 *
 * @readonly
 * @enum {string}
 * @property {string} INVALID_CONTRACT_ID       - Contract address fails Stellar base-32 validation.
 * @property {string} RPC_ERROR                 - Soroban RPC endpoint error or unreachable.
 * @property {string} ESCROW_NOT_FOUND          - No escrow found for the given invoice.
 * @property {string} ESCROW_ALREADY_LINKED     - Invoice already has an active escrow.
 * @property {string} INVALID_ASSET             - Stellar asset code is malformed.
 * @property {string} RECONCILIATION_MISMATCH   - DB funded total differs from on-chain amount.
 */
const ESCROW_CODES = Object.freeze({
  INVALID_CONTRACT_ID: 'INVALID_CONTRACT_ID',
  RPC_ERROR: 'RPC_ERROR',
  ESCROW_NOT_FOUND: 'ESCROW_NOT_FOUND',
  ESCROW_ALREADY_LINKED: 'ESCROW_ALREADY_LINKED',
  INVALID_ASSET: 'INVALID_ASSET',
  RECONCILIATION_MISMATCH: 'RECONCILIATION_MISMATCH',
});

// ---------------------------------------------------------------------------
// SME (Small/Medium Enterprise) codes
//
// Invariants:
//   - SME_NOT_FOUND is set when no SME record exists for the requested ID.
//   - SME_KYC_REQUIRED is set when a protected action is attempted before KYC.
//   - SME_KYC_REJECTED is set when KYC verification was explicitly rejected.
//   - SME_METRICS_UNAVAILABLE is set when the metrics aggregation query fails
//     for a non-auth reason (e.g. DB timeout).
// ---------------------------------------------------------------------------

/**
 * Validation codes owned by the SME layer.
 *
 * @readonly
 * @enum {string}
 * @property {string} SME_NOT_FOUND            - No SME record found for the given ID.
 * @property {string} SME_KYC_REQUIRED         - Protected action requires KYC verification.
 * @property {string} SME_KYC_REJECTED         - SME KYC verification was rejected.
 * @property {string} SME_METRICS_UNAVAILABLE  - Metrics query failed (non-auth reason).
 */
const SME_CODES = Object.freeze({
  SME_NOT_FOUND: 'SME_NOT_FOUND',
  SME_KYC_REQUIRED: 'SME_KYC_REQUIRED',
  SME_KYC_REJECTED: 'SME_KYC_REJECTED',
  SME_METRICS_UNAVAILABLE: 'SME_METRICS_UNAVAILABLE',
});

// ---------------------------------------------------------------------------
// Webhook codes
//
// Invariants:
//   - WEBHOOK_DELIVERY_FAILED is set after all retry attempts are exhausted.
//   - WEBHOOK_SIGNATURE_INVALID is set when the HMAC-SHA256 signature on an
//     inbound webhook does not match the computed value.
//   - WEBHOOK_TIMESTAMP_STALE is set when |now − t| > 5 minutes (replay guard).
//   - WEBHOOK_PAYLOAD_INVALID is set when the webhook body cannot be parsed or
//     fails structural validation.
//   - WEBHOOK_TENANT_NOT_FOUND is set when the tenant has no webhook_url configured.
// ---------------------------------------------------------------------------

/**
 * Validation codes owned by the webhook delivery layer.
 *
 * @readonly
 * @enum {string}
 * @property {string} WEBHOOK_DELIVERY_FAILED    - All retry attempts exhausted; delivery dead-lettered.
 * @property {string} WEBHOOK_SIGNATURE_INVALID  - Inbound HMAC-SHA256 signature mismatch.
 * @property {string} WEBHOOK_TIMESTAMP_STALE    - Timestamp outside 5-minute replay tolerance window.
 * @property {string} WEBHOOK_PAYLOAD_INVALID    - Payload cannot be parsed or fails validation.
 * @property {string} WEBHOOK_TENANT_NOT_FOUND   - Tenant has no webhook_url configured.
 */
const WEBHOOK_CODES = Object.freeze({
  WEBHOOK_DELIVERY_FAILED: 'WEBHOOK_DELIVERY_FAILED',
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  WEBHOOK_TIMESTAMP_STALE: 'WEBHOOK_TIMESTAMP_STALE',
  WEBHOOK_PAYLOAD_INVALID: 'WEBHOOK_PAYLOAD_INVALID',
  WEBHOOK_TENANT_NOT_FOUND: 'WEBHOOK_TENANT_NOT_FOUND',
});

// ---------------------------------------------------------------------------
// Metrics auth codes
//
// Invariants:
//   - METRICS_AUTH_REQUIRED is set when a request reaches /metrics without a
//     valid bearer token and the origin is not a loopback address.
//   - METRICS_INVALID_TOKEN is set when the bearer token is present but does
//     not match METRICS_BEARER_TOKEN (constant-time comparison).
//   - METRICS_NON_LOOPBACK_DENIED is set when no token is configured and the
//     request originates from a non-loopback address.
// ---------------------------------------------------------------------------

/**
 * Validation codes owned by the metrics authentication layer.
 *
 * @readonly
 * @enum {string}
 * @property {string} METRICS_AUTH_REQUIRED       - Request lacks authorization entirely.
 * @property {string} METRICS_INVALID_TOKEN       - Bearer token present but does not match.
 * @property {string} METRICS_NON_LOOPBACK_DENIED - No token configured; non-loopback origin rejected.
 */
const METRICS_AUTH_CODES = Object.freeze({
  METRICS_AUTH_REQUIRED: 'METRICS_AUTH_REQUIRED',
  METRICS_INVALID_TOKEN: 'METRICS_INVALID_TOKEN',
  METRICS_NON_LOOPBACK_DENIED: 'METRICS_NON_LOOPBACK_DENIED',
});

// ---------------------------------------------------------------------------
// Flat registry
//
// VALIDATION_CODES is a convenience flat map that merges every domain group.
// It is frozen after construction.  Callers who only care about one domain
// should prefer the named group export for clarity.
//
// Invariant: no two codes in the registry may share the same string value.
// This is enforced by the test suite (uniqueness check).
// ---------------------------------------------------------------------------

/**
 * Flat registry that merges all domain groups into one map.
 *
 * Useful for generic error-code comparisons (e.g. in middleware that handles
 * errors from multiple subsystems without knowing the specific domain).
 *
 * @readonly
 * @type {Readonly<Record<string, string>>}
 */
const VALIDATION_CODES = Object.freeze({
  ...INVOICE_SM_CODES,
  ...CONFIG_CODES,
  ...STORAGE_CODES,
  ...ESCROW_CODES,
  ...SME_CODES,
  ...WEBHOOK_CODES,
  ...METRICS_AUTH_CODES,
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  INVOICE_SM_CODES,
  CONFIG_CODES,
  STORAGE_CODES,
  ESCROW_CODES,
  SME_CODES,
  WEBHOOK_CODES,
  METRICS_AUTH_CODES,
  VALIDATION_CODES,
};
