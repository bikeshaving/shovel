import * as Path from "path";
import * as FS from "fs/promises";
import {pathToFileURL} from "url";

export async function static_(entry, options) {
	entry = Path.resolve(process.cwd(), entry);
	const module = await import(entry);
	const dist = Path.resolve(process.cwd(), options.outDir);
	const paths = module.default?.staticPaths?.(dist);
	if (paths) {
		for await (const path of paths) {
			const req = new Request(pathToFileURL(path).href);
			const res = await module.default?.fetch?.(req);
			const body = await res.text();
			const htmlPath = Path.resolve(dist, path.replace(/^\//, ""), "index.html");
			console.info(`Writing: ${htmlPath}`);
			await FS.mkdir(Path.dirname(htmlPath), {recursive: true});
			await FS.writeFile(htmlPath, body);
		}
	}
}
