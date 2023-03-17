import * as Path from "path";
import * as FS from "fs/promises";
import {fileURLToPath, pathToFileURL} from "url";
import * as VM from "vm";
import * as ESBuild from "esbuild";
import {SourceMapConsumer} from "source-map";
import MagicString from "magic-string";
import {Repeater} from "@repeaterjs/repeater";
import {isPathSpecifier, resolve} from "./resolve.js";
import {createFetchServer} from "./server.js";

function fixStack(err, sourceMapConsumer) {
	let [message, ...lines] = err.stack.split("\n");
	lines = lines.map((line, i) => {
		// parse the stack trace line
		return line.replace(
			new RegExp(`ESBUILD_VM_RUN:(\\d+):(\\d+)`),
			(match, line, column) => {
				const pos = sourceMapConsumer.originalPositionFor({
					line: parseInt(line),
					column: parseInt(column),
				});

				const source = pos.source ? Path.resolve(process.cwd(), pos.source) : url;
				return `${pathToFileURL(source)}:${pos.line}:${pos.column}`;
			},
		);
	});

	err.stack = [message, ...lines].join("\n");
}

class Hot {
	constructor() {
		this.disposeCallbacks = [];
	}

	// TODO: handle accept with basic callback and deps parameter
	accept(callback) {
		if (callback) {
			throw new Error("Not implemented");
		}
	}

	invalidate() {
		throw new Error("Not implemented");
	}

	dispose(callback) {
		this.disposeCallbacks.push(callback);
	}

	decline() {
		// pass
	}
}

function disposeHot(hot) {
	for (const callback of hot.disposeCallbacks) {
		callback();
	}
}

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

function watch(entry) {
	return new Repeater(async (push, stop) => {
		const watchPlugin = {
			name: "watch",
			setup(build) {
				// This is called every time a module is edited.
				build.onEnd(async (result) => {
					push(result);
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
			plugins: [importMetaPlugin(), watchPlugin],
			// We need this to export map files.
			outdir: "dist",
			logLevel: "silent",
		});

		await ctx.watch();
		await stop;
		ctx.dispose();
	});
}

export default async function develop(file, options) {
	const url = pathToFileURL(file).href;
	const port = parseInt(options.port);

	let sourceMapConsumer;
	let namespace;
	let hot;
	const server = createFetchServer(async (req) => {
		if (typeof namespace?.default?.fetch === "function") {
			try {
				return await namespace?.default?.fetch(req);
			} catch (err)	{
				fixStack(err, sourceMapConsumer);
				return new Response(err.stack, {
					status: 500,
				});
				console.error(err);
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
		if (sourceMapConsumer) {
			fixStack(err, sourceMapConsumer);
		}

		console.error(err);
	});

	process.on("unhandledRejection", (err) => {
		if (sourceMapConsumer) {
			fixStack(err, sourceMapConsumer);
		}

		console.error(err);
	});

	for await (const result of watch(file)) {
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
		if (map) {
			sourceMapConsumer = await new SourceMapConsumer(map);
		}

		const module = new VM.SourceTextModule(code, {
			identifier: url,
		});

		try {
			await module.link(async (specifier, referencingModule) => {
				const basedir = Path.dirname(fileURLToPath(referencingModule.identifier));
				const resolved = await resolve(specifier, basedir);
				if (isPathSpecifier(specifier)) {
					// TODO: This is a bad approach because it will cause new watch
					// loops. We have to cache the watcher and reuse it.
					const firstResult = await new Promise(async (resolve) => {
						let initial = true;
						for await (const result of watch(resolved)) {
							if (initial) {
								initial = false;
								resolve(result);
							} else {
								// TODO: we need to invalidate the module
								console.log(result);
								console.log(firstResult.metafile);
							}
						}
					});

					const code = firstResult.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
					return new VM.SourceTextModule(
						code || "",
						{
							identifier: pathToFileURL(resolved).href,
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
			await module.evaluate();
		} catch (err) {
			if (sourceMapConsumer) {
				fixStack(err, sourceMapConsumer);
			}

			console.error(err);
			return;
		}

		if (hot) {
			disposeHot(hot);
		}

		namespace = module.namespace;
		hot = new Hot();
		namespace.default?.develop?.(hot);
		console.info("built:", url);
	}
}
