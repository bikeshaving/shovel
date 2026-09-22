import {test, expect, describe} from "bun:test";
import {
	errorToResponse,
	createOrderedDispatch,
	toArrayBuffer,
	dispatchWebSocketMessage,
	ShovelServiceWorkerRegistration,
	ShovelWebSocketConnection,
} from "../src/runtime.js";
import {Unauthorized} from "@b9g/http-errors";

describe("errorToResponse (fail closed)", () => {
	// MODE is unset in this test process — exactly the production condition
	// the 0.2.21 security fix covers. Verbose bodies require an explicit
	// MODE === "development".
	test("unset MODE never leaks error internals", async () => {
		const secret = "sk-verysecret-stack-detail";
		const response = errorToResponse(new Error(secret));
		expect(response.status).toBe(500);
		const body = await response.text();
		expect(body).not.toContain(secret);
		expect(body).not.toContain("at "); // no stack frames
	});

	test("HTTPError statuses and messages pass through, without stacks", async () => {
		// 4xx messages are app-authored and client-facing by design; only
		// internals (stack frames, cause chains) must never leak.
		const response = errorToResponse(new Unauthorized("token expired"));
		expect(response.status).toBe(401);
		const body = await response.text();
		expect(body).toContain("token expired");
		expect(body).not.toContain("at "); // no stack frames
	});

	test("non-Error throwables are wrapped, not crashed on", () => {
		expect(errorToResponse("boom").status).toBe(500);
		expect(errorToResponse(undefined).status).toBe(500);
	});
});

describe("createOrderedDispatch", () => {
	test("tasks for one id run strictly in order", async () => {
		const {enqueue} = createOrderedDispatch();
		const order: number[] = [];
		enqueue("a", async () => {
			await new Promise((r) => setTimeout(r, 30));
			order.push(1);
		});
		enqueue("a", async () => {
			order.push(2);
		});
		enqueue("a", async () => {
			order.push(3);
		});
		await new Promise((r) => setTimeout(r, 100));
		expect(order).toEqual([1, 2, 3]);
	});

	test("distinct ids do not block each other", async () => {
		const {enqueue} = createOrderedDispatch();
		const order: string[] = [];
		enqueue("slow", async () => {
			await new Promise((r) => setTimeout(r, 60));
			order.push("slow");
		});
		enqueue("fast", async () => {
			order.push("fast");
		});
		await new Promise((r) => setTimeout(r, 120));
		expect(order).toEqual(["fast", "slow"]);
	});

	test("a rejected task logs and does not break the chain", async () => {
		const {enqueue} = createOrderedDispatch();
		const order: number[] = [];
		enqueue("a", async () => {
			throw new Error("task failed");
		});
		enqueue("a", async () => {
			order.push(2);
		});
		await new Promise((r) => setTimeout(r, 30));
		expect(order).toEqual([2]);
	});

	test("drain settles in-flight chains", async () => {
		const {enqueue, drain} = createOrderedDispatch();
		let done = false;
		enqueue("a", async () => {
			await new Promise((r) => setTimeout(r, 40));
			done = true;
		});
		await drain();
		expect(done).toBe(true);
	});
});

describe("toArrayBuffer", () => {
	test("copies out of a shared backing buffer", () => {
		const backing = new ArrayBuffer(16);
		new Uint8Array(backing).fill(7);
		const view = new Uint8Array(backing, 4, 4);
		const out = toArrayBuffer(view);
		expect(out.byteLength).toBe(4);
		expect([...new Uint8Array(out)]).toEqual([7, 7, 7, 7]);
		// Mutating the copy must not touch the shared backing memory.
		new Uint8Array(out).fill(0);
		expect(new Uint8Array(backing)[4]).toBe(7);
	});
});

describe("async websocket listeners auto-extend", () => {
	let nextId = 0;
	function makeConnection(): ShovelWebSocketConnection {
		return new ShovelWebSocketConnection({
			id: `test-conn-${nextId++}`,
			url: "ws://test/",
			relay: {send: () => {}, close: () => {}},
		});
	}

	test("a rejected async listener is absorbed, not unhandled", async () => {
		const registration = new ShovelServiceWorkerRegistration();
		let unhandled: unknown = null;
		const onUnhandled = (err: unknown) => {
			unhandled = err;
		};
		process.on("unhandledRejection", onUnhandled);
		try {
			registration.addEventListener("websocketmessage", async () => {
				await new Promise((r) => setTimeout(r, 5));
				throw new Error("handler exploded");
			});
			await dispatchWebSocketMessage(registration, makeConnection(), "hi");
			// Give the rejection a chance to surface if it were unhandled.
			await new Promise((r) => setTimeout(r, 40));
			expect(unhandled).toBe(null);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	test("returned promises reach the platform waitUntil collector", async () => {
		const registration = new ShovelServiceWorkerRegistration();
		let sawWork = false;
		registration.addEventListener("websocketmessage", async () => {
			await new Promise((r) => setTimeout(r, 10));
			sawWork = true;
		});
		const collected: Promise<unknown>[] = [];
		await dispatchWebSocketMessage(registration, makeConnection(), "hi", (p) =>
			collected.push(p),
		);
		// The async listener's returned promise must be collectable so
		// adapters (Durable Object hibernation) can persist state after it
		// settles — subscribe() after an await depends on this.
		expect(collected.length).toBeGreaterThan(0);
		await Promise.allSettled(collected);
		expect(sawWork).toBe(true);
	});

	test("removeEventListener removes the wrapped listener", async () => {
		const registration = new ShovelServiceWorkerRegistration();
		let calls = 0;
		const listener = () => {
			calls++;
		};
		registration.addEventListener("websocketmessage", listener);
		await dispatchWebSocketMessage(registration, makeConnection(), "one");
		registration.removeEventListener("websocketmessage", listener);
		await dispatchWebSocketMessage(registration, makeConnection(), "two");
		expect(calls).toBe(1);
	});
});
