#!/usr/bin/env node
/**
 * Simple Worker-based HTTP server with dynamic import and cache busting
 */

import { createServer } from 'http';
import { Worker } from 'worker_threads';

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';

/**
 * Worker Manager - handles Node.js Worker threads for ServiceWorker execution
 */
class WorkerManager {
  constructor(workerCount = 1) {
    this.workers = [];
    this.currentWorker = 0;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.initWorkers(workerCount);
  }

  initWorkers(count) {
    for (let i = 0; i < count; i++) {
      this.createWorker();
    }
  }

  createWorker() {
    // Use the worker.js from same directory
    const workerScript = new URL('./worker.js', import.meta.url);
    const worker = new Worker(workerScript);

    worker.on('message', (message) => {
      this.handleWorkerMessage(message);
    });

    worker.on('error', (error) => {
      console.error('[Server] Worker error:', error);
    });

    this.workers.push(worker);
    return worker;
  }

  handleWorkerMessage(message) {
    if (message.type === 'response' && message.requestId) {
      const pending = this.pendingRequests.get(message.requestId);
      if (pending) {
        const response = new Response(message.response.body, {
          status: message.response.status,
          statusText: message.response.statusText,
          headers: message.response.headers
        });
        pending.resolve(response);
        this.pendingRequests.delete(message.requestId);
      }
    } else if (message.type === 'error' && message.requestId) {
      const pending = this.pendingRequests.get(message.requestId);
      if (pending) {
        pending.reject(new Error(message.error));
        this.pendingRequests.delete(message.requestId);
      }
    } else if (message.type === 'ready') {
      console.log(`[Server] ServiceWorker ready (v${message.version})`);
    } else if (message.type === 'worker-ready') {
      console.log('[Server] Worker initialized');
    }
  }

  async handleRequest(request) {
    const worker = this.workers[this.currentWorker];
    this.currentWorker = (this.currentWorker + 1) % this.workers.length;
    const requestId = ++this.requestId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      worker.postMessage({
        type: 'request',
        request: {
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          body: request.body
        },
        requestId
      });

      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  async reloadWorkers(version = Date.now()) {
    console.log(`[Server] Reloading ServiceWorker (v${version})`);

    const loadPromises = this.workers.map(worker => {
      return new Promise((resolve) => {
        const handleReady = (message) => {
          if (message.type === 'ready' && message.version === version) {
            worker.off('message', handleReady);
            resolve();
          }
        };

        worker.on('message', handleReady);
        worker.postMessage({ type: 'load', version });
      });
    });

    await Promise.all(loadPromises);
    console.log(`[Server] All Workers reloaded (v${version})`);
  }

  async terminate() {
    const terminatePromises = this.workers.map(worker => worker.terminate());
    await Promise.allSettled(terminatePromises);
    this.workers = [];
    this.pendingRequests.clear();
  }
}

// Initialize Worker manager
const manager = new WorkerManager(1);

// Load initial ServiceWorker
await manager.reloadWorkers(Date.now());

// Create HTTP server
const server = createServer(async (req, res) => {
  try {
    const url = `http://${req.headers.host}${req.url}`;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined
    });

    const response = await manager.handleRequest(request);

    res.statusCode = response.status;
    res.statusMessage = response.statusText;

    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

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
    console.error('[Server] Request error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Internal Server Error');
  }
});

server.listen(port, host, () => {
  console.log(`🚀 Server running at http://${host}:${port}`);
});

const shutdown = async () => {
  console.log('[Server] Shutting down...');
  await manager.terminate();
  server.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);