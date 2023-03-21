import * as Path from "path";
import * as FS from "fs/promises";
import {fileURLToPath, pathToFileURL} from "url";
import * as VM from "vm";
import * as ESBuild from "esbuild";
import MagicString from "magic-string";
import * as Resolve from "./resolve.js";
import {createFetchServer} from "./server.js";

class Watcher {
	// TODO: what is the type of the callback?
	constructor(callback) {
		this.cache = new Map();
		this.callback = callback;
		this.plugin = {
			name: "watcher",
			setup: (build) => {
				build.onEnd((result) => {
					// TODO: errors in this callback seem to be swallowed
					const entry = build.initialOptions.entryPoints[0];
					const cacheValue = this.cache.get(entry);
					const isInitial = cacheValue.resolve != null;
					if (cacheValue.resolve) {
						cacheValue.resolve(result);
						cacheValue.resolve = null;
					}
					cacheValue.result = result;
					callback({
						entry,
						result,
						isInitial,
					}, this);
				});
			},
		};
	}

	build(entry) {
		if (this.cache.has(entry)) {
			return this.cache.get(entry).result;
		}

		const ctxP = createESBuildContext(entry, [this.plugin]);
		let resolve = null;
		const cacheValue = {
			entry,
			ctx: ctxP,
			result: new Promise((r) => (resolve = r)),
			resolve,
		};
		this.cache.set(entry, cacheValue);
		ctxP.then((ctx) => {
			ctx.watch();
			cacheValue.ctx = ctx;
		});

		return cacheValue.result;
	}
}

function createESBuildContext(entry, plugins) {
	return ESBuild.context({
		entryPoints: [entry],
		plugins,
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
	});
}

function createLink(watcher) {
	return async function link(specifier, referencingModule) {
		const basedir = Path.dirname(fileURLToPath(referencingModule.identifier));
		const resolved = await Resolve.resolve(specifier, basedir);
		if (Resolve.isPathSpecifier(specifier)) {
			const url = pathToFileURL(resolved).href;
			const result = await watcher.build(resolved);
			const code = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
			return new VM.SourceTextModule(code, {
				identifier: url,
				initializeImportMeta(meta) {
					meta.url = url;
				},
				async importModuleDynamically(specifier, referencingModule) {
					const linked = await link(specifier, referencingModule);
					await linked.link(link);
					await linked.evaluate();
					return linked;
				},
			});
		}

		// This is a bare module specifier so we import from node modules.
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
	file = Path.resolve(process.cwd(), file);
	const port = parseInt(options.port);
	if (Number.isNaN(port)) {
		throw new Error("Invalid port", options.port);
	}

	process.on("uncaughtException", (err) => {
		console.error(err);
	});

	process.on("unhandledRejection", (err) => {
		console.error(err);
	});

	process.on("SIGINT", () => {
		server.close();
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		server.close();
		process.exit(0);
	});

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

	server.listen(port, () => {
		console.info("listening on port:", port);
	});

	const watcher = new Watcher(async (record, watcher) => {
		console.info(`${record.isInitial ? "building" : "rebuilding"}: ${record.entry}`);
		// TODO: Rather than reloading the root module, we should bubble changes
		// from dependencies to dependents according to import.meta.hot
		if (!record.isInitial) {
			const rootResult = await watcher.build(file);
			const code = rootResult.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
			const url = pathToFileURL(file).href;
			const module = new VM.SourceTextModule(code, {
				identifier: url,
				initializeImportMeta(meta) {
					meta.url = url;
				},
				async importModuleDynamically(specifier, referencingModule) {
					const linked = await link(specifier, referencingModule);
					await linked.link(link);
					await linked.evaluate();
					return linked;
				},
			});

			await module.link(link);
			await module.evaluate();
			namespace = module.namespace;
		}
	});

	const link = createLink(watcher);
	const result = await watcher.build(file);
	const code = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
	const url = pathToFileURL(file).href;
	const module = new VM.SourceTextModule(code, {
		identifier: url,
		initializeImportMeta(meta) {
			meta.url = url;
		},
		async importModuleDynamically(specifier, referencingModule) {
			const linked = await link(specifier, referencingModule);
			await linked.link(link);
			await linked.evaluate();
			return linked;
		},
	});

	await module.link(link);
	await module.evaluate();
	namespace = module.namespace;
}
