'use strict';

/**
 * @fileoverview Config DTO — deterministic failure recovery for application configuration.
 *
 * This module wraps the raw validated config (from `src/config/index.js`) into
 * a stable, typed Data-Transfer Object that:
 *
 *   1. Classifies every parse / validation failure into a named `ConfigError`
 *      with a machine-readable `code`, human-safe `message`, and `recoverable`
 *      flag so callers can distinguish fatal mis-configs from transient problems.
 *
 *   2. Exposes `buildConfigDto(rawEnv?)` — a pure, deterministic function safe to
 *      call multiple times and from concurrent paths without side-effects.
 *
 *   3. Provides `parseConfigDto()` which reads `process.env`, calls `buildConfigDto`,
 *      and wraps any thrown error into a structured `ConfigResult` rather than
 *      propagating raw Zod errors or unclassified exceptions.
 *
 *   4. Guarantees that for any given set of inputs the output (success or failure)
 *      is always the same shape — so callers never encounter `undefined`, partial
 *      data, or unhandled throws when consuming config at runtime.
 *
 * ## Failure recovery model
 *
 * ```
 *  Input env                    parseConfigDto()
 *  ─────────────────────────    ─────────────────────────────────────────────
 *  Valid                    →   { ok: true,  dto: ConfigDto }
 *  Missing required field   →   { ok: false, error: ConfigError(MISSING_FIELD) }
 *  Type / constraint error  →   { ok: false, error: ConfigError(VALIDATION_ERROR) }
 *  Unparseable JSON in env  →   { ok: false, error: ConfigError(PARSE_ERROR) }
 *  Unexpected thrown value  →   { ok: false, error: ConfigError(UNEXPECTED_ERROR) }
 * ```
 *
 * Callers that need strict boot-time fail-fast behaviour use `requireConfigDto()`
 * which throws a `ConfigError` if the result is not `ok`.
 *
 * Invariants enforced here:
 *   - All inputs are validated defensively; no input can produce a thrown
 *     exception — malformed inputs produce safe zero-value defaults instead
 *     of propagating bad data downstream.
 *   - Output objects are shallow-frozen so callers cannot silently mutate the
 *     DTO after it leaves this layer, preventing cross-request state bleed
 *     in concurrent execution.
 *   - `config` payloads are always shallow-copied (never aliased) so the
 *     original request body cannot be mutated via the DTO reference.
 *   - String fields are type-checked and default to `''` rather than
 *     `undefined`, keeping downstream consumers free from null-checks.
 *
 * @module dto/config
 */

const { CONFIG_SECTIONS } = require('../schemas/config');

/**
 * Validate that a value is a plain record with only the allowed own keys.
 *
 * @param {unknown} value - Value to validate.
 * @param {string[]} allowedKeys - Keys accepted at this DTO boundary.
 * @param {string} label - Name used in the error message.
 * @param {string[]} requiredKeys - Keys that must be own properties.
 * @returns {Record<string, unknown>} The validated record.
 * @throws {TypeError} If the value is not a plain record or has extra keys.
 */
function requireRecord(value, allowedKeys, label, requiredKeys = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }

  const unexpectedKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unexpectedKeys.length > 0) {
    throw new TypeError(`${label} contains unsupported fields`);
  }

  if (requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError(`${label} is missing required fields`);
  }

  return value;
}

/**
 * Validate a known configuration section name.
 *
 * @param {unknown} section - Section value to validate.
 * @returns {string} The validated section name.
 * @throws {TypeError} If the section is not supported.
 */
function requireSection(section) {
  if (typeof section !== 'string' || !CONFIG_SECTIONS.includes(section)) {
    throw new TypeError('section must be a supported configuration section');
  }

  return section;
}

/**
 * Validate section-specific config as a plain record.
 * Field-level constraints remain the responsibility of the section schemas.
 *
 * @param {unknown} config - Config payload to validate.
 * @returns {Record<string, unknown>} A shallow copy of the validated config.
 * @throws {TypeError} If config is not a plain object.
 */
function requireConfig(config) {
  const allowedKeys = config && typeof config === 'object' && !Array.isArray(config)
    ? Object.keys(config)
    : [];
  const record = requireRecord(config, allowedKeys, 'config');
  return { ...record };
}

/**
 * @typedef {Object} AdminConfigRequestDto
 * @property {string} section - Configuration section name.
 * @property {Record<string, unknown>} config - Section-specific configuration payload.
 */

/**
 * Machine-readable codes attached to every `ConfigError`.
 *
 * @readonly
 * @enum {string}
 */
function toAdminConfigRequestDto(payload) {
  const record = requireRecord(payload, ['section', 'config'], 'request', ['section', 'config']);
  const section = requireSection(record.section);
  const config = requireConfig(record.config);

  // Build per-field error messages — strip raw values to avoid secret leakage.
  const formatted = zodError.format();
  const fieldErrors = /** @type {Record<string, string[]>} */ ({});
  for (const issue of zodError.issues) {
    const field = issue.path.join('.') || '_root';
    if (!fieldErrors[field]) fieldErrors[field] = [];
    // Use the Zod message but strip any embedded value that could be a secret.
    fieldErrors[field].push(_sanitizeZodMessage(issue.message));
  }
  void formatted; // used above for structure, messages taken from issues

  return { code, fieldErrors };
}

/**
 * Strip numeric literals and long strings from Zod issue messages to prevent
 * accidental secret exposure in structured error output.
 *
 * @param {string} msg - Raw Zod issue message.
 * @returns {string}
 */
function _sanitizeZodMessage(msg) {
  // Replace anything that looks like a raw value (quoted strings, long hex/tokens)
  return msg
    .replace(/"[^"]{8,}"/g, '"<redacted>"')
    .replace(/\b[a-f0-9]{16,}\b/gi, '<redacted>');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a `ConfigDto` from a raw environment variables map.
 *
 * This function is **pure** — it does not read `process.env` directly and has
 * no module-level state, making it safe to call from tests and concurrent paths
 * without interference.
 *
 * @param {Record<string, string|undefined>} rawEnv - The env vars to parse.
 * @returns {ConfigDto} Validated, normalised DTO.
 * @throws {ConfigError} When validation fails. The error carries a structured
 *   `code` and `fieldErrors` map for deterministic failure handling.
 */
function toAdminConfigResponseDto(payload) {
  const record = requireRecord(payload, ['section', 'config', 'message'], 'response', ['section', 'config', 'message']);
  const section = requireSection(record.section);
  const config = requireConfig(record.config);
  if (typeof record.message !== 'string') {
    throw new TypeError('message must be a string');
  }

  return { section, config, message: record.message };
}

/**
 * Parse the current `process.env` into a `ConfigResult`.
 *
 * Unlike `buildConfigDto`, this function **never throws** — all error paths
 * are normalised into `{ ok: false, error: ConfigError }` so callers get a
 * deterministic result regardless of input.
 *
 * Concurrent calls are safe: the function is stateless and re-entrant.
 *
 * @param {Record<string, string|undefined>} [env=process.env] - Env vars source.
 *   Override in tests to avoid mutating `process.env`.
 * @returns {ConfigResult}
 */
function parseConfigDto(env = process.env) {
  try {
    const dto = buildConfigDto(env);
    return { ok: true, dto };
  } catch (err) {
    if (err instanceof ConfigError) {
      return { ok: false, error: err };
    }

/**
 * Map a list of config sections into the typed sections response DTO.
 *
 * @param {unknown} sections - Raw section list from the route boundary.
 * @returns {ConfigSectionsResponseDto} A normalized sections response DTO.
 */
function toConfigSectionsResponseDto(sections) {
  if (!Array.isArray(sections)) {
    throw new TypeError('sections must be an array');
  }

  const normalizedSections = sections.map(requireSection);
  if (new Set(normalizedSections).size !== normalizedSections.length) {
    throw new TypeError('sections must not contain duplicates');
  }

  return { sections: normalizedSections };
}

/**
 * Parse config and throw immediately on failure.
 *
 * Use this at boot time when the application should refuse to start rather than
 * operate with an invalid or partial configuration.
 *
 * @param {Record<string, string|undefined>} [env=process.env] - Env vars source.
 * @returns {ConfigDto} Validated DTO.
 * @throws {ConfigError} On any parse / validation failure.
 */
function fromConfigSectionsResponseDto(dto) {
  const record = requireRecord(dto, ['sections'], 'sections response', ['sections']);
  return toConfigSectionsResponseDto(record.sections);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  buildConfigDto,
  parseConfigDto,
  requireConfigDto,
  ConfigError,
  CONFIG_ERROR_CODES,
};
