'use strict';

/**
 * @fileoverview Entry point for the LiquiFact API server.
 *
 * This module provides the main entry point for the application and exports
 * compatibility contracts used by tests and external consumers. All public
 * APIs are documented with explicit contracts for input validation, error
 * handling, and return types.
 *
 * @module index
 */

require('dotenv').config();

const crypto = require('crypto');
const app = require('./app');
const { validate, logRedactedSummary } = require('./config');
const shutdownCoordinator = require('./utils/shutdownCoordinator');

/**
 * Runs the S3 connectivity probe at startup. Failures are logged but never
 * block process start - the readiness probe (`/readyz`) surfaces storage
 * misconfiguration to orchestrators once the HTTP server is listening.
 *
 * @returns {Promise<void>} Resolves when probe completes or fails silently.
 * @throws {Error} Never throws - all errors are caught and logged internally.
 */
async function scheduleStartupStorageProbe() {
  try {
    const storage = require('./services/storage');
    await storage.runStartupStorageProbe();
  } catch (err) {
    // Best-effort: a probe failure must not abort startup.
    // Log for observability without blocking startup.
    const logger = require('./logger');
    logger.warn({ err }, 'Startup storage probe failed (non-blocking)');
  }
}

/**
 * Validates the application configuration at startup before the server starts listening.
 * In test environment, the validation is skipped to preserve lazy loading behavior.
 * Fails fast by logging a redacted summary of errors and exiting with a non-zero code.
 *
 * @returns {void}
 * @throws {Error} Never throws in production - exits process on validation failure.
 *                    In test environment, returns silently without validation.
 */
function runBootConfigValidation() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    validate();
    
    // Boot-time dependency validation phase
    const { validateDependencies } = require('./config/dependencyValidator');
    validateDependencies();
  } catch (error) {
    logRedactedSummary(error);
    process.exit(1);
  }
}

/**
 * Starts the HTTP server on the configured port.
 *
 * Performs boot-time configuration validation, schedules a non-blocking storage
 * connectivity probe, registers the server with the shutdown coordinator, and sets
 * up signal listeners for graceful shutdown.
 *
 * @param {number} [port] - Optional port override. If not provided, uses PORT
 *                          environment variable or defaults to 3001.
 * @returns {import('http').Server} The HTTP server instance.
 * @throws {Error} May throw if server fails to bind to the specified port.
 *                   Configuration validation failures exit the process instead of throwing.
 */
function startServer(port) {
  runBootConfigValidation();
  const serverPort = port !== undefined ? port : process.env.PORT || 3001;
  // Fire-and-forget probe -- do not await, so startup is not blocked.
  scheduleStartupStorageProbe();
  const server = app.listen(serverPort);
  shutdownCoordinator.register({ server });
  shutdownCoordinator.setupSignalListeners();
  return server;
}

/**
 * Resets in-memory state by clearing shared cache stores for test isolation.
 *
 * This function safely clears both the main cache store and metrics cache store.
 * If either store is unavailable (e.g., in environments where the modules are not
 * loaded), the function continues silently to ensure test isolation without
 * breaking tests that don't require these stores.
 *
 * @returns {void}
 * @throws {Error} Never throws - all errors are caught and logged for observability.
 */
function resetStore() {
  const logger = require('./logger');
  
  try {
    const { getSharedStore } = require('./services/cacheStore');
    getSharedStore().clear();
  } catch (err) {
    // intentional no-op in environments where cacheStore is unavailable
    logger.debug({ err }, 'cacheStore clear failed (store unavailable)');
  }

  try {
    const { getMetricsCacheStore } = require('./services/metricsCacheStore');
    getMetricsCacheStore().clear();
  } catch (err) {
    // intentional no-op in environments where metricsCacheStore is unavailable
    logger.debug({ err }, 'metricsCacheStore clear failed (store unavailable)');
  }
}

const originalCreateApp = app.createApp;

/**
 * Returns the underlying Express app factory.
 *
 * This function provides a compatibility contract for tests and external consumers
 * that need to create fresh Express app instances. Options are forwarded to the
 * underlying app factory if it exists.
 *
 * @param {Object} [options] - Optional configuration options for the app factory.
 * @param {boolean} [options.enableTestRoutes] - If true, enables test-only routes.
 * @returns {import('express').Express} Configured Express app instance.
 * @throws {Error} May throw if the underlying app factory fails to initialize.
 */
function createApp(options) {
  if (typeof originalCreateApp === 'function') {
    return originalCreateApp(options);
  }
  return app;
}

// Start background workers when running as main module (not in tests)
if (process.env.NODE_ENV !== 'test' && require.main === module) {
  // Start the idempotency purge worker with a fresh fencing token so that stale
  // workers from a previous process can no longer write after lease loss.
  const { startPurgeWorker } = require('./jobs/idempotencyPurge');
  startPurgeWorker({ fencingToken: crypto.randomUUID() });

  // Start the invoice-state retention purge worker (issue #866) with its own
  // fencing token, isolated from the idempotency worker's token.
  const { startPurgeWorker: startInvoiceStatePurgeWorker } = require('./jobs/invoiceStatePurge');
  startInvoiceStatePurgeWorker({ fencingToken: crypto.randomUUID() });

  startServer();
}

/**
 * @module index
 * @description Entry point for the LiquiFact API server.
 *
 * @property {import('express').Express} default - The Express app instance.
 * @property {Function} createApp - Factory function to create Express app instances.
 * @property {Function} startServer - Function to start the HTTP server.
 * @property {Function} resetStore - Function to clear in-memory cache stores.
 */

module.exports = app;
module.exports.createApp = createApp;
module.exports.startServer = startServer;
module.exports.resetStore = resetStore;
