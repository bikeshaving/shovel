/**
 * Macrotask scheduler for IndexedDB event dispatch.
 *
 * The IDB spec says events fire as "tasks" (macrotasks), not microtasks.
 * setImmediate (Node.js/Bun) is preferred for performance; setTimeout(0)
 * is the standard fallback.
 */
export const scheduleTask: (fn: () => void) => void =
	typeof setImmediate !== "undefined"
		? setImmediate
		: (fn) => setTimeout(fn, 0);
