/**
 * Production build system for Shovel apps
 * Creates self-contained, directly executable production builds
 */

import * as esbuild from "esbuild";
import {resolve, join, dirname} from "path";
import {mkdir, readFile, writeFile} from "fs/promises";
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

const PLATFORM_EXTERNALS = {
	node: ["node:*", "@b9g/*"],
	bun: ["node:*", "@b9g/*"],
	cloudflare: [] // Bundle everything for Cloudflare
};

/**
 * Build ServiceWorker app for production deployment
 * Creates directly executable output with platform-specific bootstrapping
 */
export async function buildForProduction({entrypoint, outDir, verbose, platform = "node"}) {
	try {
		const buildContext = await initializeBuild({entrypoint, outDir, verbose, platform});
		const buildConfig = await createBuildConfig(buildContext);
		const result = await esbuild.build(buildConfig);
		
		if (verbose && result.metafile) {
			await logBundleAnalysis(result.metafile);
		}
		
		await copyPackageJson(buildContext);
		
		if (verbose) {
			console.info(`📦 Built app to ${buildContext.outputDir}`);
			console.info(`📂 Server files: ${buildContext.serverDir}`);
			console.info(`📂 Asset files: ${buildContext.assetsDir}`);
		}
	} catch (error) {
		console.error(`❌ Build failed: ${error.message}`);
		throw error;
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
			external: PLATFORM_EXTERNALS[platform] || PLATFORM_EXTERNALS.node,
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
 * Copy package.json to output directory for self-contained deployment
 */
async function copyPackageJson({serverDir, verbose}) {
	const packageJsonPath = resolve(process.cwd(), "package.json");
	try {
		const packageJsonContent = await readFile(packageJsonPath, "utf8");
		
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
		if (verbose) {
			console.warn(`⚠️  Could not copy package.json: ${error.message}`);
		}
		// Don't fail the build if package.json copy fails - it's optional for some deployments
	}
}
