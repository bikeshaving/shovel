/**
 * Minimal Cloudflare Workers type declarations.
 *
 * We declare only the types this package needs rather than using
 * @cloudflare/workers-types globally, which would pollute Request/Response
 * with Cloudflare-specific generics across the entire monorepo.
 */

// cloudflare:workers module (runtime imports)
declare module "cloudflare:workers" {
	export abstract class DurableObject {
		ctx: DurableObjectState;
		env: Record<string, unknown>;
		constructor(ctx: DurableObjectState, env: Record<string, unknown>);
		fetch?(request: Request): Promise<Response>;
		alarm?(): Promise<void>;
		webSocketMessage?(
			ws: WebSocket,
			message: string | ArrayBuffer,
		): Promise<void>;
		webSocketClose?(
			ws: WebSocket,
			code: number,
			reason: string,
			wasClean: boolean,
		): Promise<void>;
		webSocketError?(ws: WebSocket, error: unknown): Promise<void>;
	}
}

// Cloudflare-specific globals available in the Workers runtime
declare class DurableObjectState {
	id: DurableObjectId;
	storage: DurableObjectStorage;
	acceptWebSocket(ws: WebSocket, tags?: string[]): void;
	getWebSockets(tag?: string): WebSocket[];
	waitUntil(promise: Promise<unknown>): void;
}

declare class DurableObjectStorage {
	get<T = unknown>(key: string): Promise<T | undefined>;
	get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
	put<T>(key: string, value: T): Promise<void>;
	put<T>(entries: Record<string, T>): Promise<void>;
	delete(key: string): Promise<boolean>;
	delete(keys: string[]): Promise<number>;
	list<T = unknown>(options?: {
		prefix?: string;
		limit?: number;
	}): Promise<Map<string, T>>;
}

declare class DurableObjectId {
	toString(): string;
	readonly name?: string;
}

declare interface DurableObjectNamespace {
	newUniqueId(): DurableObjectId;
	idFromName(name: string): DurableObjectId;
	idFromString(id: string): DurableObjectId;
	get(id: DurableObjectId): DurableObjectStub;
}

declare interface DurableObjectStub {
	readonly id: DurableObjectId;
	readonly name?: string;
	fetch(requestOrUrl: string | Request, init?: RequestInit): Promise<Response>;
}

declare var WebSocketPair: {
	new (): {0: WebSocket; 1: WebSocket};
};

// Augment Response constructor options for Cloudflare's webSocket field
declare interface ResponseInit {
	webSocket?: WebSocket;
}

// Augment WebSocket with Cloudflare's accept() method
interface WebSocket {
	accept(): void;
}
