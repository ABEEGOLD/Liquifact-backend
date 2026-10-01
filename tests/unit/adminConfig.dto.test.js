'use strict';

const {
  toAdminConfigRequestDto,
  fromAdminConfigRequestDto,
  toAdminConfigResponseDto,
  fromAdminConfigResponseDto,
  toConfigSectionsResponseDto,
  fromConfigSectionsResponseDto,
} = require('../../src/dto/config');
const { CONFIG_SECTIONS } = require('../../src/schemas/config');

describe('admin config DTO mapping', () => {
  it('round-trips admin config request payloads through the request DTO layer', () => {
    const payload = {
      section: 'cors',
      config: {
        origins: ['https://app.example.com'],
        maxAge: 600,
      },
    };

    const dto = toAdminConfigRequestDto(payload);
    expect(dto).toEqual(payload);
    expect(fromAdminConfigRequestDto(dto)).toEqual(payload);
  });

  it('preserves missing optional fields when mapping request DTOs', () => {
    const payload = {
      section: 'webhook',
      config: {
        url: 'https://hooks.example.com/receive',
        secret: '0123456789abcdef',
        events: ['invoice.created'],
      },
    };

    const dto = toAdminConfigRequestDto(payload);
    expect(dto.config).toEqual(payload.config);
    expect(dto.config.enabled).toBeUndefined();
    expect(dto.config.maxRetries).toBeUndefined();
    expect(fromAdminConfigRequestDto(dto)).toEqual(payload);
  });

  it('round-trips admin config response payloads through the response DTO layer', () => {
    const payload = {
      section: 'reconciliation',
      config: {
        batchSize: 25,
        enabled: true,
      },
      message: 'Configuration section \'reconciliation\' validated and accepted.',
    };

    const dto = toAdminConfigResponseDto(payload);
    expect(dto).toEqual(payload);
    expect(fromAdminConfigResponseDto(dto)).toEqual(payload);
  });

  it('round-trips config section list payloads through the section DTO layer', () => {
    const payload = { sections: ['webhook', 'cors'] };

    const dto = toConfigSectionsResponseDto(payload.sections);
    expect(dto).toEqual(payload);
    expect(fromConfigSectionsResponseDto(dto)).toEqual(payload);
  });

  it('rejects malformed request envelopes instead of normalizing them to defaults', () => {
    expect(() => toAdminConfigRequestDto(null)).toThrow(TypeError);
    expect(() => toAdminConfigRequestDto({ section: 'cors' })).toThrow(TypeError);
    expect(() => toAdminConfigRequestDto({ section: 'unknown', config: {} })).toThrow(TypeError);
    expect(() => toAdminConfigRequestDto({ section: 'cors', config: [] })).toThrow(TypeError);
    expect(() => toAdminConfigRequestDto({ section: 'cors', config: {}, extra: true })).toThrow(TypeError);
  });

  it('rejects malformed response envelopes', () => {
    expect(() => toAdminConfigResponseDto({ section: 'cors', message: '' })).toThrow(TypeError);
    expect(() => toAdminConfigResponseDto({ section: 'cors', config: {} })).toThrow(TypeError);
    expect(() => toAdminConfigResponseDto({ section: 'cors', config: {}, message: 1 })).toThrow(TypeError);
    expect(() => fromAdminConfigResponseDto({ section: 'cors', config: {}, message: '', extra: true })).toThrow(TypeError);
  });

  it('accepts the full known section boundary and an empty sections list', () => {
    expect(toConfigSectionsResponseDto(CONFIG_SECTIONS).sections).toEqual(CONFIG_SECTIONS);
    expect(toConfigSectionsResponseDto([])).toEqual({ sections: [] });
  });

  it('rejects invalid and duplicate config sections', () => {
    expect(() => toConfigSectionsResponseDto(['cors', 'unknown'])).toThrow(TypeError);
    expect(() => toConfigSectionsResponseDto(['cors', 'cors'])).toThrow(TypeError);
    expect(() => fromConfigSectionsResponseDto({ sections: ['cors'], extra: true })).toThrow(TypeError);
  });
});
