#!/usr/bin/env node

/**
 * Example server that loads a ServiceWorker-style Shovel app
 * 
 * This demonstrates how platforms load ServiceWorker entrypoints and
 * provide the ServiceWorker runtime environment.
 */

import { createNodePlatform } from '@b9g/platform-node';
import { createRequestHandler } from '@remix-run/node-fetch-server';
import * as Http from 'http';

// Create Node platform with hot reloading
const platform = createNodePlatform({
  hotReload: true,
  port: 3001,
  host: 'localhost',
});

console.log('[Server] Loading ServiceWorker-style Shovel app...');

// Load the ServiceWorker entrypoint
const serviceWorker = await platform.loadServiceWorker('./src/service-worker-app.js', {
  hotReload: true,
  caches: {
    pages: { type: 'memory', maxEntries: 100 },
    api: { type: 'memory', ttl: 300000 },
    static: { type: 'filesystem' }
  }
});

// Wait for ServiceWorker to be ready
if (!serviceWorker.ready) {
  console.log('[Server] ServiceWorker not ready, waiting...');
  // In a real implementation, you'd wait for ready state
  await new Promise(resolve => setTimeout(resolve, 1000));
}

console.log('[Server] ServiceWorker ready, starting HTTP server...');

// Create HTTP server that forwards requests to ServiceWorker
const requestHandler = createRequestHandler(async (request) => {
  return serviceWorker.handleRequest(request);
});

const server = Http.createServer(requestHandler);

server.listen(3001, 'localhost', () => {
  console.log('🔥 ServiceWorker Shovel app running at http://localhost:3001');
  console.log('💡 Edit src/service-worker-app.js and see hot reloading!');
  console.log('🎯 This same file could run as a real ServiceWorker in browsers');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...');
  await serviceWorker.dispose();
  await platform.dispose();
  server.close(() => {
    console.log('[Server] Goodbye!');
    process.exit(0);
  });
});