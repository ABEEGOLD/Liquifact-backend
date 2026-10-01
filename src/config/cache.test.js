describe('cacheConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses default TTL of 30000ms when env var is not set', () => {
    delete process.env.ESCROW_CACHE_TTL_SECONDS;
    const { cacheConfig } = require('./cache');
    expect(cacheConfig.escrowTtl).toBe(30000);
    expect(cacheConfig.escrowMaxEntries).toBe(500);
  });

  it('parses ESCROW_CACHE_MAX_ENTRIES', () => {
    process.env.ESCROW_CACHE_MAX_ENTRIES = '25';
    const { cacheConfig } = require('./cache');
    expect(cacheConfig.escrowMaxEntries).toBe(25);
  });

  it('parses ESCROW_CACHE_TTL_SECONDS from env and converts to ms', () => {
    process.env.ESCROW_CACHE_TTL_SECONDS = '60';
    const { cacheConfig } = require('./cache');
    expect(cacheConfig.escrowTtl).toBe(60000);
  });

  it('falls back to default when env var is not a valid number', () => {
    process.env.ESCROW_CACHE_TTL_SECONDS = 'abc';
    const { cacheConfig } = require('./cache');
    expect(cacheConfig.escrowTtl).toBe(30000);
  });

  // ─── Input Validation ───────────────────────────────────────────────────

  describe('input validation', () => {
    it('handles null env var values', () => {
      process.env.ESCROW_CACHE_TTL_SECONDS = null;
      const { parseCacheConfig } = require('./cache');
      const config = parseCacheConfig();
      expect(config.escrowTtl).toBe(30000);
    });

    it('handles undefined env var values', () => {
      process.env.ESCROW_CACHE_TTL_SECONDS = undefined;
      const { parseCacheConfig } = require('./cache');
      const config = parseCacheConfig();
      expect(config.escrowTtl).toBe(30000);
    });

    it('handles empty string env var values', () => {
      process.env.ESCROW_CACHE_TTL_SECONDS = '';
      const { parseCacheConfig } = require('./cache');
      const config = parseCacheConfig();
      expect(config.escrowTtl).toBe(30000);
    });

    it('handles NaN values', () => {
      process.env.ESCROW_CACHE_TTL_SECONDS = 'NaN';
      const { parseCacheConfig } = require('./cache');
      const config = parseCacheConfig();
      expect(config.escrowTtl).toBe(30000);
    });

    it('handles Infinity values', () => {
      process.env.ESCROW_CACHE_TTL_SECONDS = 'Infinity';
      const { parseCacheConfig } = require('./cache');
      const config = parseCacheConfig();
      expect(config.escrowTtl).toBe(30000);
    });

    it('handles negative values', () => {
      process.env.ESCROW_CACHE_TTL_SECONDS = '-10';
      const { parseCacheConfig } = require('./cache');
      const config = parseCacheConfig();
      expect(config.escrowTtl).toBe(1000); // Clamped to MIN_TTL_SECONDS
    });

    it('handles zero values', () => {
      process.env.ESCROW_CACHE_TTL_SECONDS = '0';
      const { parseCacheConfig } = require('./cache');
      const config = parseCacheConfig();
      expect(config.escrowTtl).toBe(1000); // Clamped to MIN_TTL_SECONDS
    });

    it('handles floating point values (parses as int)', () => {
      process.env.ESCROW_CACHE_TTL_SECONDS = '45.7';
      const { parseCacheConfig } = require('./cache');
      const config = parseCacheConfig();
      expect(config.escrowTtl).toBe(45700); // parseInt truncates
    });

    it('handles scientific notation', () => {
      process.env.ESCROW_CACHE_TTL_SECONDS = '1e2';
      const { parseCacheConfig } = require('./cache');
      const config = parseCacheConfig();
      expect(config.escrowTtl).toBe(100000);
    });
  });

  // ─── Bounds Checking ─────────────────────────────────────────────────────

  describe('bounds checking', () => {
    it('clamps TTL to MIN_TTL_SECONDS when too low', () => {
      const { parseCacheConfig, MIN_TTL_SECONDS } = require('./cache');
      const config = parseCacheConfig({ ESCROW_CACHE_TTL_SECONDS: '0' });
      expect(config.escrowTtl).toBe(MIN_TTL_SECONDS * 1000);
    });

    it('clamps TTL to MAX_TTL_SECONDS when too high', () => {
      const { parseCacheConfig, MAX_TTL_SECONDS } = require('./cache');
      const config = parseCacheConfig({ ESCROW_CACHE_TTL_SECONDS: '99999' });
      expect(config.escrowTtl).toBe(MAX_TTL_SECONDS * 1000);
    });

    it('clamps maxEntries to MIN_MAX_ENTRIES when too low', () => {
      const { parseCacheConfig, MIN_MAX_ENTRIES } = require('./cache');
      const config = parseCacheConfig({ ESCROW_CACHE_MAX_ENTRIES: '0' });
      expect(config.escrowMaxEntries).toBe(MIN_MAX_ENTRIES);
    });

    it('clamps maxEntries to MAX_MAX_ENTRIES when too high', () => {
      const { parseCacheConfig, MAX_MAX_ENTRIES } = require('./cache');
      const config = parseCacheConfig({ ESCROW_CACHE_MAX_ENTRIES: '99999' });
      expect(config.escrowMaxEntries).toBe(MAX_MAX_ENTRIES);
    });

    it('accepts values at exact boundaries', () => {
      const { parseCacheConfig, MIN_TTL_SECONDS, MAX_TTL_SECONDS } = require('./cache');
      const config = parseCacheConfig({ ESCROW_CACHE_TTL_SECONDS: String(MIN_TTL_SECONDS) });
      expect(config.escrowTtl).toBe(MIN_TTL_SECONDS * 1000);

      const config2 = parseCacheConfig({ ESCROW_CACHE_TTL_SECONDS: String(MAX_TTL_SECONDS) });
      expect(config2.escrowTtl).toBe(MAX_TTL_SECONDS * 1000);
    });
  });

  // ─── Invoice State Cache Config ────────────────────────────────────────

  describe('invoice state cache config', () => {
    it('parses INVOICE_STATE_CACHE_TTL_SECONDS', () => {
      process.env.INVOICE_STATE_CACHE_TTL_SECONDS = '45';
      const { cacheConfig } = require('./cache');
      expect(cacheConfig.invoiceStateTtl).toBe(45000);
    });

    it('parses INVOICE_STATE_CACHE_MAX_ENTRIES', () => {
      process.env.INVOICE_STATE_CACHE_MAX_ENTRIES = '100';
      const { cacheConfig } = require('./cache');
      expect(cacheConfig.invoiceStateMaxEntries).toBe(100);
    });

    it('clamps invoice state TTL to bounds', () => {
      const { parseCacheConfig, MIN_TTL_SECONDS, MAX_TTL_SECONDS } = require('./cache');
      const config = parseCacheConfig({ INVOICE_STATE_CACHE_TTL_SECONDS: '0' });
      expect(config.invoiceStateTtl).toBe(MIN_TTL_SECONDS * 1000);

      const config2 = parseCacheConfig({ INVOICE_STATE_CACHE_TTL_SECONDS: '99999' });
      expect(config2.invoiceStateTtl).toBe(MAX_TTL_SECONDS * 1000);
    });
  });

  // ─── Indexer Cache Config ───────────────────────────────────────────────

  describe('indexer cache config', () => {
    it('parses INDEXER_CACHE_TTL_SECONDS', () => {
      process.env.INDEXER_CACHE_TTL_SECONDS = '15';
      const { cacheConfig } = require('./cache');
      expect(cacheConfig.indexerTtl).toBe(15000);
    });

    it('parses INDEXER_CACHE_MAX_ENTRIES', () => {
      process.env.INDEXER_CACHE_MAX_ENTRIES = '50';
      const { cacheConfig } = require('./cache');
      expect(cacheConfig.indexerMaxEntries).toBe(50);
    });

    it('clamps indexer TTL to bounds', () => {
      const { parseCacheConfig, MIN_TTL_SECONDS, MAX_TTL_SECONDS } = require('./cache');
      const config = parseCacheConfig({ INDEXER_CACHE_TTL_SECONDS: '0' });
      expect(config.indexerTtl).toBe(MIN_TTL_SECONDS * 1000);

      const config2 = parseCacheConfig({ INDEXER_CACHE_TTL_SECONDS: '99999' });
      expect(config2.indexerTtl).toBe(MAX_TTL_SECONDS * 1000);
    });
  });

  // ─── Boundary Cases ─────────────────────────────────────────────────────

  describe('boundary cases', () => {
    it('handles very large valid numbers', () => {
      const { parseCacheConfig, MAX_TTL_SECONDS } = require('./cache');
      const config = parseCacheConfig({ ESCROW_CACHE_TTL_SECONDS: String(MAX_TTL_SECONDS) });
      expect(config.escrowTtl).toBe(MAX_TTL_SECONDS * 1000);
    });

    it('handles very small valid numbers', () => {
      const { parseCacheConfig, MIN_TTL_SECONDS } = require('./cache');
      const config = parseCacheConfig({ ESCROW_CACHE_TTL_SECONDS: String(MIN_TTL_SECONDS) });
      expect(config.escrowTtl).toBe(MIN_TTL_SECONDS * 1000);
    });

    it('handles whitespace in values', () => {
      process.env.ESCROW_CACHE_TTL_SECONDS = '  60  ';
      const { parseCacheConfig } = require('./cache');
      const config = parseCacheConfig();
      expect(config.escrowTtl).toBe(60000);
    });

    it('handles hexadecimal strings (parses as 0)', () => {
      process.env.ESCROW_CACHE_TTL_SECONDS = '0x10';
      const { parseCacheConfig } = require('./cache');
      const config = parseCacheConfig();
      // parseInt with radix 10 will parse '0x10' as 0
      expect(config.escrowTtl).toBe(1000); // Falls back to MIN_TTL_SECONDS
    });
  });
});
