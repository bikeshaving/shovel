import { test, expect, describe, beforeEach } from 'bun:test';
import { Router } from './index.js';
import { CacheStorage } from '@b9g/cache/cache-storage.js';
import { MemoryCache } from '@b9g/cache/memory-cache.js';

describe('Router Cache Integration', () => {
  let router;
  let caches;

  beforeEach(() => {
    caches = new CacheStorage();
    caches.register('posts', () => new MemoryCache('posts'));
    caches.register('users', () => new MemoryCache('users'));
    
    router = new Router({ caches });
  });

  test('can create router with cache storage', () => {
    expect(router).toBeDefined();
    expect(router.getStats().routeCount).toBe(0);
  });

  test('can register routes with cache configuration', () => {
    const handler = async (request, context) => new Response('Hello');

    router.route({
      pattern: '/api/posts/:id',
      cache: { name: 'posts' }
    }).get(handler);

    expect(router.getStats().routeCount).toBe(1);
  });

  test('provides cache context to handlers', async () => {
    let capturedContext = null;

    const handler = async (request, context) => {
      capturedContext = context;
      return new Response('OK');
    };

    router.route({
      pattern: '/api/posts/:id',
      cache: { name: 'posts' }
    }).get(handler);

    const request = new Request('http://example.com/api/posts/123');
    await router.match(request);

    expect(capturedContext).not.toBeNull();
    expect(capturedContext.params).toEqual({ id: '123' });
    expect(capturedContext.cache).toBeDefined();
    expect(capturedContext.caches).toBe(caches);
  });

  test('provides caches but no specific cache when not configured', async () => {
    let capturedContext = null;

    const handler = async (request, context) => {
      capturedContext = context;
      return new Response('OK');
    };

    router.route('/api/posts/:id').get(handler);

    const request = new Request('http://example.com/api/posts/123');
    await router.match(request);

    expect(capturedContext.cache).toBeUndefined();
    expect(capturedContext.caches).toBe(caches);
  });

  test('works without cache storage', async () => {
    const routerWithoutCache = new Router();
    let capturedContext = null;

    const handler = async (request, context) => {
      capturedContext = context;
      return new Response('OK');
    };

    routerWithoutCache.route('/api/posts/:id').get(handler);

    const request = new Request('http://example.com/api/posts/123');
    await routerWithoutCache.match(request);

    expect(capturedContext.cache).toBeUndefined();
    expect(capturedContext.caches).toBeUndefined();
    expect(capturedContext.params).toEqual({ id: '123' });
  });

  test('cache integration with middleware', async () => {
    const executionOrder = [];
    let middlewareContext = null;
    let handlerContext = null;

    const middleware = async (request, context, next) => {
      middlewareContext = context;
      executionOrder.push('middleware');
      const response = await next();
      executionOrder.push('middleware-after');
      return response;
    };

    const handler = async (request, context) => {
      handlerContext = context;
      executionOrder.push('handler');
      return new Response('OK');
    };

    router.use(middleware);
    router.route({
      pattern: '/api/posts/:id',
      cache: { name: 'posts' }
    }).get(handler);

    const request = new Request('http://example.com/api/posts/123');
    await router.match(request);

    expect(executionOrder).toEqual(['middleware', 'handler', 'middleware-after']);
    
    // Both middleware and handler should get the same context with cache
    expect(middlewareContext.cache).toBe(handlerContext.cache);
    expect(middlewareContext.caches).toBe(handlerContext.caches);
    expect(middlewareContext.params).toEqual({ id: '123' });
  });

  test('handles cache opening errors gracefully', async () => {
    // Register a cache that will fail to open
    caches.register('failing-cache', () => {
      throw new Error('Cache creation failed');
    });

    let capturedContext = null;
    const handler = async (request, context) => {
      capturedContext = context;
      return new Response('OK');
    };

    router.route({
      pattern: '/api/test',
      cache: { name: 'failing-cache' }
    }).get(handler);

    const request = new Request('http://example.com/api/test');
    const response = await router.match(request);

    // Request should still succeed
    expect(response).not.toBeNull();
    expect(await response.text()).toBe('OK');
    
    // Cache should be undefined, but caches should still be available
    expect(capturedContext.cache).toBeUndefined();
    expect(capturedContext.caches).toBe(caches);
  });

  test('can access different caches through context.caches', async () => {
    let capturedContext = null;

    const handler = async (request, context) => {
      capturedContext = context;
      
      // Access a different cache through context.caches
      const usersCache = await context.caches.open('users');
      await usersCache.put(request, new Response('User data'));
      
      return new Response('OK');
    };

    router.route({
      pattern: '/api/posts/:id',
      cache: { name: 'posts' }
    }).get(handler);

    const request = new Request('http://example.com/api/posts/123');
    await router.match(request);

    // Should have accessed users cache successfully
    const usersCache = await caches.open('users');
    const cachedResponse = await usersCache.match(request);
    
    expect(cachedResponse).not.toBeUndefined();
    expect(await cachedResponse.text()).toBe('User data');
  });
});