import * as Path from "path";
import * as FS from "fs/promises";
import {fileURLToPath, pathToFileURL} from "url";
import * as VM from "vm";
import {formatMessages} from "esbuild";
import * as Resolve from "./_resolve.js";
import {createFetchServer} from "./_server.js";
import {Watcher} from "./_esbuild.js";

// The key is the absolute path to the module as a string.
// The value is an object with the following interface.
//
//interface ModuleCacheValue {
//	module: VM.SourceTextModule;
//	dependents: Set<string>;
//	hot: Hot;
//}
function createLink(callback, moduleCache) {
	return async function link(specifier, referencingModule) {
		const basedir = Path.dirname(fileURLToPath(referencingModule.identifier));
		// TODO: Let’s try to use require.resolve() here.
		const resolved = await Resolve.resolve(specifier, basedir);
		if (Resolve.isPathSpecifier(specifier)) {
			const result = await callback(resolved);
			const code = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text || "";

			// We don’t have to link this module because it will be linked by the
			// root module.
			if (moduleCache.has(resolved)) {
				const {module, dependents} = moduleCache.get(resolved);
				dependents.add(fileURLToPath(referencingModule.identifier).href);
				return module;
			}

			const url = pathToFileURL(resolved).href;
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

			moduleCache.set(resolved, {
				module,
				dependents: new Set([fileURLToPath(referencingModule.identifier)])
			});
			return module;
		} else {
			// This is a bare module specifier so we import from node modules.
			if (resolved == null) {
				throw new Error(`Could not resolve ${specifier}`);
			}

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

export async function develop(file, options) {
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

	const moduleCache = new Map();
	const watcher = new Watcher(async (record, watcher) => {
		if (record.result.errors.length > 0) {
			const formatted = await formatMessages(record.result.errors, {
				kind: "error",
			});
			console.error(formatted.join("\n"));
		} else if (record.result.warnings.length > 0) {
			const formatted = await formatMessages(record.result.warnings, {
				kind: "warning",
			});
			console.warn(formatted.join("\n"));
		}

		// TODO: Rather than reloading the root module, we should bubble changes
		// from dependencies to dependents according to import.meta.hot
		if (!record.initial) {
			const queue = [record.entry];
			while (queue.length > 0) {
				const entry = queue.shift();
				const dependents = moduleCache.get(entry)?.dependents;
				if (dependents) {
					for (const dependent of dependents) {
						queue.push(dependent);
					}
				}

				moduleCache.delete(entry);
			}

			const rootResult = await watcher.build(file);
			await reload(rootResult);
		}
	});

	const link = createLink((resolved) => watcher.build(resolved), moduleCache);
	async function reload(result) {
		const javascript = result.outputFiles.find((file) =>
			file.path.endsWith(".js")
		)?.text || "";
		const url = pathToFileURL(file).href;
		const module = new VM.SourceTextModule(javascript, {
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
	return server;
}
