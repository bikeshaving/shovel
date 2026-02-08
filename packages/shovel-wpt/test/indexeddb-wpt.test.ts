/**
 * Actual WPT IndexedDB tests loaded via the shim.
 *
 * Loads the real WPT .any.js test files against our MemoryBackend.
 * Processes // META: script= directives to load support scripts.
 */

import {setupIndexedDBTestGlobals} from "../src/wpt/indexeddb-shim.js";
import {
	IDBFactory,
	IDBDatabase,
	IDBTransaction,
	IDBObjectStore,
	IDBRequest,
	IDBOpenDBRequest,
	IDBKeyRange,
	IDBIndex,
	IDBVersionChangeEvent,
	MemoryBackend,
} from "../../indexeddb/src/index.js";
import {flushTests, clearTestQueue} from "../src/harness/testharness.js";
import {test as bunTest} from "bun:test";
import {join} from "node:path";
import {readdirSync, readFileSync} from "node:fs";

const idbClasses = {
	IDBKeyRange,
	IDBDatabase,
	IDBTransaction,
	IDBObjectStore,
	IDBRequest,
	IDBOpenDBRequest,
	IDBIndex,
	IDBVersionChangeEvent,
};

const wptDir = join(import.meta.dir, "../wpt/IndexedDB");

/**
 * Load a WPT script into global scope via indirect eval.
 *
 * In a browser, <script src="support.js"> makes all function/var
 * declarations global. With require(), they'd be module-local.
 * Indirect eval in sloppy mode makes them globalThis properties.
 */
const loadedScripts = new Set<string>();

function loadWptScript(filePath: string): void {
	// Avoid loading the same script twice per test file
	if (loadedScripts.has(filePath)) return;
	loadedScripts.add(filePath);

	let code = readFileSync(filePath, "utf8");

	// Strip 'use strict' — in sloppy-mode indirect eval,
	// function/var declarations become globalThis properties
	code = code.replace(/^'use strict';?\s*$/m, "");

	// Convert top-level const/let to var so they also become global.
	// Only matches unindented declarations (top-level).
	code = code.replace(/^(const|let) /gm, "var ");

	// Strip META directives (they're comments, harmless, but let's be clean)
	// and recursively load referenced scripts
	const lines = code.split("\n");
	for (const line of lines) {
		const match = line.match(/^\/\/ META: script=(.+)$/);
		if (match) {
			const scriptPath = match[1].trim();
			// Only load relative paths (not /resources/... which are global WPT infra)
			if (!scriptPath.startsWith("/")) {
				const dir = filePath.substring(0, filePath.lastIndexOf("/"));
				loadWptScript(join(dir, scriptPath));
			}
		}
	}

	// Run in global scope
	(0, eval)(code);
}

/**
 * Parse META directives from a test file and load support scripts.
 */
function loadMetaScripts(testFilePath: string): void {
	const content = readFileSync(testFilePath, "utf8");
	const lines = content.split("\n");

	for (const line of lines) {
		const match = line.match(/^\/\/ META: script=(.+)$/);
		if (match) {
			const scriptPath = match[1].trim();
			if (!scriptPath.startsWith("/")) {
				loadWptScript(join(wptDir, scriptPath));
			}
		}
		// Stop scanning after first non-comment, non-empty line
		if (line.trim() && !line.startsWith("//") && !line.startsWith("'use strict'")) {
			break;
		}
	}
}

/**
 * WPT test files to load. Skip tests that require unimplemented features.
 */
const skip = [
	// Blob storage
	"blob-",
	// IDL harness (tests interface shapes, not behavior)
	"idlharness",
	// Structured clone of complex types (Map, Set, RegExp, etc.)
	"structured-clone",
	"nested-cloning",
	"clone-before-keypath",
	"value.any.js",
	"value_recursive",
	// Transaction scheduling (requires connection queuing)
	"transaction-scheduling",
	"writer-starvation",
	"open-request-queue",
	// Rename operations
	"rename",
	// Storage buckets (requires storage API)
	"storage-buckets",
	// Bindings injection (tests V8/SpiderMonkey-specific behavior)
	"bindings-inject",
	// Binary keys with detached buffers
	"idb-binary-key-detached",
	// Large request tests (performance-oriented)
	"large-requests",
	// Request ordering tests (depend on async scheduling details)
	"request-event-ordering",
	"request-abort-ordering",
	// Parallel cursors during upgrade
	"parallel-cursors",
	// SameObject identity checks (our impl creates new wrappers)
	"SameObject",
	// Exception ordering (tests precise throw order per spec)
	"exception-order",
	// Interleaved cursors (complex cursor scheduling)
	"interleaved-cursors",
	// Tests using setTimeout/keep_alive (hang: microtask chains starve event loop)
	"event-dispatch-active-flag",
	"transaction-deactivation-timing",
	"upgrade-transaction-deactivation-timing",
	"transaction-lifetime",
	"upgrade-transaction-lifecycle",
	// Fire-exception tests (test error propagation through dispatchEvent)
	"fire-error-event",
	"fire-success-event",
	"fire-upgradeneeded-event",
	// Request bubble/capture (needs DOM event propagation)
	"bubble-and-capture",
	// Transaction create in versionchange
	"transaction-create_in_versionchange",
	// getAllRecords (uses IDBRecord class we don't implement)
	"getAllRecords",
	// Explicit commit (uses commit() synchronously in ways that conflict with our auto-commit)
	"idb-explicit-commit",
	// Transaction requestqueue (uses keep_alive pattern)
	"transaction-requestqueue",
	// Get databases (uses sleep_sync busy-wait for 1000ms)
	"get-databases",
	// Historical interface checks (IDBCursor class not exposed)
	"historical",
	// Binary key conversion (typed array edge cases)
	"idb_binary_key_conversion",
];

const wptFiles = readdirSync(wptDir)
	.filter((f) => f.endsWith(".any.js"))
	.filter((f) => !skip.some((s) => f.includes(s)))
	.sort();

for (const file of wptFiles) {
	// Fresh backend per file so tests don't interfere
	setupIndexedDBTestGlobals({
		indexedDB: new IDBFactory(new MemoryBackend()),
		classes: idbClasses,
	});

	// Reset loaded scripts tracker and test queue
	loadedScripts.clear();
	clearTestQueue();

	try {
		// Load META-referenced support scripts into global scope
		loadMetaScripts(join(wptDir, file));

		// Load the test file via indirect eval (same as support scripts).
		// require() would run in bun's module scope where `test` is
		// bun:test's version, shadowing our WPT `test` wrapper.
		loadWptScript(join(wptDir, file));

		flushTests(`WPT: ${file.replace(".any.js", "")}`, {timeout: 2000});
	} catch (e) {
		bunTest(`WPT: ${file} (load error)`, () => {
			throw e;
		});
		clearTestQueue();
	}
}
