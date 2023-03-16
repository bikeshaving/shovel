#!/usr/bin/env node --experimental-vm-modules --experimental-fetch --no-warnings
// TODO: Squash warnings from process
// https://github.com/yarnpkg/berry/blob/2cf0a8fe3e4d4bd7d4d344245d24a85a45d4c5c9/packages/yarnpkg-pnp/sources/loader/applyPatch.ts#L414-L435
import * as Path from "path";
import * as FS from "fs/promises";
import {pathToFileURL} from "url";
import {createServer} from "http";
import * as VM from "vm";
import * as ESBuild from "esbuild";

import {Command} from "commander";
import {SourceMapConsumer} from "source-map";
import MagicString from "magic-string";

import pkg from "../package.json" assert {type: "json"};
import resolve from "../resolve.js";

const program = new Command();
program
	.name("shovel")
	.version(pkg.version)
	.description("Dig for treasure.");

program.command("develop <file>")
	.option("-p, --port <port>", "Port to listen on", "1337")
	.action(develop);

await program.parseAsync(process.argv);

class Hot {
	constructor() {
		this.disposeCallbacks = [];
	}

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


async function develop(file, options) {
	const url = pathToFileURL(file);
	const port = parseInt(options.port);

	let sourceMapConsumer;
	let namespace;
	let hot;

	{
		const watchPlugin = {
			name: "watch",
			setup(build) {
				// This is called every time a module is edited.
				build.onEnd(async (result) => {
					const url = pathToFileURL(build.initialOptions.entryPoints[0]).href;
					if (result.errors && result.errors.length) {
						const formatted = await ESBuild.formatMessages(result.errors, {
							kind: "error",
							color: true,
						});
						console.error(formatted.join("\n"));
						return;
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
						await module.link(async (specifier) => {
							// Currently, only dependencies are linked, source code is bundled.
								// If we want to create a module instance for each file, we will
							// have to create a recursive call to ESBuild, and manage the
							// ESBuild contexts and module instances.
							const resolved = await resolve(specifier, process.cwd());
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
				});
			},
		};

		const ctx = await ESBuild.context({
			format: "esm",
			platform: "node",
			entryPoints: [file],
			bundle: true,
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
	}

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

	console.info("listening on port:", port);
	server.listen(port);
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
}

function readableStreamFromMessage(req) {
	return new ReadableStream({
		start(controller) {
			req.on("data", (chunk) => {
				controller.enqueue(chunk);
			});

			req.on("end", () => {
				controller.close();
			});
		},

		cancel() {
			req.destroy();
		},
	});
}

async function webRequestFromNode(req) {
	const url = new URL(req.url || "/", "http://" + req.headers.host);
	const headers = new Headers();
	for (const key in req.headers) {
		if (req.headers[key]) {
			headers.append(key, req.headers[key]);
		}
	}

	return new Request(url, {
		method: req.method,
		headers,
		body: req.method === "GET" || req.method === "HEAD" ? undefined : readableStreamFromMessage(req),
	});
}

async function callNodeResponse(res, webRes) {
	const headers = {};
	webRes.headers.forEach((value, key) => {
		headers[key] = value;
	});
	res.writeHead(webRes.status, headers);
	// TODO: stream the body
	res.end(await webRes.text());
}

function createFetchServer(handler) {
	const server = createServer(async (req, res) => {
		const webRes = await handler(webRequestFromNode(req));
		callNodeResponse(res, webRes);
	});

	return server;
}

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
