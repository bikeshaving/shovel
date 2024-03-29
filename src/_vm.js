import * as Path from "path";
import * as VM from "vm";

import {fileURLToPath, pathToFileURL} from "url";
import * as Resolve from "./_resolve.js";

export function createLink(buildObserver, moduleCache = new Map()) {
	return async function link(specifier, referencingModule) {
		const basedir = Path.dirname(fileURLToPath(referencingModule.identifier));
		// TODO: Let’s try to use require.resolve() here.
		const resolvedSpecifier = await Resolve.resolve(specifier, basedir);
		if (Resolve.isPathSpecifier(specifier)) {
			const result = await buildObserver.build(resolvedSpecifier);
			const code = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text || "";

			// We don’t have to link this module because it will be linked by the
			// root module.
			if (moduleCache.has(resolvedSpecifier)) {
				const {module, dependents} = moduleCache.get(resolvedSpecifier);
				dependents.add(fileURLToPath(referencingModule.identifier).href);
				return module;
			}

			const url = pathToFileURL(resolvedSpecifier).href;
			// TODO: We need to cache modules
			const module = new VM.SourceTextModule(code, {
				identifier: url,
				initializeImportMeta(meta) {
					meta.url = url;
				},
				async importModuleDynamically(specifier, referencingModule) {
					const linkedModule = await link(specifier, referencingModule);
					await linkedModule.link(link);
					await linkedModule.evaluate();
					return linkedModule;
				},
			});

			moduleCache.set(resolvedSpecifier, {
				module,
				dependents: new Set([fileURLToPath(referencingModule.identifier)])
			});
			return module;
		} else {
			// This is a bare module specifier so we import from node modules.
			if (resolvedSpecifier == null) {
				throw new Error(`Could not resolve ${specifier}`);
			}

			const namespace = await import(resolvedSpecifier);
			const exports = Object.keys(namespace);
			return new VM.SyntheticModule(exports, function () {
				for (const key of exports) {
					this.setExport(key, namespace[key]);
				}
			});
		}
	}
}
