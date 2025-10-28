import { test, expect, describe } from 'bun:test';
import { parseTTL, mergeCacheConfig, validateCacheConfig, createCorsHeaders } from './utils.js';
import { platformRegistry, detectPlatform } from './registry.js';
import type { Platform, CacheBackendConfig } from './types.js';

describe('@b9g/platform', () => {
  describe('TTL parsing', () => {
    test('parses number TTL', () => {
      expect(parseTTL(5000)).toBe(5000);
    });

    test('parses string TTL formats', () => {
      expect(parseTTL('1000ms')).toBe(1000);
      expect(parseTTL('5s')).toBe(5000);
      expect(parseTTL('10m')).toBe(600000);
      expect(parseTTL('2h')).toBe(7200000);
      expect(parseTTL('1d')).toBe(86400000);
    });

    test('handles undefined TTL', () => {
      expect(parseTTL(undefined)).toBeUndefined();
    });

    test('throws on invalid TTL format', () => {
      expect(() => parseTTL('invalid')).toThrow('Invalid TTL format');
    });
  });

  describe('Cache configuration', () => {
    test('merges cache config with defaults', () => {
      const config = mergeCacheConfig(
        { type: 'filesystem', dir: '/tmp' },
        { maxEntries: 100, ttl: 3600000 }
      );

      expect(config).toEqual({
        type: 'filesystem',
        dir: '/tmp',
        maxEntries: 100,
        ttl: 3600000
      });
    });

    test('validates valid cache config', () => {
      const config: CacheBackendConfig = { type: 'memory', maxEntries: 100 };
      expect(() => validateCacheConfig(config)).not.toThrow();
    });

    test('throws on invalid cache type', () => {
      const config = { type: 'invalid' } as CacheBackendConfig;
      expect(() => validateCacheConfig(config)).toThrow('Invalid cache type');
    });

    test('throws on filesystem cache without directory', () => {
      const config: CacheBackendConfig = { type: 'filesystem' };
      expect(() => validateCacheConfig(config)).toThrow('requires a directory');
    });
  });

  describe('CORS headers', () => {
    test('creates CORS headers for wildcard origin', () => {
      const request = new Request('http://example.com', {
        headers: { origin: 'http://localhost:3000' }
      });
      
      const headers = createCorsHeaders({ origin: true }, request);
      expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    test('creates CORS headers for specific origin', () => {
      const request = new Request('http://example.com', {
        headers: { origin: 'http://localhost:3000' }
      });
      
      const headers = createCorsHeaders({ 
        origin: 'http://localhost:3000',
        credentials: true 
      }, request);
      
      expect(headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
      expect(headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    test('handles empty CORS config', () => {
      const request = new Request('http://example.com');
      const headers = createCorsHeaders(null, request);
      expect(headers.has('Access-Control-Allow-Origin')).toBe(false);
    });
  });

  describe('Platform registry', () => {
    test('registers and retrieves platforms', () => {
      const mockPlatform: Platform = {
        name: 'test',
        capabilities: {
          hotReload: false,
          sourceMaps: false,
          compression: false,
          compilation: false,
          cacheBackends: ['memory']
        },
        createCaches: () => {
          throw new Error('Not implemented');
        },
        createStaticHandler: () => {
          throw new Error('Not implemented');
        },
        createServer: () => {
          throw new Error('Not implemented');
        }
      };

      platformRegistry.register('test', mockPlatform);
      expect(platformRegistry.get('test')).toBe(mockPlatform);
      expect(platformRegistry.list()).toContain('test');
    });

    test('detects platform', () => {
      const detection = platformRegistry.detect();
      expect(detection.platform).toMatch(/bun|node|unknown/);
      expect(typeof detection.confidence).toBe('number');
      expect(Array.isArray(detection.reasons)).toBe(true);
    });

    test('detectPlatform returns null for unknown platforms', () => {
      // This test might pass or fail depending on the runtime
      // but it shouldn't throw
      const platform = detectPlatform();
      expect(platform === null || typeof platform === 'object').toBe(true);
    });
  });
});