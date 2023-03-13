// TODO: credit browserify/resolve
import * as FS from "fs";
import * as FS1 from "fs/promises";
import * as Path from "path";
import isCore from 'is-core-module';
// TODO: convert to async

function nodeModulesPaths(start) {
	let prefix = '/';
	if ((/^([A-Za-z]:)/).test(start)) {
		prefix = '';
	} else if ((/^\\\\/).test(start)) {
		prefix = '\\\\';
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

var realpathFS = process.platform !== 'win32' && FS.realpath && typeof FS.realpath.native === 'function' ? FS.realpath.native : FS.realpath;

function isFile(file, cb) {
	FS.stat(file, function (err, stat) {
		if (!err) {
			return cb(null, stat.isFile() || stat.isFIFO());
		}
		if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return cb(null, false);
		return cb(err);
	});
};

function isDirectory(dir, cb) {
	FS.stat(dir, function (err, stat) {
		if (!err) {
			return cb(null, stat.isDirectory());
		}
		if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return cb(null, false);
		return cb(err);
	});
};

function realpath(x, cb) {
	realpathFS(x, function (realpathErr, realPath) {
		if (realpathErr && realpathErr.code !== 'ENOENT') cb(realpathErr);
		else cb(null, realpathErr ? x : realPath);
	});
};

function maybeRealpath(realpath, x, opts, cb) {
	if (!opts || !opts.preserveSymlinks) {
		return realpath(x, cb);
	} else {
		return x;
	}
};

function readPackage(readFile, pkgfile, cb) {
	readFile(pkgfile, function (readFileErr, body) {
		if (readFileErr) cb(readFileErr);
		else {
			try {
				var pkg = JSON.parse(body);
				cb(null, pkg);
			} catch (jsonErr) {
				cb(jsonErr);
			}
		}
	});
};

function getPackageCandidates(x, start) {
	var dirs = nodeModulesPaths(start);
	for (var i = 0; i < dirs.length; i++) {
		dirs[i] = Path.join(dirs[i], x);
	}
	return dirs;
};

export default async function resolve(name, opts) {
	if (typeof name !== 'string') {
		throw new TypeError('name must be a string');
	}

	const readFile = FS.readFile;
	const extensions = ['.js'];
	const basedir = opts.basedir;
	const parent = opts.filename || basedir;

	// ensure that `basedir` is an absolute path at this point, resolving against the process' current working directory
	var absoluteStart = Path.resolve(basedir);

	maybeRealpath(
		realpath,
		absoluteStart,
		opts,
		function (err, realStart) {
			if (err) cb(err);
			else validateBasedir(realStart);
		}
	);

	function validateBasedir(basedir) {
		if (opts.basedir) {
			var dirError = new TypeError('Provided basedir "' + basedir + '" is not a directory' + (opts.preserveSymlinks ? '' : ', or a symlink to a directory'));
			dirError.code = 'INVALID_BASEDIR';
			isDirectory(basedir, function (err, result) {
				if (err) return cb(err);
				if (!result) { return cb(dirError); }
				validBasedir(basedir);
			});
		} else {
			validBasedir(basedir);
		}
	}

	var res;
	function validBasedir(basedir) {
		if ((/^(?:\.\.?(?:\/|$)|\/|([A-Za-z]:)?[/\\])/).test(name)) {
			res = Path.resolve(basedir, name);
			if (name === '.' || name === '..' || name.slice(-1) === '/') res += '/';
			if ((/\/$/).test(name) && res === basedir) {
				loadAsDirectory(res, opts.package, onfile);
			} else loadAsFile(res, opts.package, onfile);
		} else if (isCore(name)) {
			return cb(null, name);
		} else loadNodeModules(name, basedir, function (err, n, pkg) {
			if (err) cb(err);
			else if (n) {
				return maybeRealpath(realpath, n, opts, function (err, realN) {
					if (err) {
						cb(err);
					} else {
						cb(null, realN, pkg);
					}
				});
			} else {
				var moduleError = new Error("Cannot find module '" + name + "' from '" + parent + "'");
				moduleError.code = 'MODULE_NOT_FOUND';
				cb(moduleError);
			}
		});
	}

	function onfile(err, m, pkg) {
		if (err) cb(err);
		else if (m) cb(null, m, pkg);
		else loadAsDirectory(res, function (err, d, pkg) {
			if (err) cb(err);
			else if (d) {
				maybeRealpath(realpath, d, opts, function (err, realD) {
					if (err) {
						cb(err);
					} else {
						cb(null, realD, pkg);
					}
				});
			} else {
				var moduleError = new Error("Cannot find module '" + name + "' from '" + parent + "'");
				moduleError.code = 'MODULE_NOT_FOUND';
				cb(moduleError);
			}
		});
	}

	function loadAsFile(x, thePackage, callback) {
		var loadAsFilePackage = thePackage;
		var cb = callback;
		if (typeof loadAsFilePackage === 'function') {
			cb = loadAsFilePackage;
			loadAsFilePackage = undefined;
		}

		var exts = [''].concat(extensions);
		load(exts, x, loadAsFilePackage);

		function load(exts, x, loadPackage) {
			if (exts.length === 0) return cb(null, undefined, loadPackage);
			var file = x + exts[0];

			var pkg = loadPackage;
			if (pkg) onpkg(null, pkg);
			else loadpkg(Path.dirname(file), onpkg);

			function onpkg(err, pkg_, dir) {
				pkg = pkg_;
				if (err) return cb(err);
				if (dir && pkg && opts.pathFilter) {
					var rfile = Path.relative(dir, file);
					var rel = rfile.slice(0, rfile.length - exts[0].length);
					var r = opts.pathFilter(pkg, x, rel);
					if (r) return load(
						[''].concat(extensions.slice()),
						Path.resolve(dir, r),
						pkg
					);
				}
				isFile(file, onex);
			}
			function onex(err, ex) {
				if (err) return cb(err);
				if (ex) return cb(null, file, pkg);
				load(exts.slice(1), x, pkg);
			}
		}
	}

	function loadpkg(dir, cb) {
		if (dir === '' || dir === '/') return cb(null);
		if (process.platform === 'win32' && (/^\w:[/\\]*$/).test(dir)) {
			return cb(null);
		}
		if ((/[/\\]node_modules[/\\]*$/).test(dir)) return cb(null);

		maybeRealpath(realpath, dir, opts, function (unwrapErr, pkgdir) {
			if (unwrapErr) return loadpkg(Path.dirname(dir), cb);
			var pkgfile = Path.join(pkgdir, 'package.json');
			isFile(pkgfile, function (err, ex) {
				// on err, ex is false
				if (!ex) return loadpkg(Path.dirname(dir), cb);

				readPackage(readFile, pkgfile, function (err, pkgParam) {
					if (err && !(err instanceof SyntaxError)) cb(err);

					var pkg = pkgParam;

					if (pkg && opts.packageFilter) {
						pkg = opts.packageFilter(pkg, pkgfile, dir);
					}
					cb(null, pkg, dir);
				});
			});
		});
	}

	function loadAsDirectory(x, loadAsDirectoryPackage, callback) {
		var cb = callback;
		var fpkg = loadAsDirectoryPackage;
		if (typeof fpkg === 'function') {
			cb = fpkg;
			fpkg = opts.package;
		}

		maybeRealpath(realpath, x, opts, function (unwrapErr, pkgdir) {
			if (unwrapErr) return loadAsDirectory(Path.dirname(x), fpkg, cb);
			var pkgfile = Path.join(pkgdir, 'package.json');
			isFile(pkgfile, function (err, ex) {
				if (err) return cb(err);
				if (!ex) return loadAsFile(Path.join(x, 'index'), fpkg, cb);

				readPackage(readFile, pkgfile, function (err, pkgParam) {
					if (err) return cb(err);

					var pkg = pkgParam;

					if (pkg && opts.packageFilter) {
						pkg = opts.packageFilter(pkg, pkgfile, pkgdir);
					}

					if (pkg && pkg.main) {
						if (typeof pkg.main !== 'string') {
							var mainError = new TypeError('package “' + pkg.name + '” `main` must be a string');
							mainError.code = 'INVALID_PACKAGE_MAIN';
							return cb(mainError);
						}
						if (pkg.main === '.' || pkg.main === './') {
							pkg.main = 'index';
						}
						loadAsFile(Path.resolve(x, pkg.main), pkg, function (err, m, pkg) {
							if (err) return cb(err);
							if (m) return cb(null, m, pkg);
							if (!pkg) return loadAsFile(Path.join(x, 'index'), pkg, cb);

							var dir = Path.resolve(x, pkg.main);
							loadAsDirectory(dir, pkg, function (err, n, pkg) {
								if (err) return cb(err);
								if (n) return cb(null, n, pkg);
								loadAsFile(Path.join(x, 'index'), pkg, function (err, m, pkg) {
									if (err) return cb(err);
									if (m) return cb(null, m, pkg);
									var incorrectMainError = new Error("Cannot find module '" + Path.resolve(x, pkg.main) + "'. Please verify that the package.json has a valid \"main\" entry");
									incorrectMainError.code = 'INCORRECT_PACKAGE_MAIN';
									return cb(incorrectMainError);
								});
							});
						});
						return;
					}

					loadAsFile(Path.join(x, '/index'), pkg, cb);
				});
			});
		});
	}

	function processDirs(cb, dirs) {
		if (dirs.length === 0) return cb(null, undefined);
		var dir = dirs[0];

		isDirectory(Path.dirname(dir), isdir);

		function isdir(err, isdir) {
			if (err) return cb(err);
			if (!isdir) return processDirs(cb, dirs.slice(1));
			loadAsFile(dir, opts.package, onfile);
		}

		function onfile(err, m, pkg) {
			if (err) return cb(err);
			if (m) return cb(null, m, pkg);
			loadAsDirectory(dir, opts.package, ondir);
		}

		function ondir(err, n, pkg) {
			if (err) return cb(err);
			if (n) return cb(null, n, pkg);
			processDirs(cb, dirs.slice(1));
		}
	}

	function loadNodeModules(x, start, cb) {
		processDirs(
			cb,
			getPackageCandidates(x, start, opts)
		);
	}
};
