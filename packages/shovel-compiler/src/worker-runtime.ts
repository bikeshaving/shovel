/**
 * Worker-based runtime for Shovel applications
 * Provides process isolation with VM execution for ServiceWorker lifecycle
 */

import { Worker } from 'worker_threads';
import { join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Worker runtime configuration
 */
export interface WorkerRuntimeOptions {
  /** Bundled application code */
  bundleCode: string;
  /** Entry point identifier */
  identifier: string;
  /** Additional context to pass to VM */
  context?: Record<string, any>;
  /** Enable hot module replacement */
  hmr?: boolean;
  /** Worker resource limits */
  resourceLimits?: {
    maxMemory?: number;
    maxCpu?: number;
  };
}

/**
 * Message types for Worker communication
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

/**
 * Serialized Request for Worker communication
 */
interface SerializedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Serialized Response for Worker communication
 */
interface SerializedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Worker-based ServiceWorker runtime
 * Runs VM execution in isolated Worker process
 */
export class WorkerRuntime {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: Function; reject: Function }>();
  private requestId = 0;
  private isReady = false;

  constructor(private options: WorkerRuntimeOptions) {}

  /**
   * Initialize the Worker and load the application
   */
  async initialize(): Promise<void> {
    // Create Worker with the worker script
    this.worker = new Worker(join(__dirname, 'worker-script.js'), {
      resourceLimits: this.options.resourceLimits,
    });

    // Set up message handling
    this.worker.on('message', this.handleWorkerMessage.bind(this));
    this.worker.on('error', (error) => {
      console.error('Worker error:', error);
    });

    // Initialize the Worker with bundle code
    this.sendMessage({
      type: 'init',
      bundleCode: this.options.bundleCode,
      identifier: this.options.identifier,
      context: this.options.context,
      hmr: this.options.hmr,
    });

    // Wait for Worker to be ready
    await this.waitForReady();
  }

  /**
   * Execute ServiceWorker install lifecycle
   */
  async install(): Promise<void> {
    this.ensureReady();
    this.sendMessage({ type: 'install' });
    await this.waitForEvent('installed');
  }

  /**
   * Execute ServiceWorker activate lifecycle
   */
  async activate(): Promise<void> {
    this.ensureReady();
    this.sendMessage({ type: 'activate' });
    await this.waitForEvent('activated');
  }

  /**
   * Handle fetch request through ServiceWorker
   */
  async handleRequest(request: Request): Promise<Response> {
    this.ensureReady();
    
    const id = (++this.requestId).toString();
    const serializedRequest = await this.serializeRequest(request);

    this.sendMessage({
      type: 'fetch',
      request: serializedRequest,
      id,
    });

    const serializedResponse = await this.waitForResponse(id);
    return this.deserializeResponse(serializedResponse);
  }

  /**
   * Dispose of the Worker
   */
  async dispose(): Promise<void> {
    if (this.worker) {
      this.sendMessage({ type: 'dispose' });
      await this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
  }

  /**
   * Handle messages from Worker
   */
  private handleWorkerMessage(message: WorkerResponse): void {
    switch (message.type) {
      case 'ready':
        this.isReady = true;
        break;
      
      case 'response': {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          pending.resolve(message.response);
          this.pendingRequests.delete(message.id);
        }
        break;
      }
      
      case 'error': {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          pending.reject(new Error(message.error));
          this.pendingRequests.delete(message.id);
        }
        break;
      }
    }
  }

  /**
   * Send message to Worker
   */
  private sendMessage(message: WorkerMessage): void {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }
    this.worker.postMessage(message);
  }

  /**
   * Wait for Worker to be ready
   */
  private async waitForReady(): Promise<void> {
    if (this.isReady) return;
    
    return new Promise((resolve) => {
      const checkReady = () => {
        if (this.isReady) {
          resolve();
        } else {
          setTimeout(checkReady, 10);
        }
      };
      checkReady();
    });
  }

  /**
   * Wait for specific event type
   */
  private async waitForEvent(eventType: string): Promise<void> {
    return new Promise((resolve) => {
      const originalHandler = this.handleWorkerMessage.bind(this);
      this.handleWorkerMessage = (message: WorkerResponse) => {
        originalHandler(message);
        if (message.type === eventType) {
          this.handleWorkerMessage = originalHandler;
          resolve();
        }
      };
    });
  }

  /**
   * Wait for response to specific request
   */
  private async waitForResponse(id: string): Promise<SerializedResponse> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      // Set timeout for requests
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000); // 30 second timeout
    });
  }

  /**
   * Ensure Worker is ready
   */
  private ensureReady(): void {
    if (!this.isReady || !this.worker) {
      throw new Error('Worker not ready');
    }
  }

  /**
   * Serialize Request for Worker communication
   */
  private async serializeRequest(request: Request): Promise<SerializedRequest> {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      url: request.url,
      method: request.method,
      headers,
      body: await request.text().catch(() => undefined),
    };
  }

  /**
   * Deserialize Response from Worker communication
   */
  private deserializeResponse(serialized: SerializedResponse): Response {
    return new Response(serialized.body, {
      status: serialized.status,
      statusText: serialized.statusText,
      headers: serialized.headers,
    });
  }
}

/**
 * Create a new Worker runtime instance
 */
export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  return new WorkerRuntime(options);
}