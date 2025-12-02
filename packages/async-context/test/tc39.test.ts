/**
 * Tests adapted from the TC39 AsyncContext proposal
 * https://github.com/nicolo-ribaudo/proposal-async-context
 */
import {describe, test, expect} from "bun:test";
import {AsyncContext} from "../src/index.js";

type Value = {id: number};

// Test both from the initial state, and from a run state.
// This is because the initial state might be "frozen", and
// that can cause different code paths.
function runTest(name: string, fn: () => void) {
	test(name, () => {
		fn();

		// Ensure we're running from a new state, which won't be frozen.
		const throwaway = new AsyncContext.Variable<null>();
		throwaway.run(null, fn);

		throwaway.run(null, () => {
			AsyncContext.Snapshot.wrap(() => {});

			// Ensure we're running from a new state, which is frozen.
			fn();
		});
	});
}

describe("TC39 sync tests", () => {
	describe("run and get", () => {
		runTest("has initial undefined state", () => {
			const ctx = new AsyncContext.Variable<Value>();

			const actual = ctx.get();

			expect(actual).toEqual(undefined);
		});

		runTest("return value", () => {
			const ctx = new AsyncContext.Variable<Value>();
			const expected = {id: 1};

			const actual = ctx.run({id: 2}, () => expected);

			expect(actual).toEqual(expected);
		});

		runTest("get returns current context value", () => {
			const ctx = new AsyncContext.Variable<Value>();
			const expected = {id: 1};

			ctx.run(expected, () => {
				expect(ctx.get()).toEqual(expected);
			});
		});

		runTest("get within nesting contexts", () => {
			const ctx = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};

			ctx.run(first, () => {
				expect(ctx.get()).toEqual(first);
				ctx.run(second, () => {
					expect(ctx.get()).toEqual(second);
				});
				expect(ctx.get()).toEqual(first);
			});
			expect(ctx.get()).toEqual(undefined);
		});

		runTest("get within nesting different contexts", () => {
			const a = new AsyncContext.Variable<Value>();
			const b = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};

			a.run(first, () => {
				expect(a.get()).toEqual(first);
				expect(b.get()).toEqual(undefined);
				b.run(second, () => {
					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(second);
				});
				expect(a.get()).toEqual(first);
				expect(b.get()).toEqual(undefined);
			});
			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
		});
	});

	describe("wrap", () => {
		runTest("stores initial undefined state", () => {
			const ctx = new AsyncContext.Variable<Value>();
			const wrapped = AsyncContext.Snapshot.wrap(() => ctx.get());

			ctx.run({id: 1}, () => {
				expect(wrapped()).toEqual(undefined);
			});
		});

		runTest("stores current state", () => {
			const ctx = new AsyncContext.Variable<Value>();
			const expected = {id: 1};

			const wrap = ctx.run(expected, () => {
				const wrap = AsyncContext.Snapshot.wrap(() => ctx.get());
				expect(wrap()).toEqual(expected);
				expect(ctx.get()).toEqual(expected);
				return wrap;
			});

			expect(wrap()).toEqual(expected);
			expect(ctx.get()).toEqual(undefined);
		});

		runTest("runs within wrap", () => {
			const ctx = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};

			const [wrap1, wrap2] = ctx.run(first, () => {
				const wrap1 = AsyncContext.Snapshot.wrap(() => {
					expect(ctx.get()).toEqual(first);

					ctx.run(second, () => {
						expect(ctx.get()).toEqual(second);
					});

					expect(ctx.get()).toEqual(first);
				});
				expect(ctx.get()).toEqual(first);

				ctx.run(second, () => {
					expect(ctx.get()).toEqual(second);
				});

				const wrap2 = AsyncContext.Snapshot.wrap(() => {
					expect(ctx.get()).toEqual(first);

					ctx.run(second, () => {
						expect(ctx.get()).toEqual(second);
					});

					expect(ctx.get()).toEqual(first);
				});
				expect(ctx.get()).toEqual(first);
				return [wrap1, wrap2] as const;
			});

			wrap1();
			wrap2();
			expect(ctx.get()).toEqual(undefined);
		});

		runTest("runs different context within wrap", () => {
			const a = new AsyncContext.Variable<Value>();
			const b = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};

			const [wrap1, wrap2] = a.run(first, () => {
				const wrap1 = AsyncContext.Snapshot.wrap(() => {
					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(undefined);

					b.run(second, () => {
						expect(a.get()).toEqual(first);
						expect(b.get()).toEqual(second);
					});

					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(undefined);
				});

				a.run(second, () => {});

				const wrap2 = AsyncContext.Snapshot.wrap(() => {
					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(undefined);

					b.run(second, () => {
						expect(a.get()).toEqual(first);
						expect(b.get()).toEqual(second);
					});

					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(undefined);
				});

				expect(a.get()).toEqual(first);
				expect(b.get()).toEqual(undefined);
				return [wrap1, wrap2] as const;
			});

			wrap1();
			wrap2();
			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
		});

		runTest("runs different context within wrap, 2", () => {
			const a = new AsyncContext.Variable<Value>();
			const b = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};

			const [wrap1, wrap2] = a.run(first, () => {
				const wrap1 = AsyncContext.Snapshot.wrap(() => {
					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(undefined);

					b.run(second, () => {
						expect(a.get()).toEqual(first);
						expect(b.get()).toEqual(second);
					});

					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(undefined);
				});

				b.run(second, () => {});

				const wrap2 = AsyncContext.Snapshot.wrap(() => {
					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(undefined);

					b.run(second, () => {
						expect(a.get()).toEqual(first);
						expect(b.get()).toEqual(second);
					});

					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(undefined);
				});

				expect(a.get()).toEqual(first);
				expect(b.get()).toEqual(undefined);
				return [wrap1, wrap2] as const;
			});

			wrap1();
			wrap2();
			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
		});

		runTest("wrap within nesting contexts", () => {
			const ctx = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};

			const [firstWrap, secondWrap] = ctx.run(first, () => {
				const firstWrap = AsyncContext.Snapshot.wrap(() => {
					expect(ctx.get()).toEqual(first);
				});
				firstWrap();

				const secondWrap = ctx.run(second, () => {
					const secondWrap = AsyncContext.Snapshot.wrap(() => {
						firstWrap();
						expect(ctx.get()).toEqual(second);
					});
					firstWrap();
					secondWrap();
					expect(ctx.get()).toEqual(second);

					return secondWrap;
				});

				firstWrap();
				secondWrap();
				expect(ctx.get()).toEqual(first);

				return [firstWrap, secondWrap] as const;
			});

			firstWrap();
			secondWrap();
			expect(ctx.get()).toEqual(undefined);
		});

		runTest("wrap within nesting different contexts", () => {
			const a = new AsyncContext.Variable<Value>();
			const b = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};

			const [firstWrap, secondWrap] = a.run(first, () => {
				const firstWrap = AsyncContext.Snapshot.wrap(() => {
					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(undefined);
				});
				firstWrap();

				const secondWrap = b.run(second, () => {
					const secondWrap = AsyncContext.Snapshot.wrap(() => {
						firstWrap();
						expect(a.get()).toEqual(first);
						expect(b.get()).toEqual(second);
					});

					firstWrap();
					secondWrap();
					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(second);

					return secondWrap;
				});

				firstWrap();
				secondWrap();
				expect(a.get()).toEqual(first);
				expect(b.get()).toEqual(undefined);

				return [firstWrap, secondWrap] as const;
			});

			firstWrap();
			secondWrap();
			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
		});

		runTest("wrap within nesting different contexts, 2", () => {
			const a = new AsyncContext.Variable<Value>();
			const b = new AsyncContext.Variable<Value>();
			const c = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};
			const third = {id: 3};

			const wrap = a.run(first, () => {
				const wrap = b.run(second, () => {
					const wrap = c.run(third, () => {
						return AsyncContext.Snapshot.wrap(() => {
							expect(a.get()).toEqual(first);
							expect(b.get()).toEqual(second);
							expect(c.get()).toEqual(third);
						});
					});
					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(second);
					expect(c.get()).toEqual(undefined);
					return wrap;
				});
				expect(a.get()).toEqual(first);
				expect(b.get()).toEqual(undefined);
				expect(c.get()).toEqual(undefined);

				return wrap;
			});

			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
			expect(c.get()).toEqual(undefined);
			wrap();
			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
			expect(c.get()).toEqual(undefined);
		});

		runTest("wrap within nesting different contexts, 3", () => {
			const a = new AsyncContext.Variable<Value>();
			const b = new AsyncContext.Variable<Value>();
			const c = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};
			const third = {id: 3};

			const wrap = a.run(first, () => {
				const wrap = b.run(second, () => {
					AsyncContext.Snapshot.wrap(() => {});

					const wrap = c.run(third, () => {
						return AsyncContext.Snapshot.wrap(() => {
							expect(a.get()).toEqual(first);
							expect(b.get()).toEqual(second);
							expect(c.get()).toEqual(third);
						});
					});
					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(second);
					expect(c.get()).toEqual(undefined);
					return wrap;
				});
				expect(a.get()).toEqual(first);
				expect(b.get()).toEqual(undefined);
				expect(c.get()).toEqual(undefined);

				return wrap;
			});

			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
			expect(c.get()).toEqual(undefined);
			wrap();
			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
			expect(c.get()).toEqual(undefined);
		});

		runTest("wrap within nesting different contexts, 4", () => {
			const a = new AsyncContext.Variable<Value>();
			const b = new AsyncContext.Variable<Value>();
			const c = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};
			const third = {id: 3};

			const wrap = a.run(first, () => {
				AsyncContext.Snapshot.wrap(() => {});

				const wrap = b.run(second, () => {
					const wrap = c.run(third, () => {
						return AsyncContext.Snapshot.wrap(() => {
							expect(a.get()).toEqual(first);
							expect(b.get()).toEqual(second);
							expect(c.get()).toEqual(third);
						});
					});
					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(second);
					expect(c.get()).toEqual(undefined);
					return wrap;
				});
				expect(a.get()).toEqual(first);
				expect(b.get()).toEqual(undefined);
				expect(c.get()).toEqual(undefined);

				return wrap;
			});

			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
			expect(c.get()).toEqual(undefined);
			wrap();
			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
			expect(c.get()).toEqual(undefined);
		});

		runTest("wrap within nesting different contexts, 5", () => {
			const a = new AsyncContext.Variable<Value>();
			const b = new AsyncContext.Variable<Value>();
			const c = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};
			const third = {id: 3};

			const wrap = a.run(first, () => {
				const wrap = b.run(second, () => {
					const wrap = c.run(third, () => {
						return AsyncContext.Snapshot.wrap(() => {
							expect(a.get()).toEqual(first);
							expect(b.get()).toEqual(second);
							expect(c.get()).toEqual(third);
						});
					});

					AsyncContext.Snapshot.wrap(() => {});

					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(second);
					expect(c.get()).toEqual(undefined);
					return wrap;
				});
				expect(a.get()).toEqual(first);
				expect(b.get()).toEqual(undefined);
				expect(c.get()).toEqual(undefined);

				return wrap;
			});

			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
			expect(c.get()).toEqual(undefined);
			wrap();
			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
			expect(c.get()).toEqual(undefined);
		});

		runTest("wrap within nesting different contexts, 6", () => {
			const a = new AsyncContext.Variable<Value>();
			const b = new AsyncContext.Variable<Value>();
			const c = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};
			const third = {id: 3};

			const wrap = a.run(first, () => {
				const wrap = b.run(second, () => {
					const wrap = c.run(third, () => {
						return AsyncContext.Snapshot.wrap(() => {
							expect(a.get()).toEqual(first);
							expect(b.get()).toEqual(second);
							expect(c.get()).toEqual(third);
						});
					});
					expect(a.get()).toEqual(first);
					expect(b.get()).toEqual(second);
					expect(c.get()).toEqual(undefined);
					return wrap;
				});

				AsyncContext.Snapshot.wrap(() => {});

				expect(a.get()).toEqual(first);
				expect(b.get()).toEqual(undefined);
				expect(c.get()).toEqual(undefined);

				return wrap;
			});

			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
			expect(c.get()).toEqual(undefined);
			wrap();
			expect(a.get()).toEqual(undefined);
			expect(b.get()).toEqual(undefined);
			expect(c.get()).toEqual(undefined);
		});

		runTest("wrap out of order", () => {
			const ctx = new AsyncContext.Variable<Value>();
			const first = {id: 1};
			const second = {id: 2};

			const firstWrap = ctx.run(first, () => {
				return AsyncContext.Snapshot.wrap(() => {
					expect(ctx.get()).toEqual(first);
				});
			});
			const secondWrap = ctx.run(second, () => {
				return AsyncContext.Snapshot.wrap(() => {
					expect(ctx.get()).toEqual(second);
				});
			});

			firstWrap();
			secondWrap();
			firstWrap();
			secondWrap();
		});
	});
});
