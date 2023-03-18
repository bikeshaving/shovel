import * as Path from "path";
import * as FS from "fs/promises";
import {fileURLToPath, pathToFileURL} from "url";
import * as VM from "vm";
import * as ESBuild from "esbuild";
import MagicString from "magic-string";
import {Repeater} from "@repeaterjs/repeater";
import {isPathSpecifier, resolve} from "./resolve.js";
import {createFetchServer} from "./server.js";
import {Hot, disposeHot} from "./hot.js";

function importMetaPlugin() {
	// Sets import.meta.url to be correct
	// This might be unnecessary if we use the VM module initializeImportMeta and
	// load each independent module into its own module instance.
	return {
		name: "import-meta",
		setup(build) {
			build.onLoad({filter: /\.(js|ts|jsx|tsx)$/}, async (args) => {
				let code = await FS.readFile(args.path, "utf8");
				const magicString = new MagicString(code);
				magicString.prepend(
					`import.meta && (import.meta.url = "${pathToFileURL(args.path).href}");`,
				);

				code = magicString.toString();
				const map = magicString.generateMap({
					file: args.path,
					source: args.path,
					hires: true,
				});

				code = code + "\n//# sourceMappingURL=" + map.toUrl();
				return {
					contents: code,
					loader: Path.extname(args.path).slice(1),
				};
			});
		},
	};
}

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
				build.onEnd(async (result) => {
					resolve(result);
					push(result);
					watcherCache.set(entry, {result});
				});
			},
		};
		const ctx = await ESBuild.context({
			format: "esm",
			platform: "node",
			entryPoints: [entry],
			//bundle: true,
			bundle: false,
			metafile: true,
			write: false,
			packages: "external",
			sourcemap: "both",
			plugins: [watchPlugin],
			// We need this to export map files.
			outdir: "dist",
			logLevel: "silent",
		});

		await ctx.watch();
		await stop;
		ctx.dispose();
		watcherCache.delete(entry);
	});
}

export default async function develop(file, options) {
	const url = pathToFileURL(file).href;
	const port = parseInt(options.port);
	let namespace = null;
	let hot = null;
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

	process.on("uncaughtException", (err) => {
		console.error(err);
	});

	process.on("unhandledRejection", (err) => {
		console.error(err);
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
		// TODO: move linkModule and resolveRootModule to the top-level scope
		async function linkModule(module) {
			await module.link(async (specifier, referencingModule) => {
				const basedir = Path.dirname(fileURLToPath(referencingModule.identifier));
				const resolved = await resolve(specifier, basedir);
				if (isPathSpecifier(specifier)) {
					const firstResult = await new Promise(async (resolve) => {
						let initial = true;
						for await (const result of watch(resolved, watcherCache)) {
							if (initial) {
								initial = false;
								resolve(result);
							} else {
								// TODO: Allow import.meta.hot.accept to be called and prevent
								// reloading the root module.
								await reloadRootModule();
							}
						}
					});
					const code = firstResult.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
					const depURL = pathToFileURL(resolved).href;
					return new VM.SourceTextModule(
						code || "",
						{
							identifier: depURL,
							initializeImportMeta(meta) {
								meta.url = depURL;
								meta.hot = hot;
							},
						},
					);
				}

				const child = await import(resolved);
				const exports = Object.keys(child);
				return new VM.SyntheticModule(exports, function () {
					for (const key of exports) {
						this.setExport(key, child[key]);
					}
				});
			});
		}

		async function reloadRootModule() {
			if (hot) {
				disposeHot(hot);
			}

			const module = new VM.SourceTextModule(code, {
				identifier: url,
				initializeImportMeta(meta) {
					meta.url = url;
					meta.hot = hot;
				},
			});

			try {
				await linkModule(module);
				await module.evaluate();
			} catch (err) {
				console.error(err);
				return;
			}

			namespace = module.namespace;
			hot = new Hot();
			console.info("rebuilt:", url);
		}

		await reloadRootModule();
	}
}
