/**
 * BroadcastChannel Tests
 */

import {describe, it, expect, afterEach} from "bun:test";
import {
	ShovelBroadcastChannel,
	setBroadcastChannelRelay,
	deliverBroadcastMessage,
	setBroadcastChannelBackend,
} from "../src/internal/broadcast-channel.js";
import type {BroadcastChannelBackend} from "../src/internal/broadcast-channel-backend.js";

describe("BroadcastChannel", () => {
	it("constructor sets name", () => {
		const ch = new ShovelBroadcastChannel("test");
		expect(ch.name).toBe("test");
		ch.close();
	});

	it("postMessage delivers to other channels with same name", async () => {
		const ch1 = new ShovelBroadcastChannel("events");
		const ch2 = new ShovelBroadcastChannel("events");

		const received = new Promise<MessageEvent>((resolve) => {
			ch2.addEventListener("message", (ev) => resolve(ev as MessageEvent));
		});

		ch1.postMessage("hello");

		const event = await received;
		expect(event.data).toBe("hello");

		ch1.close();
		ch2.close();
	});

	it("does NOT deliver to self", async () => {
		const ch = new ShovelBroadcastChannel("self-test");
		let selfReceived = false;

		ch.addEventListener("message", () => {
			selfReceived = true;
		});

		ch.postMessage("ping");

		// Wait for microtasks to flush
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(selfReceived).toBe(false);
		ch.close();
	});

	it("does NOT deliver to channels with different names", async () => {
		const ch1 = new ShovelBroadcastChannel("channel-a");
		const ch2 = new ShovelBroadcastChannel("channel-b");
		let received = false;

		ch2.addEventListener("message", () => {
			received = true;
		});

		ch1.postMessage("wrong channel");

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(received).toBe(false);

		ch1.close();
		ch2.close();
	});

	it("close() stops delivery", async () => {
		const ch1 = new ShovelBroadcastChannel("close-test");
		const ch2 = new ShovelBroadcastChannel("close-test");
		let received = false;

		ch2.addEventListener("message", () => {
			received = true;
		});

		ch2.close();
		ch1.postMessage("after close");

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(received).toBe(false);

		ch1.close();
	});

	it("postMessage throws after close", () => {
		const ch = new ShovelBroadcastChannel("throw-test");
		ch.close();

		expect(() => ch.postMessage("fail")).toThrow("BroadcastChannel is closed");
	});

	it("structured clone semantics — mutation after send does not affect receiver", async () => {
		const ch1 = new ShovelBroadcastChannel("clone-test");
		const ch2 = new ShovelBroadcastChannel("clone-test");

		const received = new Promise<MessageEvent>((resolve) => {
			ch2.addEventListener("message", (ev) => resolve(ev as MessageEvent));
		});

		const obj = {value: 1};
		ch1.postMessage(obj);
		obj.value = 999; // mutate after send

		const event = await received;
		expect(event.data.value).toBe(1); // should be original

		ch1.close();
		ch2.close();
	});

	it("delivers to multiple receivers", async () => {
		const sender = new ShovelBroadcastChannel("multi");
		const r1 = new ShovelBroadcastChannel("multi");
		const r2 = new ShovelBroadcastChannel("multi");
		const r3 = new ShovelBroadcastChannel("multi");

		const messages: string[] = [];
		const allReceived = Promise.all([
			new Promise<void>((resolve) => {
				r1.addEventListener("message", (ev) => {
					messages.push(`r1:${(ev as MessageEvent).data}`);
					resolve();
				});
			}),
			new Promise<void>((resolve) => {
				r2.addEventListener("message", (ev) => {
					messages.push(`r2:${(ev as MessageEvent).data}`);
					resolve();
				});
			}),
			new Promise<void>((resolve) => {
				r3.addEventListener("message", (ev) => {
					messages.push(`r3:${(ev as MessageEvent).data}`);
					resolve();
				});
			}),
		]);

		sender.postMessage("broadcast");
		await allReceived;

		expect(messages).toContain("r1:broadcast");
		expect(messages).toContain("r2:broadcast");
		expect(messages).toContain("r3:broadcast");
		expect(messages.length).toBe(3);

		sender.close();
		r1.close();
		r2.close();
		r3.close();
	});

	it("onmessage handler works", async () => {
		const ch1 = new ShovelBroadcastChannel("handler-test");
		const ch2 = new ShovelBroadcastChannel("handler-test");

		const received = new Promise<MessageEvent>((resolve) => {
			ch2.onmessage = (ev) => resolve(ev);
		});

		ch1.postMessage("via handler");

		const event = await received;
		expect(event.data).toBe("via handler");

		ch1.close();
		ch2.close();
	});

	it("messageerror on uncloneable data", async () => {
		const ch1 = new ShovelBroadcastChannel("error-test");
		const ch2 = new ShovelBroadcastChannel("error-test");

		const received = new Promise<MessageEvent>((resolve) => {
			ch2.addEventListener("messageerror", (ev) => resolve(ev as MessageEvent));
		});

		// Functions can't be structured-cloned
		ch1.postMessage(() => {});

		const event = await received;
		expect(event.type).toBe("messageerror");

		ch1.close();
		ch2.close();
	});
});

describe("BroadcastChannel relay", () => {
	afterEach(() => {
		// Reset relay after each test
		setBroadcastChannelRelay(null as any);
	});

	it("setBroadcastChannelRelay is called on postMessage", () => {
		const relayed: Array<{channel: string; data: unknown}> = [];
		setBroadcastChannelRelay((channel, data) => {
			relayed.push({channel, data});
		});

		const ch = new ShovelBroadcastChannel("relay-test");
		ch.postMessage("hello relay");
		ch.close();

		expect(relayed.length).toBe(1);
		expect(relayed[0].channel).toBe("relay-test");
		expect(relayed[0].data).toBe("hello relay");
	});

	it("deliverBroadcastMessage delivers to local channels without re-relay", async () => {
		const relayed: Array<{channel: string; data: unknown}> = [];
		setBroadcastChannelRelay((channel, data) => {
			relayed.push({channel, data});
		});

		const ch = new ShovelBroadcastChannel("deliver-test");
		const received = new Promise<MessageEvent>((resolve) => {
			ch.addEventListener("message", (ev) => resolve(ev as MessageEvent));
		});

		// Simulate incoming relay message
		deliverBroadcastMessage("deliver-test", "from another worker");

		const event = await received;
		expect(event.data).toBe("from another worker");

		// Should NOT have re-relayed
		expect(relayed.length).toBe(0);

		ch.close();
	});

	it("deliverBroadcastMessage is no-op for unknown channel", () => {
		// Should not throw
		deliverBroadcastMessage("nonexistent-channel", "test");
	});
});

describe("BroadcastChannel backend", () => {
	afterEach(() => {
		// Reset backend by setting a null-like value
		setBroadcastChannelBackend(null as any);
		// Also reset relay
		setBroadcastChannelRelay(null as any);
	});

	it("backend.publish is called instead of relay when backend is set", () => {
		const published: Array<{channel: string; data: unknown}> = [];
		const relayed: Array<{channel: string; data: unknown}> = [];

		const mockBackend: BroadcastChannelBackend = {
			publish(channelName, data) {
				published.push({channel: channelName, data});
			},
			subscribe() {
				return () => {};
			},
			async dispose() {},
		};

		setBroadcastChannelBackend(mockBackend);
		setBroadcastChannelRelay((channel, data) => {
			relayed.push({channel, data});
		});

		const ch = new ShovelBroadcastChannel("backend-test");
		ch.postMessage("via backend");
		ch.close();

		expect(published.length).toBe(1);
		expect(published[0].channel).toBe("backend-test");
		expect(published[0].data).toBe("via backend");
		// Relay should NOT be called when backend is set
		expect(relayed.length).toBe(0);
	});

	it("backend.subscribe is called on first instance for a channel", () => {
		const subscriptions: string[] = [];

		const mockBackend: BroadcastChannelBackend = {
			publish() {},
			subscribe(channelName) {
				subscriptions.push(channelName);
				return () => {};
			},
			async dispose() {},
		};

		setBroadcastChannelBackend(mockBackend);

		const ch1 = new ShovelBroadcastChannel("sub-test");
		const ch2 = new ShovelBroadcastChannel("sub-test");

		// Should only subscribe once per channel name
		expect(subscriptions.length).toBe(1);
		expect(subscriptions[0]).toBe("sub-test");

		ch1.close();
		ch2.close();
	});

	it("backend unsubscribes when last instance for a channel closes", () => {
		let unsubscribed = false;

		const mockBackend: BroadcastChannelBackend = {
			publish() {},
			subscribe() {
				return () => {
					unsubscribed = true;
				};
			},
			async dispose() {},
		};

		setBroadcastChannelBackend(mockBackend);

		const ch1 = new ShovelBroadcastChannel("unsub-test");
		const ch2 = new ShovelBroadcastChannel("unsub-test");

		ch1.close();
		expect(unsubscribed).toBe(false); // Still one instance open

		ch2.close();
		expect(unsubscribed).toBe(true); // Last instance closed
	});
});
