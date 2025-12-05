/**
 * ESBuild plugin to transform import.meta properties to compile-time values.
 * Transforms:
 * - import.meta.url → file:// URL of the source file
 * - import.meta.dirname → directory path of the source file
 * - import.meta.filename → absolute path of the source file
 *
 * This preserves the original file paths even after bundling. Developers use
 * these APIs to mean "relative to where I wrote this code", not "where the
 * bundle executes from". Principle of least surprise.
 */

import * as ESBuild from "esbuild";
import {readFile} from "fs/promises";
import {dirname} from "path";
import {pathToFileURL} from "url";

export function importMetaPlugin(): ESBuild.Plugin {
	return {
		name: "import-meta-transform",
		setup(build) {
			// Only process user code, skip node_modules for performance
			build.onLoad({filter: /\.[jt]sx?$/, namespace: "file"}, async (args) => {
				// Skip node_modules - dependencies handle their own import.meta
				if (args.path.includes("node_modules")) {
					return null;
				}

				const contents = await readFile(args.path, "utf8");

				// Early bailout if file doesn't use import.meta properties we transform
				if (
					!contents.includes("import.meta.url") &&
					!contents.includes("import.meta.dirname") &&
					!contents.includes("import.meta.filename")
				) {
					return null;
				}

				// Compute the values for this specific file
				const fileUrl = pathToFileURL(args.path).href;
				const fileDirname = dirname(args.path);
				const fileFilename = args.path;

				// Replace import.meta properties with their compile-time values
				let transformed = contents;

				transformed = transformed.replace(
					/\bimport\.meta\.url\b/g,
					JSON.stringify(fileUrl),
				);

				transformed = transformed.replace(
					/\bimport\.meta\.dirname\b/g,
					JSON.stringify(fileDirname),
				);

				transformed = transformed.replace(
					/\bimport\.meta\.filename\b/g,
					JSON.stringify(fileFilename),
				);

				// Determine loader based on file extension
				const ext = args.path.split(".").pop();
				let loader: ESBuild.Loader = "js";
				if (ext === "ts") loader = "ts";
				else if (ext === "tsx") loader = "tsx";
				else if (ext === "jsx") loader = "jsx";

				return {
					contents: transformed,
					loader,
				};
			});
		},
	};
}
