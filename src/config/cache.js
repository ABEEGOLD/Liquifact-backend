'use strict';

const DEFAULT_ESCROW_MAX_ENTRIES = 500;
// Keep millisecond TTLs within the signed 32-bit interval supported by timers.
const MAX_TTL_SECONDS = Math.floor(0x7fffffff / 1000);

const MIN_CACHE_TTL_SECONDS = 1;
const MAX_CACHE_TTL_SECONDS = 86400;
const MIN_CACHE_MAX_ENTRIES = 1;
const MAX_CACHE_MAX_ENTRIES = 1000000;

/**
 * Parses and clamps a positive integer configuration value.
 *
 * Returns the default when the raw value is missing, non-numeric,
 * non-integer, or outside the accepted range. Values that are numeric
 * and in-range are returned as-is, ensuring deterministic behavior
 * for duplicate and boundary inputs.
 *
 * @param {unknown} raw - Raw environment value.
 * @param {number} defaultValue - Fallback value.
 * @param {number} min - Inclusive lower bound.
 * @param {number} max - Inclusive upper bound.
 * @returns {number} Parsed and clamped value.
 */
function parsePositiveInt(raw, defaultValue, min, max) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return defaultValue;
  }

  const trimmed = raw.trim();
  // Reject non-integer formats (e.g. '1.5', '1e'3', '+1', '010' is accepted).
  if (!/^[0-9]+$/.test(trimmed)) {
    return defaultValue;
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return defaultValue;
  }

  if (parsed < min || parsed > max) {
    return defaultValue;
  }

  return parsed;
}

/**
 * Minimum allowed TTL in seconds (1 second).
 */
const MIN_TTL_SECONDS = 1;

/**
 * Maximum allowed TTL in seconds (1 hour).
 */
const MAX_TTL_SECONDS = 3600;

/**
 * Minimum allowed cache entries (1).
 */
const MIN_MAX_ENTRIES = 1;

/**
 * Maximum allowed cache entries (10000).
 */
const MAX_MAX_ENTRIES = 10000;

/**
 * Safely parses a positive integer from an environment variable value.
 * Clamps the value to [min, max] and falls back to default on invalid input.
 * Protects against NaN, Infinity, and non-numeric values.
 *
 * @param {string|undefined} raw - Raw environment variable value.
 * @param {number} min - Minimum allowed value (inclusive).
 * @param {number} max - Maximum allowed value (inclusive).
 * @param {number} fallback - Default value when parsing fails.
 * @returns {number} Parsed and clamped integer.
 */
function parsePositiveInt(raw, min, max, fallback) {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  
  const parsed = Number.parseInt(String(raw), 10);
  
  // Check for NaN and Infinity
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  
  // Clamp to bounds
  if (parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
  }
  
  return parsed;
}

/**
 * Validates one cache setting.
 *
 * @description Reads a complete positive integer without coercing objects or invoking getters.
 * Missing values use defaults; malformed, unsafe or out-of-range values are rejected as a whole.
 * @param {Record<string, unknown>} env - Environment snapshot.
 * @param {string} field - Allowlisted setting name.
 * @param {number} fallback - Default positive integer.
 * @param {number} maximum - Largest permitted integer.
 * @param {((field: string, fallback: number) => void)|undefined} onInvalid - Optional diagnostic sink.
 * @returns {number} Validated value or its default.
 */
function readPositiveInteger(env, field, fallback, maximum, onInvalid) {
  const descriptor = Object.getOwnPropertyDescriptor(env, field);
  if (!descriptor || ('value' in descriptor && descriptor.value === undefined)) {
    return fallback;
  }
  const raw = descriptor.value;
  const text = typeof raw === 'string' ? raw.trim() : '';
  const value = typeof raw === 'number' ? raw : /^\d+$/.test(text) ? Number(text) : NaN;
  if (Number.isSafeInteger(value) && value > 0 && value <= maximum) {
    return value;
  }
  // Never report the raw value: even an invalid cache setting may contain a secret.
  if (onInvalid) {
    onInvalid(field, fallback);
  }
  return fallback;
}

/**
 * Creates an isolated cache configuration snapshot.
 *
 * @description Parses immutable cache settings. Each call produces a new snapshot without
 * mutating the environment or shared state, so retries and concurrent callers cannot change
 * another consumer's cache bounds. Only own data properties supply settings; inherited values
 * and accessors cannot override defaults. Invalid individual settings retain safe defaults.
 * @param {Record<string, unknown>} [env=process.env] - Environment values to read.
 * @param {object} [options] - Optional diagnostics for rejected settings.
 * @param {(field: string, fallback: number) => void} [options.onInvalid] - Receives only a setting name and safe default.
 * @returns {Readonly<{escrowTtl: number, escrowMaxEntries: number, invoiceStateTtl: number, invoiceStateMaxEntries: number, indexerTtl: number, indexerMaxEntries: number}>} Positive bounded TTLs in milliseconds and safe integer capacities.
 */
function parseCacheConfig(env = process.env, { onInvalid } = {}) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('Cache environment must be an object');
  }
  if (onInvalid !== undefined && typeof onInvalid !== 'function') {
    throw new TypeError('Cache diagnostic sink must be a function');
  }
  return Object.freeze({
    escrowTtl:
      readPositiveInteger(env, 'ESCROW_CACHE_TTL_SECONDS', 30, MAX_TTL_SECONDS, onInvalid) * 1000,
    escrowMaxEntries: readPositiveInteger(
      env,
      'ESCROW_CACHE_MAX_ENTRIES',
      DEFAULT_ESCROW_MAX_ENTRIES,
      Number.MAX_SAFE_INTEGER,
      onInvalid,
    ),
    invoiceStateTtl:
      readPositiveInteger(env, 'INVOICE_STATE_CACHE_TTL_SECONDS', 30, MAX_TTL_SECONDS, onInvalid) *
      1000,
    invoiceStateMaxEntries: readPositiveInteger(
      env,
      'INVOICE_STATE_CACHE_MAX_ENTRIES',
      500,
      Number.MAX_SAFE_INTEGER,
      onInvalid,
    ),
    indexerTtl:
      readPositiveInteger(env, 'INDEXER_CACHE_TTL_SECONDS', 10, MAX_TTL_SECONDS, onInvalid) * 1000,
    indexerMaxEntries: readPositiveInteger(
      env,
      'INDEXER_CACHE_MAX_ENTRIES',
      200,
      Number.MAX_SAFE_INTEGER,
      onInvalid,
    ),
  });
}

// Diagnose invalid startup settings once. Pure parse calls stay silent unless a sink is supplied.
const cacheConfig = parseCacheConfig(process.env, {
  onInvalid: (field, fallback) =>
    process.emitWarning(`Invalid ${field}; using default ${fallback}`, {
      code: 'CACHE_CONFIG_INVALID_VALUE',
    }),
});

module.exports = {
  cacheConfig,
  parseCacheConfig,
  parsePositiveInt,
  DEFAULT_ESCROW_TTL_SECONDS,
  DEFAULT_ESCROW_MAX_ENTRIES,
  MIN_TTL_SECONDS,
  MAX_TTL_SECONDS,
  MIN_MAX_ENTRIES,
  MAX_MAX_ENTRIES,
};
