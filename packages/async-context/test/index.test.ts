import {describe, test, expect} from "bun:test";
import {AsyncVariable, AsyncSnapshot, AsyncContext} from "../src/index.js";

describe("AsyncVariable", () => {
	test("should store and retrieve values", () => {
		const variable = new AsyncVariable<string>();

		variable.run("test-value", () => {
			expect(variable.get()).toBe("test-value");
		});
	});

	test("should return undefined outside of context", () => {
		const variable = new AsyncVariable<string>();
		expect(variable.get()).toBeUndefined();
	});

	test("should use default value when no context is set", () => {
		const variable = new AsyncVariable<string>({defaultValue: "default"});
		expect(variable.get()).toBe("default");
	});

	test("should propagate through async operations", async () => {
		const variable = new AsyncVariable<number>();

		await variable.run(42, async () => {
			expect(variable.get()).toBe(42);

			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(variable.get()).toBe(42);

			await Promise.resolve();
			expect(variable.get()).toBe(42);
		});
	});

	test("should isolate contexts in concurrent operations", async () => {
		const variable = new AsyncVariable<string>();

		const promise1 = variable.run("context-1", async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			return variable.get();
		});

		const promise2 = variable.run("context-2", async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return variable.get();
		});

		const [result1, result2] = await Promise.all([promise1, promise2]);

		expect(result1).toBe("context-1");
		expect(result2).toBe("context-2");
	});

	test("should support nested contexts", () => {
		const variable = new AsyncVariable<number>();

		variable.run(1, () => {
			expect(variable.get()).toBe(1);

			variable.run(2, () => {
				expect(variable.get()).toBe(2);

				variable.run(3, () => {
					expect(variable.get()).toBe(3);
				});

				expect(variable.get()).toBe(2);
			});

			expect(variable.get()).toBe(1);
		});
	});

	test("should preserve context through promise chains", async () => {
		const variable = new AsyncVariable<string>();

		await variable.run("test", async () => {
			const result = await Promise.resolve("ignore")
				.then(() => variable.get())
				.then((value) => {
					expect(value).toBe("test");
					return value;
				});

			expect(result).toBe("test");
		});
	});

	test("should return function result", () => {
		const variable = new AsyncVariable<number>();

		const result = variable.run(42, () => {
			return "returned value";
		});

		expect(result).toBe("returned value");
	});

	test("should return async function result", async () => {
		const variable = new AsyncVariable<number>();

		const result = await variable.run(42, async () => {
			await Promise.resolve();
			return "async returned value";
		});

		expect(result).toBe("async returned value");
	});

	test("should store name for debugging", () => {
		const variable = new AsyncVariable<string>({name: "userContext"});
		expect(variable.name).toBe("userContext");
	});
});

describe("AsyncContext object", () => {
	test("should export Variable class", () => {
		const variable = new AsyncContext.Variable<string>();

		variable.run("test", () => {
			expect(variable.get()).toBe("test");
		});
	});

	test("AsyncContext.Variable should be the same as AsyncVariable", () => {
		expect(AsyncContext.Variable).toBe(AsyncVariable);
		expect(AsyncContext.Snapshot).toBe(AsyncSnapshot);
	});
});

describe("AsyncSnapshot", () => {
	test("should capture current context values", () => {
		const variable = new AsyncVariable<string>();

		variable.run("captured-value", () => {
			const snapshot = new AsyncSnapshot();

			// Later, in a different context
			variable.run("different-value", () => {
				expect(variable.get()).toBe("different-value");

				// Restore captured context
				snapshot.run(() => {
					expect(variable.get()).toBe("captured-value");
				});

				// Back to different context
				expect(variable.get()).toBe("different-value");
			});
		});
	});

	test("should capture multiple variables", () => {
		const var1 = new AsyncVariable<string>();
		const var2 = new AsyncVariable<number>();

		var1.run("value1", () => {
			var2.run(42, () => {
				const snapshot = new AsyncSnapshot();

				// Change both contexts
				var1.run("changed1", () => {
					var2.run(100, () => {
						expect(var1.get()).toBe("changed1");
						expect(var2.get()).toBe(100);

						// Restore both
						snapshot.run(() => {
							expect(var1.get()).toBe("value1");
							expect(var2.get()).toBe(42);
						});
					});
				});
			});
		});
	});

	test("should pass arguments to run callback", () => {
		const variable = new AsyncVariable<string>();

		variable.run("test", () => {
			const snapshot = new AsyncSnapshot();

			const result = snapshot.run(
				(a: number, b: string) => {
					expect(variable.get()).toBe("test");
					return `${a}-${b}`;
				},
				123,
				"hello",
			);

			expect(result).toBe("123-hello");
		});
	});

	test("static wrap should preserve context", () => {
		const variable = new AsyncVariable<string>();

		const wrappedFn = variable.run("alice", () => {
			return AsyncSnapshot.wrap(() => {
				return variable.get();
			});
		});

		// Outside of any context
		expect(variable.get()).toBeUndefined();

		// Wrapped function preserves original context
		expect(wrappedFn()).toBe("alice");
	});

	test("static wrap should preserve this binding", () => {
		const variable = new AsyncVariable<string>();

		const obj = {
			name: "test-object",
			getInfo: function () {
				return `${this.name}: ${variable.get()}`;
			},
		};

		const wrappedMethod = variable.run("context-value", () => {
			return AsyncSnapshot.wrap(obj.getInfo);
		});

		// Call with proper this binding
		expect(wrappedMethod.call(obj)).toBe("test-object: context-value");
	});

	test("static wrap should work with async functions", async () => {
		const variable = new AsyncVariable<string>();

		const wrappedAsync = variable.run("async-context", () => {
			return AsyncSnapshot.wrap(async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				return variable.get();
			});
		});

		// Outside context
		expect(variable.get()).toBeUndefined();

		// Wrapped async function preserves context
		const result = await wrappedAsync();
		expect(result).toBe("async-context");
	});

	test("should work with AsyncContext.Snapshot", () => {
		const variable = new AsyncContext.Variable<string>();

		variable.run("snapshot-test", () => {
			const snapshot = new AsyncContext.Snapshot();

			variable.run("changed", () => {
				snapshot.run(() => {
					expect(variable.get()).toBe("snapshot-test");
				});
			});
		});
	});
});

describe("Real-world scenarios", () => {
	test("request context simulation", async () => {
		// Simulate a request context like in a web server
		interface RequestContext {
			requestId: string;
			userId?: string;
		}

		const requestContext = new AsyncVariable<RequestContext>();

		async function handleRequest(requestId: string, userId: string) {
			return requestContext.run({requestId, userId}, async () => {
				// Simulate middleware/handler chain
				await authenticateUser();
				await processRequest();
				return logRequest();
			});
		}

		async function authenticateUser() {
			const ctx = requestContext.get();
			expect(ctx?.userId).toBeDefined();
		}

		async function processRequest() {
			await new Promise((resolve) => setTimeout(resolve, 5));
			const ctx = requestContext.get();
			expect(ctx?.requestId).toBeDefined();
		}

		function logRequest() {
			const ctx = requestContext.get();
			return `Processed request ${ctx?.requestId} for user ${ctx?.userId}`;
		}

		const result = await handleRequest("req-123", "user-456");
		expect(result).toBe("Processed request req-123 for user user-456");
	});

	test("multiple independent contexts", async () => {
		const userContext = new AsyncVariable<string>();
		const requestIdContext = new AsyncVariable<string>();

		await userContext.run("alice", async () => {
			await requestIdContext.run("req-1", async () => {
				expect(userContext.get()).toBe("alice");
				expect(requestIdContext.get()).toBe("req-1");

				await new Promise((resolve) => setTimeout(resolve, 10));

				expect(userContext.get()).toBe("alice");
				expect(requestIdContext.get()).toBe("req-1");
			});

			expect(userContext.get()).toBe("alice");
			expect(requestIdContext.get()).toBeUndefined();
		});
	});
});
