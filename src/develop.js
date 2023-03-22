import * as Path from "path";
import * as FS from "fs/promises";
import {fileURLToPath, pathToFileURL} from "url";
import * as VM from "vm";
import * as ESBuild from "esbuild";
import * as Resolve from "./resolve.js";
import {createFetchServer} from "./server.js";

class Watcher {
	constructor(callback) {
		this.cache = new Map();
		this.callback = callback;
		this.plugin = {
			name: "watcher",
			setup: (build) => {
				build.onEnd(async (result) => {
					// TODO: errors in this callback seem to be swallowed
					const entry = build.initialOptions.entryPoints[0];
					const cacheValue = this.cache.get(entry);
					const initial = cacheValue.resolve != null;
					if (cacheValue.resolve) {
						cacheValue.resolve(result);
						cacheValue.resolve = null;
					}

					cacheValue.result = result;
					try {
						await callback({entry, result, initial}, this);
					} catch (err) {
						console.error(err);
					}
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

	async dispose() {
		for (const {ctx} of this.cache.values()) {
			await ctx.dispose();
		}
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


//interface ModuleCacheValue {
//	module: VM.SourceTextModule;
//	dependents: Set<string>;
//	hot: Hot;
//}
const moduleCache = new Map();
function createLink(watcher) {
	return async function link(specifier, referencingModule) {
		//console.log(`linking ${specifier} from ${referencingModule.identifier}`);
		const basedir = Path.dirname(fileURLToPath(referencingModule.identifier));
		// TODO: Let’s try to use require.resolve() here.
		const resolved = await Resolve.resolve(specifier, basedir);
		if (Resolve.isPathSpecifier(specifier)) {
			const url = pathToFileURL(resolved).href;
			const result = await watcher.build(resolved);
			const code = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text || "";

			// We don’t have to link this module because it will be linked by the
			// root module.
			if (moduleCache.has(resolved)) {
				console.log("moduleCache hit", resolved);
				return moduleCache.get(resolved).module;
			}

			// TODO: We need to cache modules
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

			moduleCache.set(resolved, {module, dependents: new Set()});
			return module;
		} else {
			// This is a bare module specifier so we import from node modules.
			const namespace = await import(resolved);
			const exports = Object.keys(namespace);
			return new VM.SyntheticModule(exports, function () {
				for (const key of exports) {
					this.setExport(key, namespace[key]);
				}
			});
		}
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

	process.on("SIGINT", async () => {
		server.close();
		await watcher.dispose();
		process.exit(0);
	});

	process.on("SIGTERM", async () => {
		server.close();
		await watcher.dispose();
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
		if (record.result.errors.length > 0) {
			const formatted = await ESBuild.formatMessages(record.result.errors, {
				kind: "error",
			});
			console.error(formatted.join("\n"));
		} else if (record.result.warnings.length > 0) {
			const formatted = await ESBuild.formatMessages(record.result.warnings, {
				kind: "warning",
			});
			console.warn(formatted.join("\n"));
		}

		// TODO: Rather than reloading the root module, we should bubble changes
		// from dependencies to dependents according to import.meta.hot
		if (!record.initial) {
			moduleCache.delete(record.entry);
			const rootResult = await watcher.build(file);
			await reload(rootResult);
		}
	});

	const link = createLink(watcher);
	async function reload(result) {
		const code = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text || "";
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

		try {
			await module.link(link);
			await module.evaluate();
			namespace = module.namespace;
		} catch (err) {
			console.error(err);
			namespace = null;
		}
	}

	const result = await watcher.build(file);
	await reload(result);
}
