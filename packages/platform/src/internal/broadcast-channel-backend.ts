/**
 * BroadcastChannel Backend Interface
 *
 * Pluggable backend for cross-process/cross-machine BroadcastChannel relay.
 * When configured, replaces the postMessage relay (the backend handles both
 * cross-worker and cross-process pub/sub).
 */

export interface BroadcastChannelBackend {
	/** Publish a message to a channel (called when local BC posts) */
	publish(channelName: string, data: unknown): void;
	/** Subscribe to a channel (called when first BC instance for a name is created) */
	subscribe(channelName: string, callback: (data: unknown) => void): () => void;
	/** Cleanup connections */
	dispose(): Promise<void>;
}
