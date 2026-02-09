/**
 * BroadcastChannel Tests
 */

import {describe, it, expect} from "bun:test";
import {ShovelBroadcastChannel} from "../src/broadcast-channel.js";

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
			ch2.addEventListener("messageerror", (ev) =>
				resolve(ev as MessageEvent),
			);
		});

		// Functions can't be structured-cloned
		ch1.postMessage(() => {});

		const event = await received;
		expect(event.type).toBe("messageerror");

		ch1.close();
		ch2.close();
	});
});
