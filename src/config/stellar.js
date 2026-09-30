const config = require('./index');

const NETWORK_RPC_MAP = Object.freeze({
  TESTNET: 'https://soroban-testnet.stellar.org',
  MAINNET: 'https://soroban.stellar.org',
  FUTURENET: 'https://rpc-futurenet.stellar.org',
});

const NETWORK_PASSPHRASE_MAP = Object.freeze({
  TESTNET: 'Test SDF Network ; September 2015',
  MAINNET: 'Public Global Stellar Network ; September 2014',
  FUTURENET: 'Test SDF Future Network ; October 2022',
});

const VALID_NETWORKS = Object.freeze(Object.keys(NETWORK_RPC_MAP));

function isKnownNetwork(network) {
  return typeof network === 'string' &&
    Object.prototype.hasOwnProperty.call(NETWORK_RPC_MAP, network);
}

/**
 * Return the passphrase for a supported Stellar network.
 * @param {string} network
 * @returns {string}
 */
function getNetworkPassphrase(network) {
  if (!isKnownNetwork(network)) {
    throw new Error(`Unknown network: ${network}`);
  }
  return NETWORK_PASSPHRASE_MAP[network];
}

/**
 * Return the canonical Soroban RPC URL for a supported Stellar network.
 * @param {string} network
 * @returns {string}
 */
function getExpectedRpc(network) {
  if (!isKnownNetwork(network)) {
    throw new Error(`Unknown network: ${network}`);
  }
  return NETWORK_RPC_MAP[network];
}

/**
 * Validate the Stellar network and its RPC/passphrase pairing.
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {{network: string, rpcUrl: string, passphrase: string}}
 */
function validateStellarConfig(env = process.env) {
  const network = env.STELLAR_NETWORK;
  if (typeof network !== 'string' || network.length === 0) {
    throw new Error('STELLAR_NETWORK is required');
  }
  if (!isKnownNetwork(network)) {
    throw new Error(`Invalid STELLAR_NETWORK: expected one of ${VALID_NETWORKS.join(', ')}`);
  }

  const rpcUrl = env.SOROBAN_RPC_URL;
  if (typeof rpcUrl !== 'string' || rpcUrl.length === 0) {
    throw new Error('SOROBAN_RPC_URL is required');
  }

  const expectedRpc = getExpectedRpc(network);
  if (rpcUrl !== expectedRpc) {
    throw new Error(
      `STELLAR_NETWORK=${network} requires SOROBAN_RPC_URL="${expectedRpc}" (Mismatch).`
    );
  }

  const passphrase = getNetworkPassphrase(network);
  if (env.STELLAR_NETWORK_PASSPHRASE !== undefined &&
      env.STELLAR_NETWORK_PASSPHRASE !== passphrase) {
    throw new Error('STELLAR_NETWORK_PASSPHRASE does not match STELLAR_NETWORK');
  }

  return { network, rpcUrl, passphrase };
}

/**
 * Get Stellar-specific configuration.
 * Ensures fail-fast behavior if config wasn't validated on boot.
 * @returns {Object} The Stellar configuration object.
 */
function getStellarConfig() {
  config.get();
  const { rpcUrl, passphrase } = validateStellarConfig();
  return {
    rpcUrl,
    networkPassphrase: passphrase,
  };
}

module.exports = {
  getStellarConfig,
  validateStellarConfig,
  getNetworkPassphrase,
  getExpectedRpc,
  VALID_NETWORKS,
  NETWORK_RPC_MAP,
  NETWORK_PASSPHRASE_MAP,
};