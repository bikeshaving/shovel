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
	IDBCursor,
	IDBCursorWithValue,
	IDBVersionChangeEvent,
	MemoryBackend,
} from "../../indexeddb/src/index.js";
import {
	flushTests,
	clearTestQueue,
	filterTestQueue,
} from "../src/harness/testharness.js";
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
	IDBCursor,
	IDBCursorWithValue,
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
		if (
			line.trim() &&
			!line.startsWith("//") &&
			!line.startsWith("'use strict'")
		) {
			break;
		}
	}
}

/**
 * WPT test files to load. Skip tests that require unimplemented features.
 */
const skip = [
	// Blob content type (requires Blob.type propagation through IDB)
	"blob-contenttype",
	// IDL harness (tests interface shapes via WebIDL, not behavior)
	"idlharness",
	// Bindings injection (tests V8/SpiderMonkey-specific behavior)
	"bindings-inject",
	// Storage buckets (requires storage API)
	"storage-buckets",
];

/**
 * Per-test skip patterns — skip individual tests within a file by name substring.
 * Used for tests that hang due to microtask starvation (keepAlive + setTimeout).
 */
const skipTests: Record<string, string[]> = {
	// Needs per-listener microtask checkpointing (browser-only behavior)
	"transaction-deactivation-timing.any.js": ["end of invocation"],
	// DOM geometry/image types — stubs don't survive v8 serialize round-trip
	"structured-clone.any.js": [
		"DOMMatrixStub",
		"DOMMatrixStub",
		"DOMPointStub",
		"DOMPointReadOnlyStub",
		"DOMRectStub",
		"DOMRectReadOnlyStub",
		"ImageDataStub",
	],
};

const wptFiles = readdirSync(wptDir)
	.filter((f) => f.endsWith(".any.js"))
	.filter((f) => !skip.some((s) => f.includes(s)))
	.sort();

// Single shared factory — database names include timestamps and random suffixes
// so tests don't collide. Using one factory avoids the problem where
// self.indexedDB changes between test registration and bun:test execution.
const sharedFactory = new IDBFactory(new MemoryBackend());

// Files that need their own factory (e.g. get-databases uses deleteAllDatabases
// which blocks on connections from prior test files)
const needsFreshFactory = new Set([
	"get-databases.any.js",
	"open-request-queue.any.js",
]);

for (const file of wptFiles) {
	const factory = needsFreshFactory.has(file)
		? new IDBFactory(new MemoryBackend())
		: sharedFactory;
	setupIndexedDBTestGlobals({
		indexedDB: factory,
		classes: idbClasses,
		filePath: file,
	});

	// Reset loaded scripts tracker and test queue
	loadedScripts.clear();
	clearTestQueue();

	try {
		// Load META-referenced support scripts into global scope
		loadMetaScripts(join(wptDir, file));

		// Load the test file wrapped in an IIFE so its local function
		// declarations (e.g. setOnUpgradeNeeded, createObjectStoreWithIndexAndPopulate)
		// don't leak to globalThis. Without this, later files overwrite earlier
		// files' functions, causing "Index not found" errors when bun:test
		// runs tests from earlier files that reference the wrong version.
		// Support scripts (loaded by loadMetaScripts above) are NOT wrapped
		// because they need to be global (createdb, assert_key_equals, etc.).
		let testCode = readFileSync(join(wptDir, file), "utf8");
		testCode = testCode.replace(/^'use strict';?\s*$/m, "");
		testCode = testCode.replace(/^(const|let) /gm, "var ");
		(0, eval)(`(function() {\n${testCode}\n})();`);

		// Remove individual tests that would hang (e.g. keepAlive + setTimeout)
		if (skipTests[file]) {
			filterTestQueue(skipTests[file]);
		}

		// Tests with many concurrent cursors or complex FIFO interactions
		// can take longer under load.
		const needsLongTimeout =
			file === "interleaved-cursors-large.any.js" ||
			file === "open-request-queue.any.js" ||
			file === "upgrade-transaction-deactivation-timing.any.js";
		const timeout = needsLongTimeout ? 10000 : 5000;
		flushTests(`WPT: ${file.replace(".any.js", "")}`, {
			timeout,
			// Pass the factory so tests using a fresh factory get it restored
			// at run time (globalThis.indexedDB is overwritten by later files).
			...(needsFreshFactory.has(file) ? {indexedDB: factory} : {}),
		});
	} catch (e) {
		bunTest(`WPT: ${file} (load error)`, () => {
			throw e;
		});
		clearTestQueue();
	}
}
