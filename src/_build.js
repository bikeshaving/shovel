/**
 * Production build system for Shovel apps
 * Pre-compiles ServiceWorker code for VM execution at runtime
 */

import * as esbuild from 'esbuild';
import { mkdir, writeFile } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { staticFilesPlugin } from '@b9g/shovel-compiler/static-files';

/**
 * Build ServiceWorker app for production deployment
 */
export async function buildForProduction({ entrypoint, platformName, outDir, verbose }) {
  const entryPath = resolve(entrypoint);
  const outputDir = resolve(outDir);
  
  if (verbose) {
    console.log(`📂 Entry: ${entryPath}`);
    console.log(`📂 Output: ${outputDir}`);
  }
  
  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });
  
  // Build ServiceWorker code (keep as ServiceWorker, just bundle dependencies)
  const result = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'node',
    outfile: join(outputDir, 'app.js'),
    packages: 'external',
    plugins: [
      staticFilesPlugin({
        outputDir: join(outputDir, 'static'),
        manifest: join(outputDir, 'static-manifest.json'),
        dev: false
      })
    ],
    metafile: true,
    sourcemap: false,
    minify: false,
    treeShaking: true,
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  });
  
  if (verbose && result.metafile) {
    console.log('📊 Bundle analysis:');
    const analysis = await esbuild.analyzeMetafile(result.metafile);
    console.log(analysis);
  }
  
  // Write production server wrapper that loads pre-built ServiceWorker into VM
  await writeServerWrapper(outputDir, platformName);
  
  if (verbose) {
    console.log(`📦 Built ${platformName} app to ${outputDir}`);
  }
}


/**
 * Write worker script for ServiceWorker execution
 */
async function writeWorkerScript(outputDir) {
  const workerCode = `import { createServiceWorkerGlobals } from '@b9g/shovel-compiler/vm-execution';
import { parentPort } from 'worker_threads';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set up ServiceWorker globals
const globals = createServiceWorkerGlobals();
Object.assign(globalThis, globals);

// Dynamic import the ServiceWorker
const appPath = join(__dirname, 'app.js');
const app = await import(appPath);
const serviceWorker = app.default;

// Simulate ServiceWorker lifecycle events using standard API
if (globalThis.self && globalThis.self.dispatchEvent) {
  // Install event
  const installEvent = new ExtendableEvent('install');
  globalThis.self.dispatchEvent(installEvent);
  await installEvent._waitForPromises();
  
  // Activate event  
  const activateEvent = new ExtendableEvent('activate');
  globalThis.self.dispatchEvent(activateEvent);
  await activateEvent._waitForPromises();
}

// Signal ready
parentPort.postMessage({ type: 'ready' });

// Handle requests from main thread
parentPort.on('message', async (message) => {
  try {
    if (message.type === 'request') {
      // Reconstruct Request object
      const request = new Request(message.url, {
        method: message.method,
        headers: message.headers,
        body: message.body
      });
      
      // Simulate fetch event dispatch using standard ServiceWorker API
      let response = null;
      if (globalThis.self && globalThis.self.dispatchEvent) {
        const fetchEvent = new FetchEvent('fetch', { 
          request,
          clientId: '',
          isReload: false
        });
        
        globalThis.self.dispatchEvent(fetchEvent);
        
        // Get response from standard FetchEvent API
        const eventResponse = fetchEvent._getResponse();
        if (eventResponse) {
          response = await eventResponse;
        }
      }
      
      // Fallback to direct router call if event dispatch didn't work
      if (!response) {
        response = await serviceWorker.handler(request);
      }
      
      // Send response back to main thread
      const responseData = {
        type: 'response',
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text()
      };
      
      parentPort.postMessage(responseData);
    }
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error.message
    });
  }
});
`;

  const workerPath = join(outputDir, 'worker.js');
  await writeFile(workerPath, workerCode);
}

/**
 * Write platform-specific server wrapper
 */
async function writeServerWrapper(outputDir, platformName) {
  let serverCode;
  
  if (platformName === 'node') {
    serverCode = `#!/usr/bin/env node
/**
 * Production Node.js server for Shovel app
 * Uses dynamic import with ServiceWorker globals
 */

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';

let worker;

async function initializeWorker() {
  // Create worker script that loads the ServiceWorker with proper globals
  const workerScript = join(__dirname, 'worker.js');
  worker = new Worker(workerScript);
  
  return new Promise((resolve, reject) => {
    worker.once('message', (message) => {
      if (message.type === 'ready') {
        resolve();
      } else if (message.type === 'error') {
        reject(new Error(message.error));
      }
    });
    
    worker.once('error', reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    // Convert Node.js request to Web API Request
    const url = \`http://\${req.headers.host}\${req.url}\`;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined
    });
    
    // Send request to worker and get response
    const response = await new Promise((resolve, reject) => {
      const requestData = {
        type: 'request',
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        body: request.body
      };
      
      worker.postMessage(requestData);
      
      const handleMessage = (message) => {
        if (message.type === 'response') {
          worker.off('message', handleMessage);
          
          // Reconstruct Response object
          const response = new Response(message.body, {
            status: message.status,
            statusText: message.statusText,
            headers: message.headers
          });
          resolve(response);
        } else if (message.type === 'error') {
          worker.off('message', handleMessage);
          reject(new Error(message.error));
        }
      };
      
      worker.on('message', handleMessage);
    });
    
    // Convert Web API Response to Node.js response
    res.statusCode = response.status;
    res.statusMessage = response.statusText;
    
    // Set headers
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    
    // Stream response body
    if (response.body) {
      const reader = response.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
        } else {
          res.write(value);
          await pump();
        }
      };
      await pump();
    } else {
      res.end();
    }
  } catch (error) {
    console.error('Request error:', error);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

// Initialize Worker and start server
try {
  await initializeWorker();
  server.listen(port, host, () => {
    console.log(\`🚀 Server running at http://\${host}:\${port}\`);
  });
} catch (error) {
  console.error('Failed to start server:', error);
  process.exit(1);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  worker?.terminate();
  server.close();
});
process.on('SIGINT', () => {
  worker?.terminate();
  server.close();
});
`;
  } else if (platformName === 'bun') {
    serverCode = `#!/usr/bin/env bun
/**
 * Production Bun server for Shovel app
 * Generated from ServiceWorker code
 */

import { handler } from './app.js';

const port = process.env.PORT || 3000;

Bun.serve({
  port,
  async fetch(request) {
    try {
      return await handler(request);
    } catch (error) {
      console.error('Request error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
});

console.log(\`🚀 Server running at http://localhost:\${port}\`);
`;
  } else if (platformName === 'cloudflare') {
    serverCode = `/**
 * Production Cloudflare Worker for Shovel app
 * Generated from ServiceWorker code
 */

import { handler } from './app.js';

export default {
  async fetch(request, env, ctx) {
    try {
      return await handler(request);
    } catch (error) {
      console.error('Request error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};
`;
  }
  
  const serverPath = join(outputDir, 'server.js');
  await writeFile(serverPath, serverCode);
  
  // Write worker script for Node.js
  if (platformName === 'node') {
    await writeWorkerScript(outputDir);
  }
  
  // Make Node.js server executable
  if (platformName === 'node' || platformName === 'bun') {
    const { chmod } = await import('fs/promises');
    await chmod(serverPath, 0o755);
  }
}