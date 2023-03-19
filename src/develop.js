import * as Path from "path";
import * as FS from "fs/promises";
import {fileURLToPath, pathToFileURL} from "url";
import * as VM from "vm";
import * as ESBuild from "esbuild";
import MagicString from "magic-string";
import {Repeater} from "@repeaterjs/repeater";
import * as Resolve from "./resolve.js";
import {createFetchServer} from "./server.js";

const ctxs = [];
function watch(entry, watcherCache = new Map()) {
	return new Repeater(async (push, stop) => {
		if (watcherCache.has(entry)) {
			push((await watcherCache.get(entry)).result);
			stop();
			return;
		}

		let resolve;
		watcherCache.set(entry, {
			result: new Promise((r) => (resolve = r)),
		});
		const watchPlugin = {
			name: "watch",
			setup(build) {
				// This is called every time a module is edited.
				build.onEnd((result) => {
					resolve(result);
					push(result);
					watcherCache.set(entry, {result});
				});
			},
		};
		const ctx = await ESBuild.context({
			entryPoints: [entry],
			format: "esm",
			platform: "node",
			bundle: false,
			metafile: true,
			write: false,
			packages: "external",
			sourcemap: "both",
			// We need this to export map files.
			outdir: "dist",
			logLevel: "silent",
			plugins: [watchPlugin],
		});
		ctxs.push(ctx);
		await ctx.watch();
		await stop;
		ctx.dispose();
		watcherCache.delete(entry);
	});
}

function createLink(reloadRootModule, watcherCache) {
	return async function link(specifier, referencingModule) {
		const basedir = Path.dirname(fileURLToPath(referencingModule.identifier));
		const resolved = await Resolve.resolve(specifier, basedir);
		if (Resolve.isPathSpecifier(specifier)) {
			const iterator = watch(resolved, watcherCache);
			const {value: firstResult} = await iterator.next();

			(async () => {
				for await (const result of iterator) {
					await reloadRootModule();
				}
			})();

			const code = firstResult.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
			const depURL = pathToFileURL(resolved).href;
			return new VM.SourceTextModule(code || "", {
				identifier: depURL,
				initializeImportMeta(meta) {
					meta.url = depURL;
				},
				async importModuleDynamically(specifier, referencingModule) {
					const linked = await link(specifier, referencingModule);
					await linked.link(link);
					await linked.evaluate();
					return linked;
				},
			});
		}

		const child = await import(resolved);
		const exports = Object.keys(child);
		return new VM.SyntheticModule(exports, function () {
			for (const key of exports) {
				this.setExport(key, child[key]);
			}
		});
	};
}

export default async function develop(file, options) {
	const port = parseInt(options.port);
	let namespace = null;
	const server = createFetchServer(async function fetcher(req) {
		if (typeof namespace?.default?.fetch === "function") {
			try {
				return await namespace?.default?.fetch(req);
			} catch (err)	{
				console.error(err);
				return new Response(err.stack, {
					status: 500,
				});
			}
		}

		return new Response("Server not ready", {
			status: 500,
		});
	});

	process.on("uncaughtException", (err) => {
		console.error(err);
	});

	process.on("unhandledRejection", (err) => {
		console.error(err);
	});

	process.on("SIGINT", () => {
		server.close();
		ctxs.forEach((ctx) => ctx.dispose());
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		server.close();
		ctxs.forEach((ctx) => ctx.dispose());
		process.exit(0);
	});

	server.listen(port, () => {
		console.info("listening on port:", port);
	});

	const watcherCache = new Map();
	for await (const result of watch(file, watcherCache)) {
		if (result.errors && result.errors.length) {
			const formatted = await ESBuild.formatMessages(result.errors, {
				kind: "error",
				color: true,
			});
			console.error(formatted.join("\n"));
			continue;
		}

		const code = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
		const map = result.outputFiles.find((file) => file.path.endsWith(".map"))?.text;
		const link = createLink(reloadRootModule, watcherCache);
		// TODO: Move to top-level scope.
		async function reloadRootModule() {
			const rootURL = pathToFileURL(file).href;
			const module = new VM.SourceTextModule(code, {
				identifier: rootURL,
				initializeImportMeta(meta) {
					meta.url = rootURL;
				},
				async importModuleDynamically(specifier, referencingModule) {
					const linked = await link(specifier, referencingModule);
					await linked.link(link);
					await linked.evaluate();
					return linked;
				},
			});

			try {
				await module.link(link);
				await module.evaluate();
			} catch (err) {
				console.error(err);
				return;
			}

			namespace = module.namespace;
			console.info("built:", rootURL);
		}

		await reloadRootModule();
	}
}
