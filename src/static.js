import * as Path from "path";
import * as FS from "fs/promises";
import {pathToFileURL} from "url";
import * as VM from "vm";
import {formatMessages} from "esbuild";

// TODO: The static workflow is run once so we don’t need to observe files.
import {BuildObserver} from "./_esbuild.js";
import {createLink} from "./_vm.js";

// TODO: This code is duplicated in ./develop.js so it should be moved to a
// module-specific file.

//interface ModuleCacheValue {
//	module: VM.SourceTextModule;
//	dependents: Set<string>;
//	hot: Hot;
//}
export async function static_(file, options) {
	file = Path.resolve(process.cwd(), file);
	process.on("SIGINT", async () => {
		await observer.dispose();
		process.exit(0);
	});

	process.on("SIGTERM", async () => {
		await observer.dispose();
		process.exit(0);
	});

	const observer = new BuildObserver(async (record) => {
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
		}
	});

	const link = createLink(observer);
	const result = await observer.build(file);
	const code = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text || "";
	const url = pathToFileURL(file).href;
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
