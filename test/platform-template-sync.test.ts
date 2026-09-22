import {readFileSync} from "fs";
import {join} from "path";
import {test, expect, describe} from "bun:test";

/**
 * Guards against dual-platform-file drift in the generated worker templates.
 *
 * Each platform package has TWO files with getEntryPoints() — platform.ts
 * (used by the build system via loadPlatformModule) and index.ts (the
 * runtime class). Changes to codegen must land in BOTH, and history shows
 * they drift: the #85 review found the WS upgrade handler missing from
 * node's index.ts template, the BroadcastChannel relay missing from bun's
 * platform.ts template (multi-worker fan-out silently dropped in real
 * builds), and builtinModules spread back into external in one file.
 * These are source-level assertions, deliberately cheap: they read the
 * template strings, not built output.
 */

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const nodePair = [
	"packages/platform-node/src/platform.ts",
	"packages/platform-node/src/index.ts",
];
const bunPair = [
	"packages/platform-bun/src/platform.ts",
	"packages/platform-bun/src/index.ts",
];

describe("node templates", () => {
	for (const file of nodePair) {
		test(`${file} wires the WS upgrade handler in direct mode`, () => {
			const s = read(file);
			expect(s).toContain(
				"attachNodeWebSocketHandler(server.httpServer, registration)",
			);
		});

		test(`${file} does not spread builtinModules into external`, () => {
			expect(read(file)).not.toContain("...builtinModules");
		});
	}
});

describe("bun templates", () => {
	for (const file of bunPair) {
		test(`${file} wires the BroadcastChannel relay (multi-worker fan-out)`, () => {
			const s = read(file);
			expect(s).toContain("setBroadcastChannelRelay((channelName, data)");
			expect(s).toContain('event.data.type === "broadcast:deliver"');
		});

		test(`${file} drains in-flight requests before force-stopping`, () => {
			const s = read(file);
			expect(s).toContain("await server.stop()");
		});
	}
});

describe("cloudflare templates", () => {
	const cfPair = [
		"packages/platform-cloudflare/src/platform.ts",
		"packages/platform-cloudflare/src/index.ts",
	];
	for (const file of cfPair) {
		test(`${file} re-exports both Durable Objects for wrangler binding`, () => {
			const s = read(file);
			expect(s).toContain(
				'export { ShovelWebSocketDO } from "@b9g/platform-cloudflare/websocket-do";',
			);
			expect(s).toContain(
				'export { ShovelPubSubDO } from "@b9g/platform-cloudflare/pubsub";',
			);
		});

		test(`${file} registers the asset manifest at startup`, () => {
			expect(read(file)).toContain("setAssetsManifest(__shovelAssetsManifest)");
		});
	}
});

describe("no bare transitive imports in generated code", () => {
	// Generated entries resolve imports from the user's project root, where
	// these packages are transitive — bare imports break pnpm-isolated and
	// Yarn PnP layouts (#111/#112 bug class; #114 tracks @b9g/platform).
	for (const file of [...nodePair, ...bunPair]) {
		test(`${file} templates avoid @logtape/logtape and @b9g/node-webworker`, () => {
			const s = read(file);
			// Split off the module's own imports (top of file, resolved in the
			// package's context) — only template string literals matter. All
			// template code lives inside backtick strings assigned after the
			// first template marker.
			const firstTemplate = s.indexOf("Code = `");
			expect(firstTemplate).toBeGreaterThan(-1);
			const templates = s.slice(firstTemplate);
			expect(templates).not.toContain('from "@logtape/logtape"');
			expect(templates).not.toContain('from "@b9g/node-webworker"');
		});
	}
});
