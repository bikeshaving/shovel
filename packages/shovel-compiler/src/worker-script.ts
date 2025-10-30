/**
 * Worker script for executing Shovel applications in isolated processes
 * This runs inside the Worker thread and handles VM execution
 */

import { parentPort } from 'worker_threads';
import { executeInVM, createServiceWorkerGlobals, type ServiceWorkerRuntime, type VMExecutionResult } from './vm-execution.js';

/**
 * Message types (same as worker-runtime.ts)
 */
type WorkerMessage = 
  | { type: 'init'; bundleCode: string; identifier: string; context?: Record<string, any>; hmr?: boolean }
  | { type: 'install' }
  | { type: 'activate' }
  | { type: 'fetch'; request: SerializedRequest; id: string }
  | { type: 'dispose' };

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'installed' }
  | { type: 'activated' }
  | { type: 'response'; id: string; response: SerializedResponse }
  | { type: 'error'; id: string; error: string };

interface SerializedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface SerializedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Worker state
 */
let vmResult: VMExecutionResult | null = null;
let runtime: ServiceWorkerRuntime | null = null;

/**
 * Handle messages from main thread
 */
async function handleMessage(message: WorkerMessage): Promise<void> {
  try {
    switch (message.type) {
      case 'init':
        await initializeVM(message);
        break;
      
      case 'install':
        await handleInstall();
        break;
      
      case 'activate':
        await handleActivate();
        break;
      
      case 'fetch':
        await handleFetch(message);
        break;
      
      case 'dispose':
        await handleDispose();
        break;
    }
  } catch (error) {
    console.error('Worker error:', error);
    if (message.type === 'fetch' && 'id' in message) {
      sendMessage({
        type: 'error',
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Initialize VM with bundle code
 */
async function initializeVM(message: { bundleCode: string; identifier: string; context?: Record<string, any>; hmr?: boolean }): Promise<void> {
  // Create ServiceWorker globals for this Worker
  const globals = createServiceWorkerGlobals();
  
  // Execute bundle in VM
  vmResult = await executeInVM(message.bundleCode, {
    identifier: message.identifier,
    globals,
    context: message.context,
    hmr: message.hmr,
  });
  
  runtime = vmResult.runtime;
  
  // Signal that Worker is ready
  sendMessage({ type: 'ready' });
}

/**
 * Handle install lifecycle
 */
async function handleInstall(): Promise<void> {
  if (!runtime) {
    throw new Error('Runtime not initialized');
  }
  
  await runtime.install();
  sendMessage({ type: 'installed' });
}

/**
 * Handle activate lifecycle
 */
async function handleActivate(): Promise<void> {
  if (!runtime) {
    throw new Error('Runtime not initialized');
  }
  
  await runtime.activate();
  sendMessage({ type: 'activated' });
}

/**
 * Handle fetch request
 */
async function handleFetch(message: { request: SerializedRequest; id: string }): Promise<void> {
  if (!runtime) {
    throw new Error('Runtime not initialized');
  }
  
  try {
    // Deserialize request
    const request = new Request(message.request.url, {
      method: message.request.method,
      headers: message.request.headers,
      body: message.request.body,
    });
    
    // Handle request through runtime
    const response = await runtime.handleRequest(request);
    
    // Serialize response
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    
    const serializedResponse: SerializedResponse = {
      status: response.status,
      statusText: response.statusText,
      headers,
      body: await response.text(),
    };
    
    sendMessage({
      type: 'response',
      id: message.id,
      response: serializedResponse,
    });
  } catch (error) {
    sendMessage({
      type: 'error',
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle disposal
 */
async function handleDispose(): Promise<void> {
  if (vmResult) {
    vmResult.dispose();
    vmResult = null;
    runtime = null;
  }
}

/**
 * Send message to main thread
 */
function sendMessage(message: WorkerResponse): void {
  if (parentPort) {
    parentPort.postMessage(message);
  }
}

/**
 * Set up message handling
 */
if (parentPort) {
  parentPort.on('message', handleMessage);
} else {
  console.error('Worker script must run in a Worker thread');
  process.exit(1);
}