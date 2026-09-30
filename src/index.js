'use strict';

/**
 * Minimal entry-point shim.
 *
 * The original src/index.js was structurally invalid (duplicated bodies and
 * unbalanced braces) and broke both `node --check` and Jest parsing. To unblock
 * the CI pipeline this file now simply re-exports the working Express app
 * factory from ./app and provides a no-op startServer helper for the legacy
 * tests that reference it.
 */

require('dotenv').config();

const crypto = require('crypto');
const app = require('./app');
const { validate, logRedactedSummary } = require('./config');
const shutdownCoordinator = require('./utils/shutdownCoordinator');

/**
 * Module-level startup state guards to prevent concurrent/duplicate initialization.
 * @type {{ isServerStarted: boolean, serverInstance: import('http').Server|null, fencingTokens: Map<string, string> }}
 */
const startupState = {
  isServerStarted: false,
  serverInstance: null,
  fencingTokens: new Map(),
};

/**
 * Runs the S3 connectivity probe at startup. Failures are logged but never
 * block process start - the readiness probe (`/readyz`) surfaces storage
 * misconfiguration to orchestrators once the HTTP server is listening.
 *
 * @returns { Promise<void> }
 */
async function scheduleStartupStorageProbe() {
  try {
    const storage = require('./services/storage');
    await storage.runStartupStorageProbe();
  } catch (_err) {
    // Best-effort: a probe failure must not abort startup.
  }
}

/**
 * Validates the application configuration at startup before the server starts listening.
 * In test environment, the validation is skipped to preserve lazy loading behavior.
 * Fails fast by logging a redacted summary of errors and exiting with a non-zero code.
 * @returns { void }
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
 * Idempotent: if already started, returns the existing server instance.
 *
 * @returns {$import('http').Server} The HTTP server instance.
 */
function startServer() {
  if (startupState.isServerStarted && startupState.serverInstance) {
    console.warn('[index] startServer called multiple times; returning existing server instance');
    return startupState.serverInstance;
  }

  runBootConfigValidation();
  const port = process.env.PORT || 3001;
  // Fire-and-forget probe -- do not await, so startup is not blocked.
  scheduleStartupStorageProbe();
  const server = app.listen(port);
  
  startupState.isServerStarted = true;
  startupState.serverInstance = server;
  
  shutdownCoordinator.register({ server });
  shutdownCoordinator.setupSignalListeners();
  return server;
}

/**
 * Resets in-memory state (clears shared cache stores for test isolation).
 *
 * @returns { void }
 */
function resetStore() {
  try {
    const { getSharedStore } = require('./services/cacheStore');
    getSharedStore().clear();
  } catch (_) {
    // intentional no-op in environments where cacheStore is unavailable
  }

  try {
    const { getMetricsCacheStore } = require('./services/metricsCacheStore');
    getMetricsCacheStore().clear();
  } catch (_) {
    // intentional no-op in environments where metricsCacheStore is unavailable
  }
}

/**
 * Gets the fencing token for a specific worker type.
 * Used by workers to validate their lease fencing.
 *
 * @param {string} workerType - The worker type (e.g., 'idempotencyPurge', 'invoiceStatePurge')
 * @returns {string|undefined} The fencing token, or undefined if not set
 */
function getFencingToken(workerType) {
  return startupState.fencingTokens.get(workerType);
}

/**
 * Resets startup state for test isolation.
 * @private
 */
function _resetStartupState() {
  startupState.isServerStarted = false;
  startupState.serverInstance = null;
  startupState.fencingTokens.clear();
}

const originalCreateApp = app.createApp;

/**
 * Returns the underlying Express app factory.
 *
 * @returns { import('express').Express} Configured Express app.
 */
function createApp() {
  return typeof originalCreateApp === 'function' ? originalCreateApp() : app;
}

// Start background workers when running as main module (not in tests)
if (process.env.NODE_ENV !== 'test' && require.main === module) {
  // Generate and store fencing tokens for lease fencing
  const idempotencyFencingToken = crypto.randomUUID();
  const invoiceStateFencingToken = crypto.randomUUID();
  
  startupState.fencingTokens.set('idempotencyPurge', idempotencyFencingToken);
  startupState.fencingTokens.set('invoiceStatePurge', invoiceStateFencingToken);

  // Start the idempotency purge worker with a fresh fencing token so that stale
  // workers from a previous process can no longer write after lease loss.
  const { startPurgeWorker } = require('./jobs/idempotencyPurge');
  startPurgeWorker({ fencingToken: idempotencyFencingToken });

  // Start the invoice-state retention purge worker (issue #866) with its own
  // fencing token, isolated from the idempotency worker's token.
  const { startPurgeWorker: startInvoiceStatePurgeWorker } = require('./jobs/invoiceStatePurge');
  startInvoiceStatePurgeWorker({ fencingToken: invoiceStateFencingToken });

  startServer();
}

module.exports = app;
module.exports.createApp = createApp;
module.exports.startServer = startServer;
module.exports.resetStore = resetStore;
module.exports.getFencingToken = getFencingToken;
module.exports._resetStartupState = _resetStartupState;
