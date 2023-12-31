import * as Path from "path";
import {pathToFileURL} from "url";
import * as VM from "vm";
import {formatMessages} from "esbuild";

import {BuildObserver} from "./_esbuild.js";
import {createLink} from "./_vm.js";
import {createFetchServer} from "./_server.js";

async function executeBuildResult(result, entry, link) {
	const javascript = result.outputFiles.find((file) =>
		file.path.endsWith(".js")
	)?.text || "";
	const url = pathToFileURL(entry).href;
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
		return module;
	} catch (err) {
		console.error(err);
		return null;
	}
}

export async function develop(entry, options) {
	entry = Path.resolve(process.cwd(), entry);
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
		await observer.dispose();
		process.exit(0);
	});

	process.on("SIGTERM", async () => {
		server.close();
		await observer.dispose();
		process.exit(0);
	});

	let module = null;
	const server = createFetchServer(async function fetcher(req) {
		if (typeof module?.namespace.default?.fetch === "function") {
			try {
				return await module?.namespace?.default?.fetch(req);
			} catch (err)	{
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
		console.info("Listening on port:", port);
	});

	const moduleCache = new Map();
	const observer = new BuildObserver(async (record, observer) => {
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
			const seen = new Set([record.entry]);
			const queue = [record.entry];
			while (queue.length > 0) {
				const entry = queue.shift();
				const dependents = moduleCache.get(entry)?.dependents;
				if (dependents) {
					for (const dependent of dependents) {
						if (!seen.has(dependent)) {
							seen.add(dependent);
							queue.push(dependent);
						}
					}
				}

				moduleCache.delete(entry);
			}

			const rootResult = await observer.build(entry);
			module = await executeBuildResult(rootResult, entry, link);
		}
	});

	const link = createLink(observer, moduleCache);
	const result = await observer.build(entry);
	module = await executeBuildResult(result, entry, link);
}
