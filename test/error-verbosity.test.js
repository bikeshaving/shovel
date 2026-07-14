import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {test, expect} from "bun:test";
import {buildForProduction} from "../src/commands/build.js";
import {ServerBundler} from "../src/utils/bundler.js";
import {loadPlatformModule} from "../src/utils/platform.js";

/**
 * Error verbosity must fail closed (#91, #100).
 *
 * The verbose error page renders `error.stack` into the response body. It is
 * gated on `import.meta.env.MODE === "development"`, and the bundler bakes MODE
 * in at build time. Platforms with no populated import.meta.env (Cloudflare)
 * left MODE undefined, and the old `MODE !== "production"` test then served
 * stack traces to the public.
 *
 * These assert on the built server bundle: the gate must be constant-folded, so
 * the verbose branch is statically unreachable in a production build. Bare
 * `import.meta.env` reads are fine — that's the env-var accessor, not the gate.
 */

const TIMEOUT = 20000;

const ENTRY = `
import {Router} from "@b9g/router";
const router = new Router();
router.get("/boom", () => {
	throw new Error("boom");
});
self.addEventListener("fetch", (event) => {
	event.respondWith(router.fetch(event.request));
});
`;

async function makeProject() {
	const root = await FS.mkdtemp(join(tmpdir(), "error-verbosity-"));
	const entrypoint = join(root, "entry.js");
	await FS.writeFile(entrypoint, ENTRY);
	return {root, entrypoint, outDir: join(root, "dist")};
}

async function readServerBundle(outDir) {
	const serverDir = join(outDir, "server");
	const files = await FS.readdir(serverDir);
	const sources = await Promise.all(
		files
			.filter((f) => f.endsWith(".js"))
			.map((f) => FS.readFile(join(serverDir, f), "utf8")),
	);
	return sources.join("\n");
}

for (const platform of ["cloudflare", "node", "bun"]) {
	test(
		`${platform} production build cannot render the verbose error page`,
		async () => {
			const {entrypoint, outDir} = await makeProject();
			await buildForProduction({entrypoint, outDir, verbose: false, platform});
			const bundle = await readServerBundle(outDir);

			// The gate must be resolved at build time, not left to a
			// possibly-undefined import.meta.env at the edge.
			expect(bundle).not.toMatch(/import\.meta\.env\??\.MODE/);

			// It collapses to a constant, so the verbose branch is unreachable.
			expect(bundle).toMatch(/isDev\s*=\s*(false|!1)\b/);
			expect(bundle).not.toMatch(/isDev\s*=\s*(true|!0)\b/);
		},
		TIMEOUT,
	);
}

test(
	"development build still renders the verbose error page",
	async () => {
		const {entrypoint, outDir} = await makeProject();
		const platformModule = await loadPlatformModule("node");
		const bundler = new ServerBundler({
			entrypoint,
			outDir,
			platformModule,
			platformESBuildConfig: platformModule.getESBuildConfig(),
			development: true,
		});
		await bundler.build();
		const bundle = await readServerBundle(outDir);

		// Guards against over-correcting the fix into killing dev diagnostics.
		expect(bundle).toMatch(/isDev\s*=\s*(true|!0)\b/);
	},
	TIMEOUT,
);
