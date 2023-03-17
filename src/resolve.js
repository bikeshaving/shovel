// This code was generated with the help of OpenAI's ChatGPT.
import * as FS from 'fs/promises';
import * as Path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import isCoreModule from 'is-core-module';
import {exports} from "resolve.exports";

async function loadAsFile(x) {
  const extensions = ['', '.js', '.json', '.node'];
  for (const ext of extensions) {
    const file = x + ext;
    try {
      await FS.access(file);
      return file;
    } catch {
      // Do nothing, continue to next extension
    }
  }
  return null;
}

async function loadIndex(x) {
  const extensions = ['/index.js', '/index.json', '/index.node'];
  for (const ext of extensions) {
    const file = x + ext;
    try {
      await FS.access(file);
      return file;
    } catch {
      // Do nothing, continue to next extension
    }
  }
  return null;
}

async function loadAsDirectory(x) {
  const pkgJsonFile = Path.join(x, 'package.json');
  try {
    await FS.access(pkgJsonFile);
    const pkgJson = JSON.parse(await FS.readFile(pkgJsonFile));
    const pkgExports = exports(pkgJson);
    if (pkgExports && pkgExports[0]) {
      return Path.join(x, pkgExports[0]);
    }
  } catch {
    // Do nothing, continue to next step
  }

  return await loadIndex(x);
}

async function nodeModulesPaths(start) {
  const parts = start.split(Path.sep);
  const dirs = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'node_modules') continue;
    const dir = Path.join(...parts.slice(0, i + 1), 'node_modules');
    dirs.unshift(dir);
  }
  // You should add global folders if needed
  return dirs;
}

async function loadNodeModules(x, start) {
  const dirs = await nodeModulesPaths(start);
  for (const dir of dirs) {
    const pkgJsonFile = Path.join(dir, x, 'package.json');
    try {
      await FS.access(pkgJsonFile);
      const pkgJson = JSON.parse(await FS.readFile(pkgJsonFile));
      const pkgExports = exports(pkgJson, x);
      if (pkgExports && pkgExports[0]) {
        return Path.join(dir, x, pkgExports[0]);
      }
    } catch {
      // Do nothing, continue to next step
    }
    const fileResult = await loadAsFile(Path.join(dir, x));
    if (fileResult) return Path.resolve(start, fileResult);
    const dirResult = await loadAsDirectory(Path.join(dir, x));
    if (dirResult) return Path.resolve(start, dirResult);
  }
  return null;
}

export async function resolve(specifier, basedir) {
  if (typeof specifier !== 'string') {
    throw new TypeError('specifier must be a string');
  } else if (isCoreModule(specifier)) {
    return specifier;
  }

  // Ensure that `basedir` is an absolute path at this point,
  // resolving against the process' current working directory
  let absoluteStart = Path.resolve(basedir);
  absoluteStart = await FS.realpath(absoluteStart);
  if (!(await FS.lstat(absoluteStart)).isDirectory()) {
    throw new Error(`Cannot resolve ${basedir} to a directory`);
  }

  if (/^(?:\.\.?(?:\/|$)|\/|([A-Za-z]:)?[/\\])/.test(specifier)) {
    // Handle relative and absolute paths
    const specifierPath = Path.resolve(basedir, specifier);
    let result;
    if (/\/$/.test(specifier) && specifierPath === basedir) {
      result = await loadAsDirectory(specifierPath);
    } else {
      result = await loadAsFile(specifierPath);
    }
    return result || specifier;
  }

  // Handle node_modules resolution
  const resolvedNodeModule = await loadNodeModules(specifier, absoluteStart);
  if (resolvedNodeModule) {
    return resolvedNodeModule;
  }

  throw new Error(`Cannot resolve module "${specifier}" from "${basedir}"`);
}
