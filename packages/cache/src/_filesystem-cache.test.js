import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { FilesystemCache } from './filesystem-cache.js';
import * as fs from 'fs';
import * as path from 'path';

describe('FilesystemCache', () => {
  const testDir = './test-cache';
  let cache;

  beforeEach(() => {
    // Clean up any existing test cache
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    
    cache = new FilesystemCache('test', { 
      directory: testDir,
      createDirectories: true 
    });
  });

  afterEach(() => {
    // Clean up test cache
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('creates cache directory on initialization', () => {
    const expectedDir = path.join(testDir, 'test');
    expect(fs.existsSync(expectedDir)).toBe(true);
  });

  test('can store and retrieve responses', async () => {
    const request = new Request('http://example.com/test');
    const response = new Response('Hello World', {
      headers: { 'Content-Type': 'text/plain' }
    });
    
    await cache.put(request, response);
    
    const cached = await cache.match(request);
    expect(cached).not.toBeNull();
    expect(await cached.text()).toBe('Hello World');
    expect(cached.headers.get('Content-Type')).toBe('text/plain');
  });

  test('returns undefined for non-existent entries', async () => {
    const request = new Request('http://example.com/nonexistent');
    const cached = await cache.match(request);
    expect(cached).toBeUndefined();
  });

  test('can delete entries', async () => {
    const request = new Request('http://example.com/test');
    const response = new Response('Hello World');
    
    await cache.put(request, response);
    expect(await cache.match(request)).not.toBeUndefined();
    
    const deleted = await cache.delete(request);
    expect(deleted).toBe(true);
    expect(await cache.match(request)).toBeUndefined();
  });

  test('returns false when deleting non-existent entry', async () => {
    const request = new Request('http://example.com/nonexistent');
    const deleted = await cache.delete(request);
    expect(deleted).toBe(false);
  });

  test('can list cache keys', async () => {
    const request1 = new Request('http://example.com/test1');
    const request2 = new Request('http://example.com/test2');
    const response = new Response('Test');
    
    await cache.put(request1, response.clone());
    await cache.put(request2, response.clone());
    
    const keys = await cache.keys();
    expect(keys).toHaveLength(2);
    
    const urls = keys.map(req => req.url).sort();
    expect(urls).toEqual(['http://example.com/test1', 'http://example.com/test2']);
  });

  test('handles binary response data', async () => {
    const request = new Request('http://example.com/binary');
    const binaryData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG header
    const response = new Response(binaryData, {
      headers: { 'Content-Type': 'image/png' }
    });
    
    await cache.put(request, response);
    
    const cached = await cache.match(request);
    expect(cached).not.toBeUndefined();
    
    const cachedData = new Uint8Array(await cached.arrayBuffer());
    expect(cachedData).toEqual(binaryData);
    expect(cached.headers.get('Content-Type')).toBe('image/png');
  });

  test('handles responses with no body', async () => {
    const request = new Request('http://example.com/empty');
    const response = new Response(null, {
      status: 204,
      statusText: 'No Content'
    });
    
    await cache.put(request, response);
    
    const cached = await cache.match(request);
    expect(cached).not.toBeUndefined();
    expect(cached.status).toBe(204);
    expect(cached.statusText).toBe('No Content');
    
    const body = await cached.text();
    expect(body).toBe('');
  });

  test('respects maxAge option', async () => {
    const shortLivedCache = new FilesystemCache('short-lived', {
      directory: testDir,
      maxAge: 50 // 50ms
    });

    const request = new Request('http://example.com/test');
    const response = new Response('Hello World');
    
    await shortLivedCache.put(request, response);
    
    // Should be available immediately
    let cached = await shortLivedCache.match(request);
    expect(cached).not.toBeUndefined();
    
    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Should be expired and return undefined
    cached = await shortLivedCache.match(request);
    expect(cached).toBeUndefined();
  });

  test('can clear all entries', async () => {
    await cache.put(new Request('http://example.com/1'), new Response('1'));
    await cache.put(new Request('http://example.com/2'), new Response('2'));
    
    expect((await cache.keys()).length).toBe(2);
    
    await cache.clear();
    
    expect((await cache.keys()).length).toBe(0);
  });

  test('provides cache statistics', () => {
    const stats = cache.getStats();
    
    expect(stats.name).toBe('test');
    expect(stats.directory).toBe(path.join(testDir, 'test'));
    expect(typeof stats.entryCount).toBe('number');
  });

  test('handles concurrent writes safely', async () => {
    const request = new Request('http://example.com/concurrent');
    
    // Start multiple put operations simultaneously
    const promises = [];
    for (let i = 0; i < 5; i++) {
      const response = new Response(`Response ${i}`);
      promises.push(cache.put(request, response));
    }
    
    // Wait for all to complete
    await Promise.all(promises);
    
    // Should have exactly one entry (last write wins)
    const keys = await cache.keys();
    expect(keys.length).toBe(1);
    
    const cached = await cache.match(request);
    expect(cached).not.toBeUndefined();
  });

  test('sanitizes cache names for filesystem', () => {
    const specialCache = new FilesystemCache('test/with:special*chars', {
      directory: testDir
    });
    
    const stats = specialCache.getStats();
    expect(stats.directory).toBe(path.join(testDir, 'test_with_special_chars'));
  });

  test('handles filesystem errors gracefully', async () => {
    // Create cache in a read-only directory (simulated)
    const readOnlyCache = new FilesystemCache('readonly', {
      directory: '/nonexistent/readonly',
      createDirectories: false
    });

    const request = new Request('http://example.com/test');
    const response = new Response('test');

    // Should handle error gracefully
    await expect(async () => {
      await readOnlyCache.put(request, response);
    }).toThrow();

    // Match should return undefined for non-existent entries
    const cached = await readOnlyCache.match(request);
    expect(cached).toBeUndefined();
  });
});