/**
 * ServiceWorker runtime environment for Shovel entrypoints
 *
 * Provides ServiceWorker APIs (self, addEventListener, etc.) in any JavaScript runtime
 */

/**
 * ExtendableEvent base class following ServiceWorker spec
 */
export class ExtendableEvent extends Event {
	private promises: Promise<any>[] = [];
	private pendingPromises: Set<Promise<any>>;

	constructor(type: string, pendingPromises: Set<Promise<any>>) {
		super(type);
		this.pendingPromises = pendingPromises;
	}

	waitUntil(promise: Promise<any>): void {
		this.promises.push(promise);
		this.pendingPromises.add(promise);
		promise.finally(() => this.pendingPromises.delete(promise));
	}

	getPromises(): Promise<any>[] {
		return [...this.promises];
	}
}

/**
 * ServiceWorker-style fetch event
 */
export class FetchEvent extends ExtendableEvent {
	readonly request: Request;
	private responsePromise: Promise<Response> | null = null;
	private responded = false;

	constructor(request: Request, pendingPromises: Set<Promise<any>>) {
		super("fetch", pendingPromises);
		this.request = request;
	}

	respondWith(response: Response | Promise<Response>): void {
		if (this.responded) {
			throw new Error("respondWith() already called");
		}
		this.responded = true;
		this.responsePromise = Promise.resolve(response);
	}

	getResponse(): Promise<Response> | null {
		return this.responsePromise;
	}

	hasResponded(): boolean {
		return this.responded;
	}
}

/**
 * ServiceWorker-style install event
 */
export class InstallEvent extends ExtendableEvent {
	constructor(pendingPromises: Set<Promise<any>>) {
		super("install", pendingPromises);
	}
}

/**
 * ServiceWorker-style activate event
 */
export class ActivateEvent extends ExtendableEvent {
	constructor(pendingPromises: Set<Promise<any>>) {
		super("activate", pendingPromises);
	}
}

/**
 * Legacy interfaces for backward compatibility
 */
export interface ShovelFetchEvent extends Event {
	readonly type: "fetch";
	readonly request: Request;
	respondWith(response: Response | Promise<Response>): void;
	waitUntil(promise: Promise<any>): void;
}

export interface ShovelInstallEvent extends Event {
	readonly type: "install";
	waitUntil(promise: Promise<any>): void;
}

export interface ShovelActivateEvent extends Event {
	readonly type: "activate";
	waitUntil(promise: Promise<any>): void;
}

/**
 * Bucket storage interface - parallels CacheStorage for filesystem access
 * This could become a future web standard
 */
export interface BucketStorage {
	/**
	 * Open a named bucket - returns FileSystemDirectoryHandle (root of that bucket)
	 * Well-known names: 'assets', 'static', 'uploads', 'temp'
	 */
	open(name: string): Promise<FileSystemDirectoryHandle>;

	/**
	 * Alias for open() - for compatibility with File System Access API naming
	 */
	getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>;

	/**
	 * Check if a named bucket exists
	 */
	has(name: string): Promise<boolean>;

	/**
	 * Delete a named bucket and all its contents
	 */
	delete(name: string): Promise<boolean>;

	/**
	 * List all available bucket names
	 */
	keys(): Promise<string[]>;
}
