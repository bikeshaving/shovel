import { test, expect, describe } from 'bun:test';
import * as URL_builtin from "url";

// Get URLPattern for comparison tests
let URLPattern: typeof globalThis.URLPattern = URL_builtin.URLPattern || globalThis.URLPattern;
if (!URLPattern) {
  await import("urlpattern-polyfill");
  URLPattern = globalThis.URLPattern;
}

import { MatchPattern, type MatchPatternResult } from './match-pattern.js';

describe('Trailing Slash Normalization', () => {
  describe('URLPattern trailing slash issues', () => {
    test('URLPattern inconsistent behavior with trailing slashes', () => {
      const pattern: URLPattern = new URLPattern({ pathname: '/api/posts' });
      
      expect(pattern.test(new URL('http://example.com/api/posts'))).toBe(true);
      // This behavior varies - sometimes false, sometimes true depending on implementation
      const result: boolean = pattern.test(new URL('http://example.com/api/posts/'));
      console.log('URLPattern /api/posts matches /api/posts/:', result);
    });

    test('URLPattern pattern with trailing slash vs URL without', () => {
      const pattern: URLPattern = new URLPattern({ pathname: '/api/posts/' });
      
      expect(pattern.test(new URL('http://example.com/api/posts/'))).toBe(true);
      // This should probably match but often doesn't
      const result: boolean = pattern.test(new URL('http://example.com/api/posts'));
      console.log('URLPattern /api/posts/ matches /api/posts:', result);
    });
  });

  describe('MatchPattern trailing slash normalization', () => {
    test('should match URLs with or without trailing slash for patterns without slash', () => {
      const pattern: MatchPattern = new MatchPattern({ pathname: '/api/posts' });
      
      // Both should match
      expect(pattern.test(new URL('http://example.com/api/posts'))).toBe(true);
      expect(pattern.test(new URL('http://example.com/api/posts/'))).toBe(true);
    });

    test('should match URLs with or without trailing slash for patterns with slash', () => {
      const pattern: MatchPattern = new MatchPattern({ pathname: '/api/posts/' });
      
      // Both should match  
      expect(pattern.test(new URL('http://example.com/api/posts/'))).toBe(true);
      expect(pattern.test(new URL('http://example.com/api/posts'))).toBe(true);
    });

    test('should normalize trailing slashes in string patterns', () => {
      const pattern1: MatchPattern = new MatchPattern('/api/posts');
      const pattern2: MatchPattern = new MatchPattern('/api/posts/');
      
      const url1: URL = new URL('http://example.com/api/posts');
      const url2: URL = new URL('http://example.com/api/posts/');
      
      // All combinations should match
      expect(pattern1.test(url1)).toBe(true);
      expect(pattern1.test(url2)).toBe(true);
      expect(pattern2.test(url1)).toBe(true);
      expect(pattern2.test(url2)).toBe(true);
    });

    test('should preserve parameters with trailing slash normalization', () => {
      const pattern: MatchPattern = new MatchPattern('/api/:collection/:id');
      
      const result1: MatchPatternResult | null = pattern.exec(new URL('http://example.com/api/posts/123'));
      const result2: MatchPatternResult | null = pattern.exec(new URL('http://example.com/api/posts/123/'));
      
      expect(result1?.params).toEqual({ collection: 'posts', id: '123' });
      expect(result2?.params).toEqual({ collection: 'posts', id: '123' });
    });

    test('should handle root path trailing slash normalization', () => {
      const pattern1: MatchPattern = new MatchPattern('/');
      const pattern2: MatchPattern = new MatchPattern('');
      
      const url1: URL = new URL('http://example.com/');
      const url2: URL = new URL('http://example.com');
      
      // Root should always match regardless
      expect(pattern1.test(url1)).toBe(true);
      expect(pattern1.test(url2)).toBe(true);
    });

    test('should not normalize trailing slashes in the middle of paths', () => {
      const pattern: MatchPattern = new MatchPattern('/api/posts/');
      
      // Should match
      expect(pattern.test(new URL('http://example.com/api/posts'))).toBe(true);
      expect(pattern.test(new URL('http://example.com/api/posts/'))).toBe(true);
      
      // Should not match paths with extra segments
      expect(pattern.test(new URL('http://example.com/api/posts/123'))).toBe(false);
    });

    test('should handle complex patterns with trailing slash normalization', () => {
      const pattern: MatchPattern = new MatchPattern('/api/:collection&format=:format');
      
      const url1: URL = new URL('http://example.com/api/posts?format=json');
      const url2: URL = new URL('http://example.com/api/posts/?format=json');
      
      const result1: MatchPatternResult | null = pattern.exec(url1);
      const result2: MatchPatternResult | null = pattern.exec(url2);
      
      expect(result1?.params).toEqual({ collection: 'posts', format: 'json' });
      expect(result2?.params).toEqual({ collection: 'posts', format: 'json' });
    });
  });
});