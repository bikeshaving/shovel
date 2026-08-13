/**
 * Transaction scheduler — serializes transactions with overlapping scopes.
 *
 * Per the IDB spec, readwrite transactions with overlapping object store
 * scopes must run one at a time in creation order.  Readonly transactions
 * may overlap.  A transaction can start when no earlier conflicting entry
 * is still queued or active.
 */

export interface SchedulerEntry {
	scope: string[];
	mode: string;
	startFn: () => void;
}

export class TransactionScheduler {
	#queue: SchedulerEntry[];
	#active: Set<SchedulerEntry>;

	constructor() {
		this.#queue = [];
		this.#active = new Set();
	}

	/**
	 * Enqueue a transaction.  If no conflicts exist it starts immediately
	 * (synchronously calling startFn).
	 */
	enqueue(scope: string[], mode: string, startFn: () => void): SchedulerEntry {
		const entry: SchedulerEntry = {scope, mode, startFn};
		this.#queue.push(entry);
		this.#drain();
		return entry;
	}

	/**
	 * Mark a transaction as finished (committed or aborted).
	 * Removes from active set and tries to start waiting transactions.
	 */
	done(entry: SchedulerEntry): void {
		this.#active.delete(entry);
		// Also remove from queue if it was aborted before starting
		const idx = this.#queue.indexOf(entry);
		if (idx >= 0) this.#queue.splice(idx, 1);
		this.#drain();
	}

	#drain(): void {
		const toStart: SchedulerEntry[] = [];
		const waiting: SchedulerEntry[] = [];

		for (const entry of this.#queue) {
			if (this.#canStart(entry, toStart, waiting)) {
				toStart.push(entry);
				this.#active.add(entry);
			} else {
				waiting.push(entry);
			}
		}

		this.#queue = waiting;

		for (const entry of toStart) {
			entry.startFn();
		}
	}

	/**
	 * An entry can start when it doesn't conflict with any active
	 * transaction, any entry about to start in this drain pass, or
	 * any earlier entry still waiting in the queue.
	 */
	#canStart(
		entry: SchedulerEntry,
		starting: SchedulerEntry[],
		waiting: SchedulerEntry[],
	): boolean {
		for (const active of this.#active) {
			if (this.#conflicts(active, entry)) return false;
		}
		for (const s of starting) {
			if (this.#conflicts(s, entry)) return false;
		}
		for (const w of waiting) {
			if (this.#conflicts(w, entry)) return false;
		}
		return true;
	}

	#conflicts(a: SchedulerEntry, b: SchedulerEntry): boolean {
		if (a.mode === "readonly" && b.mode === "readonly") return false;
		return a.scope.some((s) => b.scope.includes(s));
	}
}
