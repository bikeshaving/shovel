/**
 * Macrotask scheduler for IndexedDB event dispatch.
 *
 * The IDB spec says events fire as "tasks" (macrotasks), not microtasks.
 * Using setImmediate (available in Node.js and Bun) yields to the event loop
 * between operations, allowing setTimeout callbacks to fire — matching
 * real browser behavior.
 */
export const scheduleTask: (fn: () => void) => void =
	typeof setImmediate !== "undefined"
		? setImmediate
		: (fn) => setTimeout(fn, 0);
