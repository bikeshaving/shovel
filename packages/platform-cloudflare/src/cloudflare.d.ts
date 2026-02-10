/**
 * Minimal Cloudflare Workers type declarations.
 *
 * We declare only the types this package uses, rather than pulling in
 * @cloudflare/workers-types globally (which augments Request,
 * ServiceWorkerGlobalScope, etc. and conflicts with standard DOM types).
 */

// ---------------------------------------------------------------------------
// cloudflare:workers module (runtime import in workerd)
// ---------------------------------------------------------------------------
declare module "cloudflare:workers" {
	abstract class DurableObject<Env = unknown> {
		protected ctx: DurableObjectState;
		protected env: Env;
		constructor(ctx: DurableObjectState, env: Env);
		fetch?(request: Request): Response | Promise<Response>;
		webSocketMessage?(
			ws: WebSocket,
			message: string | ArrayBuffer,
		): void | Promise<void>;
		webSocketClose?(
			ws: WebSocket,
			code: number,
			reason: string,
			wasClean: boolean,
		): void | Promise<void>;
		webSocketError?(
			ws: WebSocket,
			error: unknown,
		): void | Promise<void>;
	}
}

// ---------------------------------------------------------------------------
// Cloudflare runtime globals (available in workerd, not in Node/Bun)
// ---------------------------------------------------------------------------

interface DurableObjectState {
	readonly id: DurableObjectId;
	readonly storage: DurableObjectStorage;
	acceptWebSocket(ws: WebSocket, tags?: string[]): void;
	getWebSockets(tag?: string): WebSocket[];
}

interface DurableObjectId {
	toString(): string;
	equals(other: DurableObjectId): boolean;
	readonly name?: string;
}

interface DurableObjectStorage {
	get<T = unknown>(key: string): Promise<T | undefined>;
	get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
	put<T>(key: string, value: T): Promise<void>;
	put<T>(entries: Record<string, T>): Promise<void>;
	delete(key: string): Promise<boolean>;
	delete(keys: string[]): Promise<number>;
	deleteAll(): Promise<void>;
	list<T = unknown>(options?: DurableObjectStorageListOptions): Promise<Map<string, T>>;
}

interface DurableObjectStorageListOptions {
	start?: string;
	startAfter?: string;
	end?: string;
	prefix?: string;
	reverse?: boolean;
	limit?: number;
}

interface DurableObjectStub {
	readonly id: DurableObjectId;
	readonly name?: string;
	fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
	idFromName(name: string): DurableObjectId;
	idFromString(id: string): DurableObjectId;
	newUniqueId(): DurableObjectId;
	get(id: DurableObjectId): DurableObjectStub;
}

// WebSocketPair is a Cloudflare runtime global
declare class WebSocketPair {
	0: WebSocket;
	1: WebSocket;
}

// Cloudflare extends WebSocket with accept() for server-side sockets
interface WebSocket {
	accept(): void;
}

// Cloudflare extends ResponseInit with a webSocket property for 101 upgrades
interface ResponseInit {
	webSocket?: WebSocket | null;
}
