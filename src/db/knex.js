'use strict';

/**
 * @file src/db/knex.js
 * @description Knex connection factory with validation boundaries.
 *
 * Connection selection rules
 * --------------------------
 * - NODE_ENV=test       → always uses the `test` config block (in-memory SQLite).
 *                         Never falls back to development or production config.
 * - NODE_ENV=production → uses the `production` config block. Throws if the
 *                         `DATABASE_URL` env var is absent.
 * - anything else       → uses the `development` config block.
 *
 * Pool error handling
 * -------------------
 * Knex exposes pool-level events through the underlying `tarn` pool. We attach
 * `createTimeoutMillis` / `acquireTimeoutMillis` at the config level and log
 * pool errors so they surface in application logs without crashing the process.
 *
 * Validation boundaries
 * --------------------
 * - Config structure is validated before knex() instantiation
 * - Pool configuration values are bounded (min/max/timeout ranges)
 * - Post-creation instance validation ensures the connection is usable
 * - Invalid or malformed configs throw explicit, deterministic errors
 *
 * Test mock
 * ---------
 * Jest resolves `src/db/__mocks__/knex.js` automatically when
 * `jest.mock('../../src/db/knex')` is called, so this file is never executed
 * during unit tests that use the manual mock.
 *
 * Config selection logic
 * ----------------------
 * The config-selection logic lives in `src/db/resolveConfig.js` so it can be
 * unit-tested independently without loading knex or pino.
 *
 * @module src/db/knex
 */

const knex = require('knex');
const logger = require('../logger');
const resolveConfig = require('./resolveConfig');

/** @type {string} */
const env = process.env.NODE_ENV || 'development';

/**
 * Validates that the environment string is one of the allowed values.
 *
 * @param {string} environment - The environment to validate.
 * @throws {Error} If the environment is not a non-empty string.
 * @returns {void}
 */
function validateEnvironment(environment) {
  if (typeof environment !== 'string' || environment.trim().length === 0) {
    throw new Error(
      '[db] NODE_ENV must be a non-empty string. Received: ' + JSON.stringify(environment)
    );
  }
}

/**
 * Validates the structure of a Knex config object.
 *
 * Ensures the config has required fields and valid types before passing to knex().
 *
 * @param {object} config - The config object to validate.
 * @throws {Error} If the config is invalid or malformed.
 * @returns {void}
 */
function validateConfigStructure(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('[db] Config must be a non-null object.');
  }

  if (typeof config.client !== 'string' || config.client.trim().length === 0) {
    throw new Error('[db] Config.client must be a non-empty string.');
  }

  if (!config.connection || typeof config.connection !== 'object') {
    throw new Error('[db] Config.connection must be a non-null object.');
  }
}

/**
 * Validates pool configuration values are within acceptable boundaries.
 *
 * @param {object} pool - The pool configuration to validate.
 * @throws {Error} If pool values are out of bounds or invalid.
 * @returns {void}
 */
function validatePoolConfig(pool) {
  if (!pool || typeof pool !== 'object') {
    return; // No pool config is valid (uses defaults)
  }

  if (pool.min !== undefined) {
    if (typeof pool.min !== 'number' || pool.min < 0 || !Number.isInteger(pool.min)) {
      throw new Error('[db] Pool.min must be a non-negative integer.');
    }
  }

  if (pool.max !== undefined) {
    if (typeof pool.max !== 'number' || pool.max < 1 || !Number.isInteger(pool.max)) {
      throw new Error('[db] Pool.max must be a positive integer.');
    }
  }

  if (pool.min !== undefined && pool.max !== undefined && pool.min > pool.max) {
    throw new Error('[db] Pool.min cannot be greater than Pool.max.');
  }

  const timeoutFields = [
    'createTimeoutMillis',
    'acquireTimeoutMillis',
    'idleTimeoutMillis',
    'reapIntervalMillis',
    'createRetryIntervalMillis',
  ];

  for (const field of timeoutFields) {
    if (pool[field] !== undefined) {
      if (typeof pool[field] !== 'number' || pool[field] < 0 || !Number.isInteger(pool[field])) {
        throw new Error(`[db] Pool.${field} must be a non-negative integer.`);
      }
    }
  }
}

/**
 * Attach pool-level error and connection-acquisition logging to a Knex
 * instance. Errors are caught here so unhandled promise rejections do not
 * propagate out of the pool layer.
 *
 * @param {import('knex').Knex} instance - The initialised Knex instance.
 * @returns {void}
 */
function attachPoolErrorHandlers(instance) {
  // `instance.client.pool` is exposed by tarn (the pool library knex uses).
  const pool = instance.client && instance.client.pool;
  if (!pool) { return; }

  pool.on('createFail', (eventId, err) => {
    logger.error({ err, eventId }, '[db] Pool: failed to create connection');
  });

  pool.on('acquireFail', (eventId, err) => {
    logger.error({ err, eventId }, '[db] Pool: failed to acquire connection');
  });

  pool.on('destroyFail', (eventId, err) => {
    logger.warn({ err, eventId }, '[db] Pool: failed to destroy connection');
  });
}

/**
 * Default pool configuration applied to every environment unless the config
 * block already specifies a `pool` key.
 *
 * @type {import('knex').Knex.PoolConfig}
 */
const DEFAULT_POOL = {
  min: 2,
  max: 10,
  /** Milliseconds to wait for a new connection to be created before erroring. */
  createTimeoutMillis: 30_000,
  /** Milliseconds to wait to acquire a connection from the pool before erroring. */
  acquireTimeoutMillis: 30_000,
  /** Milliseconds a connection may sit idle before being destroyed. */
  idleTimeoutMillis: 600_000,
  /** Milliseconds between reaping idle connections. */
  reapIntervalMillis: 1_000,
  /** How many times to retry creating a connection on transient failure. */
  createRetryIntervalMillis: 200,
};

validateEnvironment(env);
const config = resolveConfig(env);
validateConfigStructure(config);

validatePoolConfig(config.pool);

const mergedConfig = {
  ...config,
  pool: { ...DEFAULT_POOL, ...(config.pool || {}) },
};

validatePoolConfig(mergedConfig.pool);

/**
 * Validates that the Knex instance is properly initialized and usable.
 *
 * @param {import('knex').Knex} instance - The Knex instance to validate.
 * @throws {Error} If the instance is invalid or unusable.
 * @returns {void}
 */
function validateKnexInstance(instance) {
  if (!instance || typeof instance !== 'function') {
    throw new Error('[db] Knex instance must be a callable function.');
  }

  if (!instance.client || typeof instance.client !== 'object') {
    throw new Error('[db] Knex instance must have a client property.');
  }

  // Verify the instance has the expected query-builder methods
  const requiredMethods = ['select', 'where', 'insert', 'update', 'delete', 'transaction'];
  for (const method of requiredMethods) {
    if (typeof instance[method] !== 'function') {
      throw new Error(`[db] Knex instance must have a ${method} method.`);
    }
  }
}

/**
 * Singleton Knex database instance for the current environment.
 * Subsequent `require` calls return the cached export.
 *
 * @type {import('knex').Knex}
 */
const db = knex(mergedConfig);

validateKnexInstance(db);
attachPoolErrorHandlers(db);

module.exports = db;
