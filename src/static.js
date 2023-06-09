import * as Path from "path";
import * as FS from "fs/promises";
import {fileURLToPath, pathToFileURL} from "url";
import * as VM from "vm";
import {formatMessages} from "esbuild";

// TODO: The static workflow is run once so we don’t need to watch files.
import {Watcher} from "./_esbuild.js";
import * as Resolve from "./_resolve.js";

// TODO: This code is duplicated in ./develop.js so it should be moved to a
// module-specific file.

//interface ModuleCacheValue {
//	module: VM.SourceTextModule;
//	dependents: Set<string>;
//	hot: Hot;
//}
const moduleCache = new Map();
function createLink(watcher) {
	return async function link(specifier, referencingModule) {
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
				moduleCache.get(resolved).dependents.add(fileURLToPath(referencingModule.identifier));
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

			moduleCache.set(resolved, {
				module,
				dependents: new Set([fileURLToPath(referencingModule.identifier)])
			});
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

export async function static_(file, options) {
	file = Path.resolve(process.cwd(), file);
	process.on("SIGINT", async () => {
		await watcher.dispose();
		process.exit(0);
	});

	process.on("SIGTERM", async () => {
		await watcher.dispose();
		process.exit(0);
	});

	const watcher = new Watcher(async (record, watcher) => {
		if (record.result.errors.length > 0) {
			const formatted = await formatMessages(record.result.errors, {
				kind: "error",
			});
			console.error(formatted.join("\n"));
			process.exit(1);
		} else if (record.result.warnings.length > 0) {
			const formatted = await formatMessages(record.result.warnings, {
				kind: "warning",
			});
			console.warn(formatted.join("\n"));
			process.exit(0);
		}
	});

	const result = await watcher.build(file);
	const code = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text || "";
	const url = pathToFileURL(file).href;
	const link = createLink(watcher);
	const module = new VM.SourceTextModule(code, {
		identifier: url,
		initializeImportMeta(meta) {
			meta.url = url;
		},
		async importModuleDynamically(specifier, referencingModule) {
			// TODO: link is not defined so I dunno how this works.
			const linked = await link(specifier, referencingModule);
			await linked.link(link);
			await linked.evaluate();
			return linked;
		},
	});

	await module.link(link);
	await module.evaluate();
	const namespace = module.namespace;
	const dist = Path.resolve(process.cwd(), options.outDir);
	const paths = await namespace.default?.staticPaths?.(dist);
	if (paths) {
		for await (const path of paths) {
			const req = new Request(pathToFileURL(path).href);
			const res = await namespace.default?.fetch?.(req);
			const body = await res.text();
			// TODO: we need an alternative to /index.html style builds.
			const file = Path.resolve(dist, path.replace(/^\//, ""), "index.html");
			console.info(`Writing: ${file}`);
			// ensure directory exists
			await FS.mkdir(Path.dirname(file), {recursive: true});
			await FS.writeFile(file, body);
		}
	}

	process.exit(0);
}
