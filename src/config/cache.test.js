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
});
