'use strict';

/**
 * @fileoverview Typed DTO helpers for admin config request/response boundaries.
 *
 * These helpers keep the route contract explicit without changing runtime
 * behavior. They map plain objects to/from a small typed DTO envelope that is
 * easier to evolve safely during refactors.
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
 * @typedef {Object} AdminConfigResponseDto
 * @property {string} section - Configuration section name.
 * @property {Record<string, unknown>} config - Accepted section payload.
 * @property {string} message - Human-readable success message.
 */

/**
 * @typedef {Object} ConfigSectionsResponseDto
 * @property {string[]} sections - Valid configuration section names.
 */

/**
 * Map a raw admin config request payload into a typed request DTO.
 *
 * @param {unknown} payload - Raw request payload from the route boundary.
 * @returns {AdminConfigRequestDto} A normalized request DTO.
 */
function toAdminConfigRequestDto(payload) {
  const record = requireRecord(payload, ['section', 'config'], 'request', ['section', 'config']);
  const section = requireSection(record.section);
  const config = requireConfig(record.config);

  return { section, config };
}

/**
 * Convert a typed admin config request DTO back to the route shape.
 *
 * @param {AdminConfigRequestDto} dto - Request DTO to normalize back to plain object form.
 * @returns {AdminConfigRequestDto} A request DTO with the same boundary shape.
 */
function fromAdminConfigRequestDto(dto) {
  return toAdminConfigRequestDto(dto);
}

/**
 * Map a raw admin config response payload into a typed response DTO.
 *
 * @param {unknown} payload - Raw response payload from the route boundary.
 * @returns {AdminConfigResponseDto} A normalized response DTO.
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
 * Convert a typed admin config response DTO back to the route shape.
 *
 * @param {AdminConfigResponseDto} dto - Response DTO to normalize back to plain object form.
 * @returns {AdminConfigResponseDto} A response DTO with the same boundary shape.
 */
function fromAdminConfigResponseDto(dto) {
  return toAdminConfigResponseDto(dto);
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
 * Convert a typed config sections response DTO back to the route shape.
 *
 * @param {ConfigSectionsResponseDto} dto - Sections DTO to normalize back to plain object form.
 * @returns {ConfigSectionsResponseDto} A sections DTO with the same boundary shape.
 */
function fromConfigSectionsResponseDto(dto) {
  const record = requireRecord(dto, ['sections'], 'sections response', ['sections']);
  return toConfigSectionsResponseDto(record.sections);
}

module.exports = {
  toAdminConfigRequestDto,
  fromAdminConfigRequestDto,
  toAdminConfigResponseDto,
  fromAdminConfigResponseDto,
  toConfigSectionsResponseDto,
  fromConfigSectionsResponseDto,
};
