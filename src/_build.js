/**
 * Production build system for Shovel apps
 * Creates self-contained, directly executable production builds
 */

import * as esbuild from "esbuild";
import {resolve, join, dirname} from "path";
import {mkdir, readFile, writeFile, chmod} from "fs/promises";
import {assetsPlugin} from "./assets.ts";

// Build configuration constants
const BUILD_DEFAULTS = {
	format: "esm",
	target: "es2022",
	outputFile: "app.js",
	sourcemap: false,
	minify: false,
	treeShaking: true,
	environment: {
		"process.env.NODE_ENV": '"production"'
	}
};

// Directory structure for separate buckets
const BUILD_STRUCTURE = {
	serverDir: "server",
	assetsDir: "assets"
};

/**
 * Get platform externals based on environment
 * In workspace environments, bundle @b9g packages since they're not published
 */
async function getPlatformExternals(platform) {
	const workspaceRoot = await findWorkspaceRoot();
	const isWorkspaceEnvironment = workspaceRoot !== null;

	if (isWorkspaceEnvironment) {
		// In workspace environment (tests), bundle @b9g packages
		const externals = {
			node: ["node:*"],
			bun: ["node:*"], 
			cloudflare: []
		}[platform] || ["node:*"];
		// Debug: console.debug(`🔧 Workspace mode externals for ${platform}:`, externals);
		return externals;
	} else {
		// In production environment, keep @b9g packages external
		const externals = {
			node: ["node:*", "@b9g/*"],
			bun: ["node:*", "@b9g/*"],
			cloudflare: []
		}[platform] || ["node:*", "@b9g/*"];
		// Debug: console.debug(`🔧 Production mode externals for ${platform}:`, externals);
		return externals;
	}
}

/**
 * Build ServiceWorker app for production deployment
 * Creates directly executable output with platform-specific bootstrapping
 */
export async function buildForProduction({entrypoint, outDir, verbose, platform = "node"}) {
	try {
		const buildContext = await initializeBuild({entrypoint, outDir, verbose, platform});
		const buildConfig = await createBuildConfig(buildContext);
		const result = await esbuild.build(buildConfig);
		
		// Make the output executable (for directly executable builds)
		const appPath = join(buildContext.serverDir, "app.js");
		await chmod(appPath, 0o755);
		
		if (verbose && result.metafile) {
			await logBundleAnalysis(result.metafile);
		}
		
		await generatePackageJson({...buildContext, entryPath: buildContext.entryPath});
		
		if (verbose) {
			console.info(`📦 Built app to ${buildContext.outputDir}`);
			console.info(`📂 Server files: ${buildContext.serverDir}`);
			console.info(`📂 Asset files: ${buildContext.assetsDir}`);
		}
	} catch (error) {
		console.error(`❌ Build failed: ${error.message}`);
		if (verbose) {
			console.error(`📍 Error details:`, error);
			console.error(`📍 Stack trace:`, error.stack);
		}
		throw error;
	} finally {
		// Ensure esbuild resources are cleaned up
		// This helps prevent service corruption in test environments
		try {
			await esbuild.stop();
		} catch (stopError) {
			// Ignore errors during cleanup
		}
	}
}

/**
 * Initialize build context with validated paths and settings
 */
async function initializeBuild({entrypoint, outDir, verbose, platform}) {
	// Validate inputs
	if (!entrypoint) {
		throw new Error("Entry point is required");
	}
	if (!outDir) {
		throw new Error("Output directory is required");
	}
	
	const entryPath = resolve(entrypoint);
	const outputDir = resolve(outDir);
	
	// Validate entry point exists and is accessible
	try {
		const stats = await readFile(entryPath, 'utf8');
		if (stats.length === 0) {
			console.warn(`⚠️  Entry point is empty: ${entryPath}`);
		}
	} catch (error) {
		throw new Error(`Entry point not found or not accessible: ${entryPath}`);
	}
	
	// Validate platform
	const validPlatforms = ['node', 'bun', 'cloudflare', 'cloudflare-workers'];
	if (!validPlatforms.includes(platform)) {
		throw new Error(`Invalid platform: ${platform}. Valid platforms: ${validPlatforms.join(', ')}`);
	}
	
	const workspaceRoot = await findWorkspaceRoot();
	
	if (verbose) {
		console.info(`📂 Entry: ${entryPath}`);
		console.info(`📂 Output: ${outputDir}`);
		console.info(`🎯 Target platform: ${platform}`);
		console.info(`🏠 Workspace root: ${workspaceRoot}`);
	}
	
	// Ensure output directory structure exists
	try {
		await mkdir(outputDir, {recursive: true});
		await mkdir(join(outputDir, BUILD_STRUCTURE.serverDir), {recursive: true});
		await mkdir(join(outputDir, BUILD_STRUCTURE.assetsDir), {recursive: true});
	} catch (error) {
		throw new Error(`Failed to create output directory structure: ${error.message}`);
	}
	
	return {
		entryPath,
		outputDir,
		serverDir: join(outputDir, BUILD_STRUCTURE.serverDir),
		assetsDir: join(outputDir, BUILD_STRUCTURE.assetsDir),
		workspaceRoot,
		platform,
		verbose
	};
}

/**
 * Find workspace root by looking for package.json with workspaces field
 */
async function findWorkspaceRoot() {
	let workspaceRoot = process.cwd();
	while (workspaceRoot !== dirname(workspaceRoot)) {
		try {
			const packageJson = JSON.parse(
				await readFile(resolve(workspaceRoot, "package.json"), "utf8")
			);
			if (packageJson.workspaces) {
				return workspaceRoot;
			}
		} catch {
			// No package.json found, continue up the tree
		}
		workspaceRoot = dirname(workspaceRoot);
	}
	return workspaceRoot;
}

/**
 * Create esbuild configuration for the target platform
 */
async function createBuildConfig({entryPath, serverDir, assetsDir, workspaceRoot, platform}) {
	const isCloudflare = platform === "cloudflare" || platform === "cloudflare-workers";
	
	try {
		const buildConfig = {
			entryPoints: [entryPath],
			bundle: true,
			format: BUILD_DEFAULTS.format,
			target: BUILD_DEFAULTS.target,
			platform: isCloudflare ? "browser" : "node",
			outfile: join(serverDir, BUILD_DEFAULTS.outputFile),
			absWorkingDir: workspaceRoot,
			plugins: [
				assetsPlugin({
					outputDir: assetsDir,
					manifest: join(serverDir, "asset-manifest.json"),
					dev: false,
				}),
			],
			metafile: true,
			sourcemap: BUILD_DEFAULTS.sourcemap,
			minify: BUILD_DEFAULTS.minify,
			treeShaking: BUILD_DEFAULTS.treeShaking,
			define: BUILD_DEFAULTS.environment,
			external: await getPlatformExternals(platform),
		};
		
		if (isCloudflare) {
			await configureCloudflareTarget(buildConfig);
		} else {
			await configureNodeTarget(buildConfig);
		}
		
		return buildConfig;
	} catch (error) {
		throw new Error(`Failed to create build configuration: ${error.message}`);
	}
}
	
/**
 * Configure build for Node.js/Bun targets with production bootstrap
 */
async function configureNodeTarget(buildConfig) {
	try {
		buildConfig.banner = {
			js: await generateNodeBootstrap()
		};
	} catch (error) {
		throw new Error(`Failed to configure Node.js target: ${error.message}`);
	}
}

/**
 * Configure build for Cloudflare Workers target
 */
async function configureCloudflareTarget(buildConfig) {
	buildConfig.platform = "browser";
	buildConfig.conditions = ["worker", "browser"];
	
	try {
		const {cloudflareWorkerBanner, cloudflareWorkerFooter} = await import("@b9g/platform-cloudflare");
		buildConfig.banner = { js: cloudflareWorkerBanner };
		buildConfig.footer = { js: cloudflareWorkerFooter };
	} catch (error) {
		throw new Error(
			"@b9g/platform-cloudflare is required for Cloudflare builds. Install it with: bun add @b9g/platform-cloudflare"
		);
	}
}

/**
 * Generate Node.js production bootstrap code
 */
async function generateNodeBootstrap() {
	return `#!/usr/bin/env node
/**
 * Shovel Production Server
 * Self-contained build - run 'npm install' in this directory first
 */

import { ServiceWorkerRuntime, createServiceWorkerGlobals, createBucketStorage } from '@b9g/platform';

// Check if this is being run as the main executable
if (import.meta.url === \`file://\${process.argv[1]}\`) {
  ${await generateServerBootstrap()}
}

// User's ServiceWorker code follows...
`;
}

/**
 * Generate HTTP server bootstrap code
 */
async function generateServerBootstrap() {
	return `// Production server mode - use proven single-threaded approach
  const runtime = new ServiceWorkerRuntime();
  const buckets = createBucketStorage(process.cwd());
  
  // Set up ServiceWorker globals (same as development)
  createServiceWorkerGlobals(runtime, { buckets });
  globalThis.self = runtime;
  globalThis.addEventListener = runtime.addEventListener.bind(runtime);
  globalThis.removeEventListener = runtime.removeEventListener.bind(runtime);
  globalThis.dispatchEvent = runtime.dispatchEvent.bind(runtime);
  
  // ServiceWorker code will execute after this banner...
  
  // Wait for ServiceWorker to be defined, then start server
  setTimeout(async () => {
    await runtime.install();
    await runtime.activate();
    
    ${await generateHttpServer()}
  }, 0);`;
}

/**
 * Generate HTTP server creation code
 */
async function generateHttpServer() {
	return `// Create HTTP server using proven pattern
    const { createServer } = await import('http');
    const PORT = process.env.PORT || 8080;
    const HOST = process.env.HOST || '0.0.0.0';
    
    const httpServer = createServer(async (req, res) => {
      try {
        const url = \`http://\${req.headers.host}\${req.url}\`;
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          body: req.method !== 'GET' && req.method !== 'HEAD' ? req : undefined,
        });

        const response = await runtime.handleRequest(request);

        res.statusCode = response.status;
        res.statusMessage = response.statusText;
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });

        if (response.body) {
          const reader = response.body.getReader();
          const pump = async () => {
            const {done, value} = await reader.read();
            if (done) {
              res.end();
            } else {
              res.write(value);
              await pump();
            }
          };
          await pump();
        } else {
          res.end();
        }
      } catch (error) {
        console.error('Request error:', error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Internal Server Error');
      }
    });

    httpServer.listen(PORT, HOST, () => {
      console.info(\`🚀 Server running at http://\${HOST}:\${PORT}\`);
    });
    
    // Graceful shutdown
    const shutdown = async () => {
      console.info('\\n🛑 Shutting down...');
      await new Promise(resolve => httpServer.close(resolve));
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);`;
}
	
/**
 * Log bundle analysis if metafile is available
 */
async function logBundleAnalysis(metafile) {
	try {
		console.info("📊 Bundle analysis:");
		const analysis = await esbuild.analyzeMetafile(metafile);
		console.info(analysis);
	} catch (error) {
		console.warn(`⚠️  Failed to analyze bundle: ${error.message}`);
	}
}

/**
 * Generate or copy package.json to output directory for self-contained deployment
 */
async function generatePackageJson({serverDir, platform, verbose, entryPath}) {
	// Look for package.json in the same directory as the entrypoint, not cwd
	const entryDir = dirname(entryPath);
	const sourcePackageJsonPath = resolve(entryDir, "package.json");
	
	try {
		// First try to copy existing package.json from source directory
		const packageJsonContent = await readFile(sourcePackageJsonPath, "utf8");
		
		// Validate package.json is valid JSON
		try {
			JSON.parse(packageJsonContent);
		} catch (parseError) {
			throw new Error(`Invalid package.json format: ${parseError.message}`);
		}
		
		await writeFile(join(serverDir, "package.json"), packageJsonContent, "utf8");
		if (verbose) {
			console.info(`📄 Copied package.json to ${serverDir}`);
		}
	} catch (error) {
		// If no package.json exists in source, generate one for executable builds
		if (verbose) {
			console.warn(`⚠️  Could not copy package.json: ${error.message}`);
		}
		
		try {
			const generatedPackageJson = await generateExecutablePackageJson(platform);
			await writeFile(join(serverDir, "package.json"), JSON.stringify(generatedPackageJson, null, 2), "utf8");
			if (verbose) {
				console.info(`📄 Generated package.json for ${platform} platform`);
				console.info(`📄 Package.json contents:`, JSON.stringify(generatedPackageJson, null, 2));
			}
		} catch (generateError) {
			if (verbose) {
				console.warn(`⚠️  Could not generate package.json: ${generateError.message}`);
				console.warn(`📍 Generation error details:`, generateError);
			}
			// Don't fail the build if package.json generation fails
		}
	}
}

/**
 * Generate a minimal package.json for executable builds
 */
async function generateExecutablePackageJson(platform) {
	const packageJson = {
		name: "shovel-executable",
		version: "1.0.0",
		type: "module",
		private: true,
		dependencies: {}
	};

	// Check if we're in a workspace environment
	const workspaceRoot = await findWorkspaceRoot();
	const isWorkspaceEnvironment = workspaceRoot !== null;

	if (isWorkspaceEnvironment) {
		// In workspace environment (like tests), create empty dependencies
		// since workspace packages can't be installed via npm
		// The bundler will handle all necessary dependencies
		packageJson.dependencies = {};
	} else {
		// In production/published environment, add platform dependencies
		// Add platform-specific dependencies
		switch (platform) {
			case "node":
				packageJson.dependencies["@b9g/platform-node"] = "^0.1.0";
				break;
			case "bun":
				packageJson.dependencies["@b9g/platform-bun"] = "^0.1.0";
				break;
			case "cloudflare":
				packageJson.dependencies["@b9g/platform-cloudflare"] = "^0.1.0";
				break;
			default:
				// Generic platform dependencies
				packageJson.dependencies["@b9g/platform"] = "^0.1.0";
		}

		// Add core dependencies needed for runtime
		packageJson.dependencies["@b9g/cache"] = "^0.1.0";
		packageJson.dependencies["@b9g/filesystem"] = "^0.1.0";
	}

	return packageJson;
}
