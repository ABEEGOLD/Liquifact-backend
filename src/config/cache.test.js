'use strict';

describe('cacheConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.spyOn(process, 'emitWarning').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
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
    expect(process.emitWarning).toHaveBeenCalledWith(
      'Invalid ESCROW_CACHE_TTL_SECONDS; using default 30',
      { code: 'CACHE_CONFIG_INVALID_VALUE' },
    );
  });

  const settings = [
    ['ESCROW_CACHE_TTL_SECONDS', 'escrowTtl', 30000, 1000],
    ['ESCROW_CACHE_MAX_ENTRIES', 'escrowMaxEntries', 500, 1],
    ['INVOICE_STATE_CACHE_TTL_SECONDS', 'invoiceStateTtl', 30000, 1000],
    ['INVOICE_STATE_CACHE_MAX_ENTRIES', 'invoiceStateMaxEntries', 500, 1],
    ['INDEXER_CACHE_TTL_SECONDS', 'indexerTtl', 10000, 1000],
    ['INDEXER_CACHE_MAX_ENTRIES', 'indexerMaxEntries', 200, 1],
  ];

  describe.each(settings)('%s invariants', (field, property, fallback, multiplier) => {
    it.each(['2', ' 002 ', 2])('accepts complete positive integers: %j', (value) => {
      const { parseCacheConfig } = require('./cache');
      expect(parseCacheConfig({ [field]: value })[property]).toBe(2 * multiplier);
    });

    it.each([
      '0',
      '-1',
      '1.5',
      '1e3',
      '0x10',
      '30seconds',
      '',
      ' ',
      'Infinity',
      '9007199254740992',
      null,
      false,
      ['2'],
      {},
      0,
      -1,
      1.5,
      NaN,
      Infinity,
    ])('rejects malformed or unsafe input as a whole: %j', (value) => {
      const { parseCacheConfig } = require('./cache');
      const onInvalid = jest.fn();
      const snapshot = parseCacheConfig({ [field]: value }, { onInvalid });
      expect(snapshot[property]).toBe(fallback);
      expect(onInvalid).toHaveBeenCalledWith(field, fallback / multiplier);
      for (const numeric of Object.values(snapshot)) {
        expect(Number.isSafeInteger(numeric) && numeric > 0).toBe(true);
      }
    });

    it('uses defaults for missing and inherited values without invoking getters', () => {
      const { parseCacheConfig } = require('./cache');
      const getter = jest.fn(() => '2');
      const env = Object.create({ [field]: '2' });
      expect(parseCacheConfig(env)[property]).toBe(fallback);
      Object.defineProperty(env, field, { get: getter });
      expect(parseCacheConfig(env)[property]).toBe(fallback);
      expect(getter).not.toHaveBeenCalled();
      expect(parseCacheConfig({ [field]: undefined })[property]).toBe(fallback);
    });

    it('accepts its upper bound and rejects the next value', () => {
      const { parseCacheConfig } = require('./cache');
      const max = multiplier === 1000 ? Math.floor(0x7fffffff / 1000) : Number.MAX_SAFE_INTEGER;
      expect(parseCacheConfig({ [field]: String(max) })[property]).toBe(max * multiplier);
      expect(parseCacheConfig({ [field]: String(max + 1) })[property]).toBe(fallback);
    });
  });

  it('does not coerce objects or alter the supplied environment', () => {
    const { parseCacheConfig } = require('./cache');
    const toString = jest.fn(() => '2');
    const env = Object.freeze({ ESCROW_CACHE_TTL_SECONDS: { toString } });
    expect(parseCacheConfig(env).escrowTtl).toBe(30000);
    expect(toString).not.toHaveBeenCalled();
    expect(env.ESCROW_CACHE_TTL_SECONDS.toString).toBe(toString);
  });

  it.each([null, false, 2, '2', []])('rejects an invalid environment map: %j', (env) => {
    const { parseCacheConfig } = require('./cache');
    expect(() => parseCacheConfig(env)).toThrow('Cache environment must be an object');
  });

  it('validates the diagnostics sink and preserves shared state if it throws', () => {
    const { parseCacheConfig, cacheConfig } = require('./cache');
    const before = { ...cacheConfig };
    expect(() => parseCacheConfig({}, { onInvalid: true })).toThrow(TypeError);
    expect(() =>
      parseCacheConfig(
        { INDEXER_CACHE_TTL_SECONDS: 'bad' },
        {
          onInvalid: () => {
            throw new Error('diagnostic unavailable');
          },
        },
      ),
    ).toThrow('diagnostic unavailable');
    expect(cacheConfig).toEqual(before);
    expect(parseCacheConfig({}).indexerTtl).toBe(10000);
  });

  it('keeps snapshots immutable and independent through repeated and interleaved calls', async () => {
    const { parseCacheConfig, cacheConfig } = require('./cache');
    const env = { ESCROW_CACHE_MAX_ENTRIES: '2' };
    const first = parseCacheConfig(env);
    expect(() => {
      first.escrowMaxEntries = 0;
    }).toThrow(TypeError);
    expect(() => {
      cacheConfig.indexerMaxEntries = 0;
    }).toThrow(TypeError);
    env.ESCROW_CACHE_MAX_ENTRIES = '3';
    const snapshots = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve().then(() => parseCacheConfig(env))),
    );
    expect(first.escrowMaxEntries).toBe(2);
    for (const snapshot of snapshots) {
      expect(snapshot.escrowMaxEntries).toBe(3);
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(snapshot).not.toBe(first);
    }
    expect(parseCacheConfig(env)).toEqual(snapshots[0]);
    expect(cacheConfig.indexerMaxEntries).toBe(200);
  });

  it('reports only allowlisted names and defaults, without exposing raw values', () => {
    const { parseCacheConfig } = require('./cache');
    const onInvalid = jest.fn();
    parseCacheConfig(
      { ESCROW_CACHE_TTL_SECONDS: 'token-private-value', PRIVATE_TOKEN: 'secret' },
      { onInvalid },
    );
    expect(onInvalid.mock.calls).toEqual([['ESCROW_CACHE_TTL_SECONDS', 30]]);
  });

  it('warns once at module load and keeps subsequent default parses silent', () => {
    process.env.INDEXER_CACHE_MAX_ENTRIES = 'bad-sensitive-value';
    const { cacheConfig, parseCacheConfig } = require('./cache');
    expect(cacheConfig.indexerMaxEntries).toBe(200);
    const calls = process.emitWarning.mock.calls.length;
    parseCacheConfig();
    parseCacheConfig();
    expect(process.emitWarning).toHaveBeenCalledTimes(calls);
    expect(JSON.stringify(process.emitWarning.mock.calls)).not.toContain('bad-sensitive-value');
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
