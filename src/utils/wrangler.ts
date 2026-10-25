/**
 * Wrangler config sync for Cloudflare builds.
 *
 * "--save semantics": shovel knows a handful of wrangler settings the build
 * output requires (entry point, assets binding, html_handling for directory
 * reads). Like npm editing only "dependencies", we fill in missing keys and
 * never rewrite ones the user set — an existing value, even one we disagree
 * with, is an explicit choice and gets a notice instead of an edit.
 */

import * as FS from "fs";
import {join, relative} from "path";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "build"]);

// ============================================================================
// TYPES
// ============================================================================

/** The wrangler settings a shovel build requires. */
export interface WranglerDesired {
	main: string;
	compatibilityDate: string;
	/** Flags the worker needs present in compatibility_flags */
	compatibilityFlags: string[];
	assets: {
		directory: string;
		binding: string;
		/** Set when a directory is served over the ASSETS binding */
		htmlHandling: "none" | null;
	};
}

export interface WranglerAction {
	kind: "add" | "notice";
	/** Human-readable, e.g. `[assets] html_handling = "none"` */
	description: string;
}

export interface WranglerSyncResult {
	/** Config file path, or the path that would be created */
	path: string;
	/** True when no config existed and a scaffold is involved */
	created: boolean;
	/** True when `save` was set and the file was written */
	wrote: boolean;
	actions: WranglerAction[];
	/** The full contents that were (or would be) written; null if no changes */
	contents: string | null;
}

interface DirectoryModuleConfig {
	module?: string;
	export?: string;
}

// ============================================================================
// DESIRED SETTINGS
// ============================================================================

/**
 * Whether the effective directories config serves a directory over the
 * ASSETS binding. Platform defaults map "public" to CloudflareAssetsDirectory,
 * so this is true unless the user overrides every such directory away.
 * A directory over ASSETS needs literal paths: the default html_handling
 * canonicalizes .html URLs (and newer workerd 500s on the explicit path),
 * which breaks getFileHandle for any .html file.
 */
export function usesAssetsDirectory(
	platformDirectories: Record<string, DirectoryModuleConfig>,
	userDirectories: Record<string, DirectoryModuleConfig>,
): boolean {
	const names = new Set([
		...Object.keys(platformDirectories),
		...Object.keys(userDirectories),
	]);
	for (const name of names) {
		const platformConfig = platformDirectories[name] || {};
		const userConfig = userDirectories[name] || {};
		const merged = {...platformConfig, ...userConfig};
		// A user module without an export means the module's default export,
		// not the platform default's named export (same rule as config codegen).
		if (userConfig.module && !userConfig.export) {
			delete merged.export;
		}

		if (
			merged.module === "@b9g/platform-cloudflare/directories" &&
			merged.export === "CloudflareAssetsDirectory"
		) {
			return true;
		}
	}

	return false;
}

export function computeDesired({
	projectRoot,
	outDir,
	assetsDirectory,
}: {
	projectRoot: string;
	outDir: string;
	assetsDirectory: boolean;
}): WranglerDesired {
	const rel = (p: string) => relative(projectRoot, p).split("\\").join("/");
	return {
		main: rel(join(outDir, "server", "worker.js")),
		compatibilityDate: "2024-09-23",
		compatibilityFlags: ["nodejs_compat"],
		assets: {
			directory: rel(join(outDir, "public")) + "/",
			binding: "ASSETS",
			htmlHandling: assetsDirectory ? "none" : null,
		},
	};
}

// ============================================================================
// TOML (append-only editing)
// ============================================================================

interface TomlLayout {
	/** Keys defined at the top level (before any [table]) */
	topLevelKeys: Set<string>;
	/** Line index of the first table header, or lines.length */
	firstTableLine: number;
	/** Keys inside [assets], or null if the table doesn't exist */
	assetsKeys: Set<string> | null;
	/** Line index just past the last line of [assets] */
	assetsEnd: number;
	/** True for `assets = {...}` inline tables or [[assets]] arrays we won't touch */
	assetsUnsupported: boolean;
}

function scanToml(lines: string[]): TomlLayout {
	const layout: TomlLayout = {
		topLevelKeys: new Set(),
		firstTableLine: lines.length,
		assetsKeys: null,
		assetsEnd: lines.length,
		assetsUnsupported: false,
	};

	let section: string | null = "";
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const header = /^\s*\[\[?\s*([A-Za-z0-9_."'-]+)\s*\]?\]/.exec(line);
		if (header) {
			if (layout.firstTableLine === lines.length) {
				layout.firstTableLine = i;
			}
			if (section === "assets") {
				layout.assetsEnd = i;
			}
			section = header[1];
			if (section === "assets") {
				if (line.trimStart().startsWith("[[")) {
					layout.assetsUnsupported = true;
				}
				layout.assetsKeys ??= new Set();
				layout.assetsEnd = lines.length;
			}
			continue;
		}

		const kv = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line);
		if (kv) {
			if (section === "") {
				layout.topLevelKeys.add(kv[1]);
				if (kv[1] === "assets") {
					layout.assetsUnsupported = true;
				}
			} else if (section === "assets") {
				layout.assetsKeys?.add(kv[1]);
			}
		}
	}

	return layout;
}

function patchToml(
	raw: string,
	desired: WranglerDesired,
): {contents: string | null; actions: WranglerAction[]} {
	const actions: WranglerAction[] = [];
	const lines = raw.split("\n");
	const layout = scanToml(lines);

	if (layout.assetsUnsupported) {
		actions.push({
			kind: "notice",
			description:
				"assets is configured in a form shovel doesn't edit " +
				"(inline table or [[assets]]) — apply the settings manually",
		});
		return {contents: null, actions};
	}

	// Top-level keys must appear before the first table header.
	const topAdditions: string[] = [];
	if (!layout.topLevelKeys.has("main")) {
		topAdditions.push(`main = "${desired.main}"`);
		actions.push({kind: "add", description: `main = "${desired.main}"`});
	}
	if (!layout.topLevelKeys.has("compatibility_date")) {
		topAdditions.push(`compatibility_date = "${desired.compatibilityDate}"`);
		actions.push({
			kind: "add",
			description: `compatibility_date = "${desired.compatibilityDate}"`,
		});
	}
	if (!layout.topLevelKeys.has("compatibility_flags")) {
		const flags = desired.compatibilityFlags
			.map((f) => JSON.stringify(f))
			.join(", ");
		topAdditions.push(`compatibility_flags = [${flags}]`);
		actions.push({
			kind: "add",
			description: `compatibility_flags = [${flags}]`,
		});
	} else {
		for (const flag of desired.compatibilityFlags) {
			// Arrays may span lines; a whole-file check is the honest test we
			// can do without a TOML parser, and a false positive only skips a
			// notice.
			if (!raw.includes(flag)) {
				actions.push({
					kind: "notice",
					description: `compatibility_flags should include "${flag}"`,
				});
			}
		}
	}

	const assetsAdditions: string[] = [];
	const wantAssets: Array<[string, string]> = [
		["directory", `"${desired.assets.directory}"`],
		["binding", `"${desired.assets.binding}"`],
	];
	if (desired.assets.htmlHandling) {
		wantAssets.push(["html_handling", `"${desired.assets.htmlHandling}"`]);
	}
	for (const [key, value] of wantAssets) {
		if (!layout.assetsKeys?.has(key)) {
			assetsAdditions.push(`${key} = ${value}`);
			actions.push({kind: "add", description: `[assets] ${key} = ${value}`});
		}
	}
	if (
		desired.assets.htmlHandling &&
		layout.assetsKeys?.has("html_handling") &&
		!/html_handling\s*=\s*"none"/.test(raw)
	) {
		actions.push({
			kind: "notice",
			description:
				'html_handling is set to something other than "none"; directory ' +
				"reads of .html files over ASSETS are unreliable without it",
		});
	}

	if (topAdditions.length === 0 && assetsAdditions.length === 0) {
		return {contents: null, actions};
	}

	const out = [...lines];
	// Splice deepest-first so earlier indices stay valid.
	if (assetsAdditions.length > 0) {
		if (layout.assetsKeys === null) {
			const block = ["", "[assets]", ...assetsAdditions];
			// Append at end of file.
			while (out.length > 0 && out[out.length - 1].trim() === "") {
				out.pop();
			}
			out.push(...block, "");
		} else {
			let insertAt = layout.assetsEnd;
			while (insertAt > 0 && out[insertAt - 1].trim() === "") {
				insertAt--;
			}
			out.splice(insertAt, 0, ...assetsAdditions);
		}
	}
	if (topAdditions.length > 0) {
		out.splice(layout.firstTableLine, 0, ...topAdditions);
	}

	return {contents: out.join("\n"), actions};
}

export function scaffoldToml(desired: WranglerDesired, name: string): string {
	const flags = desired.compatibilityFlags
		.map((f) => JSON.stringify(f))
		.join(", ");
	const lines = [
		`name = "${name}"`,
		`main = "${desired.main}"`,
		`compatibility_date = "${desired.compatibilityDate}"`,
		`compatibility_flags = [${flags}]`,
		"",
		"[assets]",
		`directory = "${desired.assets.directory}"`,
		`binding = "${desired.assets.binding}"`,
	];
	if (desired.assets.htmlHandling) {
		lines.push(`html_handling = "${desired.assets.htmlHandling}"`);
	}
	lines.push("");
	return lines.join("\n");
}

// ============================================================================
// JSON / JSONC
// ============================================================================

function hasJsoncSyntax(raw: string): boolean {
	// Strings could contain these sequences, but a false positive only
	// downgrades an edit to a printed suggestion.
	return raw.includes("//") || raw.includes("/*") || /,\s*[}\]]/.test(raw);
}

function patchJson(
	raw: string,
	desired: WranglerDesired,
): {contents: string | null; actions: WranglerAction[]} {
	const actions: WranglerAction[] = [];

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		logger.debug("wrangler config parse failed", {error});
		actions.push({
			kind: "notice",
			description: "config file could not be parsed — fix it manually",
		});
		return {contents: null, actions};
	}

	let changed = false;
	if (parsed.main === undefined) {
		parsed.main = desired.main;
		actions.push({kind: "add", description: `main: "${desired.main}"`});
		changed = true;
	}
	if (parsed.compatibility_date === undefined) {
		parsed.compatibility_date = desired.compatibilityDate;
		actions.push({
			kind: "add",
			description: `compatibility_date: "${desired.compatibilityDate}"`,
		});
		changed = true;
	}
	if (parsed.compatibility_flags === undefined) {
		parsed.compatibility_flags = [...desired.compatibilityFlags];
		actions.push({
			kind: "add",
			description: `compatibility_flags: ${JSON.stringify(desired.compatibilityFlags)}`,
		});
		changed = true;
	} else if (Array.isArray(parsed.compatibility_flags)) {
		for (const flag of desired.compatibilityFlags) {
			if (!parsed.compatibility_flags.includes(flag)) {
				actions.push({
					kind: "notice",
					description: `compatibility_flags should include "${flag}"`,
				});
			}
		}
	}

	const assets =
		typeof parsed.assets === "object" && parsed.assets !== null
			? (parsed.assets as Record<string, unknown>)
			: undefined;
	if (assets === undefined) {
		const block: Record<string, unknown> = {
			directory: desired.assets.directory,
			binding: desired.assets.binding,
		};
		if (desired.assets.htmlHandling) {
			block.html_handling = desired.assets.htmlHandling;
		}
		parsed.assets = block;
		actions.push({
			kind: "add",
			description: `assets: ${JSON.stringify(block)}`,
		});
		changed = true;
	} else {
		const want: Array<[string, string]> = [
			["directory", desired.assets.directory],
			["binding", desired.assets.binding],
		];
		if (desired.assets.htmlHandling) {
			want.push(["html_handling", desired.assets.htmlHandling]);
		}
		for (const [key, value] of want) {
			if (assets[key] === undefined) {
				assets[key] = value;
				actions.push({
					kind: "add",
					description: `assets.${key}: "${value}"`,
				});
				changed = true;
			}
		}
		if (
			desired.assets.htmlHandling &&
			assets.html_handling !== undefined &&
			assets.html_handling !== "none"
		) {
			actions.push({
				kind: "notice",
				description:
					'assets.html_handling is set to something other than "none"; ' +
					"directory reads of .html files over ASSETS are unreliable " +
					"without it",
			});
		}
	}

	if (!changed) {
		return {contents: null, actions};
	}

	const indent = /\n\t/.test(raw) ? "\t" : "  ";
	return {contents: JSON.stringify(parsed, null, indent) + "\n", actions};
}

// ============================================================================
// SYNC
// ============================================================================

function workerName(projectRoot: string): string {
	let name = "shovel-app";
	try {
		const pkg = JSON.parse(
			FS.readFileSync(join(projectRoot, "package.json"), "utf8"),
		);
		if (typeof pkg.name === "string" && pkg.name.length > 0) {
			name = pkg.name;
		}
	} catch (error) {
		// package.json is optional here; the fallback name is fine.
		logger.debug("no package.json name for worker name", {error});
	}
	// Worker names: lowercase alphanumerics and dashes.
	const sanitized = name
		.toLowerCase()
		.replace(/^@/, "")
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return sanitized || "shovel-app";
}

/**
 * Compare the project's wrangler config with what the build requires.
 * Returns the additions (and notices for user-set values we won't touch);
 * with `save`, missing keys are written — existing values are never changed.
 *
 * Precedence mirrors wrangler: wrangler.jsonc, then wrangler.json, then
 * wrangler.toml.
 */
export function syncWranglerConfig({
	projectRoot,
	desired,
	save,
}: {
	projectRoot: string;
	desired: WranglerDesired;
	save: boolean;
}): WranglerSyncResult {
	const candidates = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];
	let path: string | null = null;
	for (const candidate of candidates) {
		if (FS.existsSync(join(projectRoot, candidate))) {
			path = join(projectRoot, candidate);
			break;
		}
	}

	if (path === null) {
		const scaffoldPath = join(projectRoot, "wrangler.toml");
		const contents = scaffoldToml(desired, workerName(projectRoot));
		if (save) {
			FS.writeFileSync(scaffoldPath, contents);
		}
		return {
			path: scaffoldPath,
			created: true,
			wrote: save,
			actions: [{kind: "add", description: "create wrangler.toml"}],
			contents,
		};
	}

	const raw = FS.readFileSync(path, "utf8");
	let result: {contents: string | null; actions: WranglerAction[]};
	if (path.endsWith(".toml")) {
		result = patchToml(raw, desired);
	} else if (path.endsWith(".jsonc") && hasJsoncSyntax(raw)) {
		// Editing would drop comments; report what's missing instead.
		const probe = patchJson(raw.replace(/\/\/[^\n]*/g, ""), desired);
		result = {contents: null, actions: probe.actions};
		if (probe.contents !== null) {
			result.actions.push({
				kind: "notice",
				description:
					"wrangler.jsonc has comments, which shovel won't rewrite — " +
					"apply the additions above manually",
			});
		}
	} else {
		result = patchJson(raw, desired);
	}

	const wrote = save && result.contents !== null;
	if (wrote && result.contents !== null) {
		FS.writeFileSync(path, result.contents);
	}

	return {
		path,
		created: false,
		wrote,
		actions: result.actions,
		contents: result.contents,
	};
}
