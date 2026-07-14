/**
 * ESBuild plugin for the `shovel:directory-snapshot:<name>` virtual module.
 *
 * Bakes a source directory into the bundle at build time and exposes it as a
 * populated {@link MemoryDirectory}, so a site can declare
 *
 *   { "directories": { "content": { "snapshot": "./content" } } }
 *
 * in shovel.json and call `self.directories.open("content")` as normal — even
 * on platforms with no filesystem (Cloudflare Workers), where node-fs cannot
 * read and CloudflareAssetsDirectory cannot enumerate.
 *
 * Prior art: src/plugins/assets-manifest.ts (build-time inline of a manifest).
 */

import * as ESBuild from "esbuild";
import {readdirSync, readFileSync} from "node:fs";
import {join, resolve, relative, normalize, extname} from "node:path";
import type {DirectorySnapshot} from "@b9g/filesystem/memory";
import {loadRawConfig} from "../utils/config.js";

const logger_prefix = "shovel-directory-snapshot";

const SPECIFIER_PREFIX = "shovel:directory-snapshot:";
const NAMESPACE = "shovel-directory-snapshot";

/** Minimal extension → MIME map; unknown falls back to octet-stream. */
const MIME_BY_EXT: Record<string, string> = {
	".md": "text/markdown",
	".markdown": "text/markdown",
	".html": "text/html",
	".htm": "text/html",
	".json": "application/json",
	".css": "text/css",
	".js": "text/javascript",
	".txt": "text/plain",
	".csv": "text/csv",
	".xml": "application/xml",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

/** Walk a directory recursively into a serializable snapshot, tracking read files. */
function snapshotDir(absDir: string, watchFiles: string[]): DirectorySnapshot {
	const snapshot: DirectorySnapshot = {};
	const entries = readdirSync(absDir, {withFileTypes: true}).sort((a, b) =>
		a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
	);

	for (const entry of entries) {
		const abs = join(absDir, entry.name);
		if (entry.isDirectory()) {
			(snapshot.directories ??= {})[entry.name] = snapshotDir(abs, watchFiles);
		} else if (entry.isFile()) {
			watchFiles.push(abs);
			const bytes = readFileSync(abs);
			(snapshot.files ??= {})[entry.name] = {
				data: bytes.toString("base64"),
				type: MIME_BY_EXT[extname(entry.name).toLowerCase()],
			};
		}
	}

	return snapshot;
}

/**
 * Create the directory-snapshot virtual-module plugin.
 *
 * @param projectRoot - Root directory of the project (where shovel.json lives)
 */
export function createDirectorySnapshotPlugin(
	projectRoot: string,
): ESBuild.Plugin {
	return {
		name: NAMESPACE,
		setup(build) {
			build.onResolve({filter: new RegExp(`^${SPECIFIER_PREFIX}`)}, (args) => ({
				path: args.path,
				namespace: NAMESPACE,
			}));

			build.onLoad({filter: /.*/, namespace: NAMESPACE}, (args) => {
				const name = args.path.slice(SPECIFIER_PREFIX.length);

				// Reload config fresh (watch mode may have changed shovel.json).
				const rawConfig = loadRawConfig(projectRoot);
				const dirConfig = rawConfig.directories?.[name] as
					| {snapshot?: string}
					| undefined;
				const source = dirConfig?.snapshot;
				if (!source) {
					throw new Error(
						`[${logger_prefix}] directory "${name}" has no "snapshot" source in shovel.json`,
					);
				}

				// Path-traversal defense: the snapshot source must stay inside
				// the project root (mirrors the config plugin's module guard).
				const absDir = resolve(projectRoot, source);
				const rel = relative(normalize(projectRoot), normalize(absDir));
				if (rel.startsWith("..") || rel.startsWith("/")) {
					throw new Error(
						`[${logger_prefix}] snapshot source "${source}" for directory "${name}" escapes the project root`,
					);
				}

				const watchFiles: string[] = [];
				let snapshot: DirectorySnapshot;
				try {
					snapshot = snapshotDir(absDir, watchFiles);
				} catch (err) {
					throw new Error(
						`[${logger_prefix}] failed to read snapshot source "${source}" for directory "${name}": ${(err as Error).message}`,
					);
				}

				const contents =
					`import {MemoryDirectory} from "@b9g/filesystem/memory";\n` +
					`const SNAPSHOT = ${JSON.stringify(snapshot)};\n` +
					`export default (name) => MemoryDirectory.fromSnapshot(name, SNAPSHOT);\n`;

				return {
					contents,
					loader: "js",
					// Resolve @b9g/filesystem/memory from the project's node_modules.
					resolveDir: projectRoot,
					// Rebuild when shovel.json or any snapshotted file changes.
					watchFiles: [join(projectRoot, "shovel.json"), ...watchFiles],
				};
			});
		},
	};
}
