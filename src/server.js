#!/usr/bin/env node
/**
 * Shovel Server - Production HTTP server using platform abstraction
 * Uses the platform-specific implementation (Node.js with Workers)
 */

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';
const entrypoint = process.env.ENTRYPOINT || `${process.cwd()}/dist/app.js`;

try {
  const { createNodePlatform } = await import('@b9g/platform-node');
  
  const platform = createNodePlatform({
    hotReload: false, // Production mode
    port,
    host,
  });
  
  console.log(`🔄 Loading ServiceWorker from ${entrypoint}`);
  
  // Load ServiceWorker app using platform abstraction
  const serviceWorker = await platform.loadServiceWorker(entrypoint, {
    hotReload: false,
  });
  
  // Create server using platform abstraction
  const server = platform.createServer(serviceWorker.handleRequest, {
    port,
    host,
  });
  
  // Start server
  await server.listen();
  
  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Server] Shutting down...');
    await serviceWorker.dispose();
    await platform.dispose();
    await server.close();
    process.exit(0);
  };
  
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  
} catch (error) {
  console.error('❌ Failed to start server:', error.message);
  process.exit(1);
}
