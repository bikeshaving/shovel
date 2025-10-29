import { test, expect, describe } from 'bun:test';
import { Router } from './index.js';

describe('Router', () => {
  test('can create a router instance', () => {
    const router = new Router();
    expect(router).toBeDefined();
    expect(router.getStats().routeCount).toBe(0);
    expect(router.getStats().middlewareCount).toBe(0);
  });

  test('can register routes with chaining API', () => {
    const router = new Router();
    const handler = async (request: Request, context: any) => new Response('Hello');

    router.route('/api/users/:id')
      .get(handler)
      .post(handler);

    expect(router.getStats().routeCount).toBe(2);
  });

  test('can match GET requests', async () => {
    const router = new Router();
    const handler = async (request: Request, context: any) => {
      return new Response(`Hello user ${context.params.id}`);
    };

    router.route('/api/users/:id').get(handler);

    const request = new Request('http://example.com/api/users/123');
    const response = await router.match(request);

    expect(response).not.toBeNull();
    expect(await response.text()).toBe('Hello user 123');
  });

  test('returns null for non-matching routes', async () => {
    const router = new Router();
    router.route('/api/users/:id').get(async (request: Request, context: any) => new Response('Hello'));

    const request = new Request('http://example.com/api/posts/123');
    const response = await router.match(request);

    expect(response).toBeNull();
  });

  test('filters by HTTP method', async () => {
    const router = new Router();
    const getHandler = async (request: Request, context: any) => new Response('GET response');
    const postHandler = async (request: Request, context: any) => new Response('POST response');

    router.route('/api/users/:id')
      .get(getHandler)
      .post(postHandler);

    const getRequest = new Request('http://example.com/api/users/123', { method: 'GET' });
    const postRequest = new Request('http://example.com/api/users/123', { method: 'POST' });
    const putRequest = new Request('http://example.com/api/users/123', { method: 'PUT' });

    const getResponse = await router.match(getRequest);
    const postResponse = await router.match(postRequest);
    const putResponse = await router.match(putRequest);

    expect(await getResponse.text()).toBe('GET response');
    expect(await postResponse.text()).toBe('POST response');
    expect(putResponse).toBeNull();
  });

  test('middleware executes before handlers', async () => {
    const router = new Router();
    const executionOrder = [];

    const middleware = async (request: Request, context: any, next: Function) => {
      executionOrder.push('middleware');
      const response = await next();
      executionOrder.push('middleware-after');
      return response;
    };

    const handler = async (request: Request, context: any) => {
      executionOrder.push('handler');
      return new Response('Hello');
    };

    router.use(middleware);
    router.route('/test').get(handler);

    const request = new Request('http://example.com/test');
    await router.match(request);

    expect(executionOrder).toEqual(['middleware', 'handler', 'middleware-after']);
  });

  test('middleware can short-circuit', async () => {
    const router = new Router();
    const executionOrder = [];

    const middleware = async (request: Request, context: any, next: Function) => {
      executionOrder.push('middleware');
      return new Response('Short-circuited');
    };

    const handler = async (request: Request, context: any) => {
      executionOrder.push('handler');
      return new Response('Hello');
    };

    router.use(middleware);
    router.route('/test').get(handler);

    const request = new Request('http://example.com/test');
    const response = await router.match(request);

    expect(executionOrder).toEqual(['middleware']);
    expect(await response.text()).toBe('Short-circuited');
  });

  test('extracts route parameters correctly', async () => {
    const router = new Router();
    let capturedParams = null;

    const handler = async (request: Request, context: any) => {
      capturedParams = context.params;
      return new Response('OK');
    };

    router.route('/api/users/:userId/posts/:postId').get(handler);

    const request = new Request('http://example.com/api/users/123/posts/456');
    await router.match(request);

    expect(capturedParams).toEqual({
      userId: '123',
      postId: '456'
    });
  });

  test('handles trailing slashes correctly', async () => {
    const router = new Router();
    const handler = async (request: Request, context: any) => new Response('OK');

    router.route('/api/users/:id').get(handler);

    const request1 = new Request('http://example.com/api/users/123');
    const request2 = new Request('http://example.com/api/users/123/');

    const response1 = await router.match(request1);
    const response2 = await router.match(request2);

    expect(response1).not.toBeNull();
    expect(response2).not.toBeNull();
    expect(await response1.text()).toBe('OK');
    expect(await response2.text()).toBe('OK');
  });
});