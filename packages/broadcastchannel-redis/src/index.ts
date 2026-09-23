/**
 * @b9g/broadcastchannel-redis - Redis pub/sub backend for Shovel BroadcastChannel
 *
 * Uses Redis PUBLISH/SUBSCRIBE for cross-process BroadcastChannel relay.
 * Requires two Redis client connections (can't publish and subscribe on the same connection).
 */

import type {BroadcastChannelBackend} from "@b9g/platform/runtime";
import {getLogger} from "@logtape/logtape";
import {createClient} from "redis";

const logger = getLogger(["shovel", "pubsub"]);

export interface RedisPubSubOptions {

	/** Redis connection URL (e.g., "redis://localhost:6379") */
	url?: string;
}

const kPublisher = Symbol("publisher");
const kSubscriber = Symbol("subscriber");
const kInstanceId = Symbol("instanceId");
const kPublisherReady = Symbol("publisherReady");
const kSubscriberReady = Symbol("subscriberReady");

export interface RedisPubSubBackend {
	[kPublisher]: ReturnType<typeof createClient>;
	[kSubscriber]: ReturnType<typeof createClient>;
	[kInstanceId]: string;
	[kPublisherReady]: Promise<void>;
	[kSubscriberReady]: Promise<void>;
}

/**
 * Redis pub/sub backend for BroadcastChannel.
 * Publishes messages via PUBLISH and subscribes via SUBSCRIBE.
 * Filters own messages using an instance ID.
 */
export class RedisPubSubBackend implements BroadcastChannelBackend {
	constructor(options: RedisPubSubOptions = {}) {
		this[kInstanceId] = crypto.randomUUID();
		const clientOptions = options.url ? {url: options.url} : {};

		this[kPublisher] = createClient(clientOptions);
		this[kSubscriber] = createClient(clientOptions);

		this[kPublisher].on("error", (err) => {
			logger.error("Redis publisher error: {error}", {error: err});
		});
		this[kSubscriber].on("error", (err) => {
			logger.error("Redis subscriber error: {error}", {error: err});
		});

		this[kPublisherReady] = this[kPublisher].connect().then(() => {
			logger.info("Redis publisher connected");
		});
		this[kSubscriberReady] = this[kSubscriber].connect().then(() => {
			logger.info("Redis subscriber connected");
		});
	}

	publish(channelName: string, data: unknown): void {
		const payload = JSON.stringify({data, sender: this[kInstanceId]});
		const redisChannel = `shovel:bc:${channelName}`;
		this[kPublisherReady].then(() => {
			this[kPublisher].publish(redisChannel, payload).catch((err) => {
				logger.error("Redis publish failed: {error}", {error: err});
			});
		});
	}

	subscribe(
		channelName: string,
		callback: (data: unknown) => void,
	): () => void {
		const redisChannel = `shovel:bc:${channelName}`;
		this[kSubscriberReady].then(() => {
			this[kSubscriber]
				.subscribe(redisChannel, (message) => {
					try {
						const {data, sender} = JSON.parse(message);
						if (sender !== this[kInstanceId]) {
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
			this[kSubscriber].unsubscribe(redisChannel).catch((err) => {
				logger.error("Redis unsubscribe failed: {error}", {error: err});
			});
		};
	}

	async dispose(): Promise<void> {
		try {
			await this[kSubscriber].quit();
		} catch (err) {
			logger.error("Error closing Redis subscriber: {error}", {error: err});
		}
		try {
			await this[kPublisher].quit();
		} catch (err) {
			logger.error("Error closing Redis publisher: {error}", {error: err});
		}
	}
}

export default RedisPubSubBackend;
