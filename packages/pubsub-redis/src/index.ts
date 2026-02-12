/**
 * @b9g/pubsub-redis - Redis pub/sub backend for Shovel BroadcastChannel
 *
 * Uses Redis PUBLISH/SUBSCRIBE for cross-process BroadcastChannel relay.
 * Requires two Redis client connections (can't publish and subscribe on the same connection).
 */

import {createClient} from "redis";
import {getLogger} from "@logtape/logtape";
import type {BroadcastChannelBackend} from "@b9g/platform/broadcast-channel-backend";

const logger = getLogger(["shovel", "pubsub"]);

export interface RedisPubSubOptions {
	/** Redis connection URL (e.g., "redis://localhost:6379") */
	url?: string;
}

/**
 * Redis pub/sub backend for BroadcastChannel.
 * Publishes messages via PUBLISH and subscribes via SUBSCRIBE.
 * Filters own messages using an instance ID.
 */
export class RedisPubSubBackend implements BroadcastChannelBackend {
	#publisher: ReturnType<typeof createClient>;
	#subscriber: ReturnType<typeof createClient>;
	#instanceId: string;
	#publisherReady: Promise<void>;
	#subscriberReady: Promise<void>;

	constructor(options: RedisPubSubOptions = {}) {
		this.#instanceId = crypto.randomUUID();
		const clientOptions = options.url ? {url: options.url} : {};

		this.#publisher = createClient(clientOptions);
		this.#subscriber = createClient(clientOptions);

		this.#publisher.on("error", (err) => {
			logger.error("Redis publisher error: {error}", {error: err});
		});
		this.#subscriber.on("error", (err) => {
			logger.error("Redis subscriber error: {error}", {error: err});
		});

		this.#publisherReady = this.#publisher.connect().then(() => {
			logger.info("Redis publisher connected");
		});
		this.#subscriberReady = this.#subscriber.connect().then(() => {
			logger.info("Redis subscriber connected");
		});
	}

	publish(channelName: string, data: unknown): void {
		const payload = JSON.stringify({data, sender: this.#instanceId});
		const redisChannel = `shovel:bc:${channelName}`;
		this.#publisherReady.then(() => {
			this.#publisher.publish(redisChannel, payload).catch((err) => {
				logger.error("Redis publish failed: {error}", {error: err});
			});
		});
	}

	subscribe(
		channelName: string,
		callback: (data: unknown) => void,
	): () => void {
		const redisChannel = `shovel:bc:${channelName}`;
		this.#subscriberReady.then(() => {
			this.#subscriber
				.subscribe(redisChannel, (message) => {
					try {
						const {data, sender} = JSON.parse(message);
						if (sender !== this.#instanceId) {
							callback(data);
						}
					} catch (err) {
						logger.error("Failed to parse broadcast message: {error}", {
							error: err,
						});
					}
				})
				.catch((err) => {
					logger.error("Redis subscribe failed: {error}", {error: err});
				});
		});
		return () => {
			this.#subscriber.unsubscribe(redisChannel).catch((err) => {
				logger.error("Redis unsubscribe failed: {error}", {error: err});
			});
		};
	}

	async dispose(): Promise<void> {
		try {
			await this.#subscriber.quit();
		} catch (err) {
			logger.error("Error closing Redis subscriber: {error}", {error: err});
		}
		try {
			await this.#publisher.quit();
		} catch (err) {
			logger.error("Error closing Redis publisher: {error}", {error: err});
		}
	}
}

export default RedisPubSubBackend;
