/**
 * Adapted from https://github.com/browserify/resolve.
 * @license
 * MIT License
 * Copyright (c) 2012 James Halliday
 */
import * as FS from "fs/promises";
import * as Path from "path";
import isCore from 'is-core-module';

function nodeModulesPaths(start) {
	let prefix = "/";
	if ((/^([A-Za-z]:)/).test(start)) {
		prefix = "";
	} else if ((/^\\\\/).test(start)) {
		prefix = "\\\\";
	}

	const paths = [start];
	let parsed = Path.parse(start);
	while (parsed.dir !== paths[paths.length - 1]) {
		paths.push(parsed.dir);
		parsed = Path.parse(parsed.dir);
	}

	return paths.reduce(function (dirs, aPath) {
		return dirs.concat([Path.resolve(prefix, aPath, "node_modules")]);
	}, []);
}

async function isFile(file) {
	let stat;
	try {
		stat = await FS.stat(file);
	} catch (err) {
		if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
			return false;
		}

		throw err;
	}

	return stat.isFile() || stat.isFIFO();
}

async function isDirectory(dir) {
	let stat;
	try {
		stat = await FS.stat(dir);
	} catch (err) {
		if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
			return false;
		}

		throw err;
	}

	return stat.isDirectory();
}

const localRealpath =
	process.platform !== 'win32' && FS.realpath && typeof FS.realpath.native === 'function'
		? FS.realpath.native
		: FS.realpath;
async function realpath(x) {
	try {
		return await localRealpath(x);
	} catch (err) {
		if (err.code === 'ENOENT') {
			return x;
		}

		throw err;
	}
}

function maybeRealpath(realpath, x, opts) {
	if (!opts || !opts.preserveSymlinks) {
		return realpath(x);
	} else {
		return x;
	}
}

async function readPackage(pkgfile) {
	const body = await FS.readFile(pkgfile);
	return JSON.parse(body);
}

function getPackageCandidates(x, start) {
	const dirs = nodeModulesPaths(start);
	for (let i = 0; i < dirs.length; i++) {
		dirs[i] = Path.join(dirs[i], x);
	}

	return dirs;
}

async function loadAsFile(x) {
	const extensions = ["", ".js", ".ts"];
	for (const ext of extensions) {
		const file = x + ext;
		if (await isFile(file)) {
			return file;
		}
	}

	return x;
}

async function loadpkg(dir) {
	if (dir === '' || dir === '/') {
		return null;
	}

	if (process.platform === 'win32' && (/^\w:[/\\]*$/).test(dir)) {
		return null;
	}

	if ((/[/\\]node_modules[/\\]*$/).test(dir)) {
		return null;
	}

	dir = await maybeRealpath(realpath, dir);
	const pkgfile = Path.join(dir, 'package.json');
	if (!await isFile(pkgfile)) {
		return loadpkg(Path.dirname(dir));
	}

	return await readPackage(pkgfile);
}

async function loadAsDirectory(x) {
	let pkgdir;
	try { 
		pkgdir = await maybeRealpath(realpath, x);
	} catch (err) {
		throw err;
	}

	const pkgfile = Path.join(pkgdir, 'package.json');
	if (!await isFile(pkgfile)) {
		return loadAsFile(Path.join(x, '/index'));
	}

	const pkg = await readPackage(pkgfile);
	if (pkg && pkg.main) {
		return loadAsFile(Path.join(x, pkg.main));
	} else if (pkg && pkg.module) {
		return loadAsFile(Path.join(x, pkg.module));
	}

	return loadAsFile(Path.join(x, '/index'));
}

async function processDirs(dirs) {
	for (const dir of dirs) {
		if (await isDirectory(dir)) {
			return loadAsDirectory(dir);
		}

		const result = await loadAsFile(dir);
		if (result) {
			return result;
		}
	}
}

async function loadNodeModules(x, start) {
	const dirs = getPackageCandidates(x, start);
	return processDirs(dirs) || x;
}

export async function resolve(specifier, basedir) {
	if (typeof specifier !== 'string') {
		throw new TypeError('specifier must be a string');
	}

	// ensure that `basedir` is an absolute path at this point, resolving against the process' current working directory
	let absoluteStart = Path.resolve(basedir);

	absoluteStart = await maybeRealpath(
		realpath,
		absoluteStart,
	);

	if (!isDirectory(absoluteStart)) {
		throw new Error(`Cannot resolve ${basedir} to a directory`);
	}

	if (isCore(specifier)) {
		return specifier;
	} else if ((/^(?:\.\.?(?:\/|$)|\/|([A-Za-z]:)?[/\\])/).test(specifier)) {
		// TODO: resolving a local file doesn’t work yet because it won’t be
		// transpiled by ESBuild. This branch is avoided by bundling the entry.
		let specifier1 = Path.resolve(basedir, specifier);

		if (specifier === '.' || specifier === '..' || specifier.slice(-1) === '/')  {
			specifier1 += '/';
		}

		let result;
		if ((/\/$/).test(specifier) && specifier1 === basedir) {
			result = await loadAsDirectory(specifier1);
		} else {
			result = await loadAsFile(specifier1);
		}	

		return result || specifier;
	}

	return loadNodeModules(specifier, basedir);
}
