import * as FS from "fs/promises";
import * as ESBuild from "esbuild";

export async function resolve(specifier, context, nextResolve) {
	let defaultErr;
	let result;
	try {
		result = await nextResolve(specifier, context);
		const url = new URL(result.url, context.parentURL);
		if (
			url.protocol === "nodejs:" ||
			url.protocol === "node:" ||
			url.pathname.includes("/node_modules")
		) {
			return result;
		}
	} catch (err) {
		if (err.code !== "ERR_MODULE_NOT_FOUND") {
			throw err;
		}

		defaultErr = err;
	}

	// tries to resolve the specifier with every extension
	if (/\.(js|ts|jsx|tsx)$/.test(specifier)) {
		const extensions = ["ts", "js", "tsx", "jsx"];
		for (const ext of extensions) {
			const url = new URL(
				specifier.replace(/\.(js|ts|jsx|tsx)$/, `.${ext}`),
				context.parentURL,
			);
			try {
				result = await nextResolve(url.href, context);
			} catch (err) {
				if (err.code !== "ERR_MODULE_NOT_FOUND") {
					throw err;
				}
			}
		}
	}

	if (result && /\.(js|ts|jsx|tsx)$/.test(specifier)) {
		const url = new URL(result.url, context.parentURL);
		return {
			...result,
			format: "module",
			url: url.href + "?version=0",
		};
	}

	throw defaultErr;
}

export async function load(url, context, nextLoad) {
	console.log("load", url, context);
	if (context.format === "module") {
		const path = new URL(url).pathname;
		const result = await ESBuild.transform((await nextLoad(url)).source, {
			format: "esm",
		});
		return {
			format: "module",
			responseURL: url,
			source: result.code,
		};
	}

	return nextLoad(url);
}
