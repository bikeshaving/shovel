/**
 * Macrotask scheduler for IndexedDB event dispatch.
 *
 * The IDB spec says events fire as "tasks" (macrotasks), not microtasks.
 * We use setImmediate which fires in the "check" phase — after the
 * current task's microtask checkpoint but before setTimeout(0) callbacks.
 * This ordering is critical: the "blocked" event (dispatched via
 * scheduleTask) must fire before setTimeout(0) callbacks that close
 * connections.
 */
export function scheduleTask(fn: () => void): void {
	setImmediate(fn);
}
