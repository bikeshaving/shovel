/**
 * Production build system for Shovel apps
 * Creates self-contained, directly executable production builds
 */

import * as esbuild from "esbuild";
import {resolve, join, dirname} from "path";
import {mkdir, readFile, writeFile, chmod} from "fs/promises";
import {assetsPlugin} from "../assets.ts";

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
 * Build ServiceWorker app for production deployment
 * Creates directly executable output with platform-specific bootstrapping
 */
export async function buildForProduction({entrypoint, outDir, verbose, platform = "node", workerCount = 1}) {
	try {
		const buildContext = await initializeBuild({entrypoint, outDir, verbose, platform, workerCount});
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
async function initializeBuild({entrypoint, outDir, verbose, platform, workerCount = 1}) {
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
		verbose,
		workerCount
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
async function createBuildConfig({entryPath, serverDir, assetsDir, workspaceRoot, platform, workerCount}) {
	const isCloudflare = platform === "cloudflare" || platform === "cloudflare-workers";
	
	try {
		// Create virtual entry point that properly imports platform dependencies
		const virtualEntry = await createVirtualEntry(entryPath, platform, workerCount);
		
		// Determine external dependencies based on environment
		const external = ["node:*"];
		
		// For Node.js and Bun builds, handle @b9g dependencies
		if (!isCloudflare) {
			// In workspace environments, always externalize @b9g packages
			// because they may not be resolvable in test environments
			const isWorkspaceContext = workspaceRoot && workspaceRoot !== process.cwd();
			
			if (isWorkspaceContext) {
				// Workspace environment - externalize @b9g packages
				external.push("@b9g/*");
			} else {
				// Production environment - bundle @b9g packages for self-contained executables
				// (no externalization needed)
			}
		}
		
		const buildConfig = {
			stdin: {
				contents: virtualEntry,
				resolveDir: workspaceRoot || dirname(entryPath),
				sourcefile: 'virtual-entry.js'
			},
			bundle: true,
			format: BUILD_DEFAULTS.format,
			target: BUILD_DEFAULTS.target,
			platform: isCloudflare ? "browser" : "node",
			outfile: join(serverDir, BUILD_DEFAULTS.outputFile),
			absWorkingDir: workspaceRoot,
			mainFields: ["module", "main"],
			conditions: ["import", "module"],
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
			external,
		};
		
		if (isCloudflare) {
			await configureCloudflareTarget(buildConfig);
		}
		
		return buildConfig;
	} catch (error) {
		throw new Error(`Failed to create build configuration: ${error.message}`);
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
 * Create virtual entry point with proper imports and worker management
 */
async function createVirtualEntry(userEntryPath, platform, workerCount = 1) {
	const isCloudflare = platform === "cloudflare" || platform === "cloudflare-workers";
	
	if (isCloudflare) {
		// For Cloudflare Workers, import the user code directly
		// Cloudflare-specific runtime setup is handled by platform package
		return `
// Import user's ServiceWorker code
import "${userEntryPath}";
`;
	}
	
	// For Node.js/Bun platforms, choose architecture based on worker count
	if (workerCount === 1) {
		return await createSingleWorkerEntry(userEntryPath);
	} else {
		return await createMultiWorkerEntry(userEntryPath, workerCount);
	}
}

/**
 * Create single-worker entry point (current approach)
 */
async function createSingleWorkerEntry(userEntryPath) {
	return `#!/usr/bin/env node
/**
 * Shovel Production Server (Single Worker)
 * Self-contained build with bundled dependencies
 */

import { ServiceWorkerRuntime, createServiceWorkerGlobals, createBucketStorage } from '@b9g/platform';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { realpath } from 'fs';
import { promisify } from 'util';

const realpathAsync = promisify(realpath);

// Production server setup
const runtime = new ServiceWorkerRuntime();
// For executables, bucket storage root should be the dist directory
// This allows buckets.getDirectoryHandle("assets") to find dist/assets
const executableDir = dirname(fileURLToPath(import.meta.url));
const distDir = dirname(executableDir);
const buckets = createBucketStorage(distDir);

// Set up ServiceWorker globals
createServiceWorkerGlobals(runtime, { buckets });
globalThis.self = runtime;
globalThis.addEventListener = runtime.addEventListener.bind(runtime);
globalThis.removeEventListener = runtime.removeEventListener.bind(runtime);
globalThis.dispatchEvent = runtime.dispatchEvent.bind(runtime);

// Dynamically import user's ServiceWorker code after globals are set up
await import("${userEntryPath}");

// Check if this is being run as the main executable
try {
  const currentFile = await realpathAsync(fileURLToPath(import.meta.url));
  const mainFile = await realpathAsync(process.argv[1]);
  
  if (currentFile === mainFile) {
  // Wait for ServiceWorker to be defined, then start server
  setTimeout(async () => {
    console.info('🔧 Starting single-worker server...');
    await runtime.install();
    await runtime.activate();
    
    // Create HTTP server
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
      console.info(\`🚀 Single-worker server running at http://\${HOST}:\${PORT}\`);
    });
    
    // Graceful shutdown
    const shutdown = async () => {
      console.info('\\n🛑 Shutting down single-worker server...');
      await new Promise(resolve => httpServer.close(resolve));
      process.exit(0);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }, 0);
  }
} catch (error) {
  console.error('🚨 Error in main executable check:', error);
}
`;
}

/**
 * Create multi-worker entry point with real Node.js Worker threads
 */
async function createMultiWorkerEntry(userEntryPath, workerCount) {
	return `#!/usr/bin/env node
/**
 * Shovel Production Server (Multi-Worker)
 * Spawns ${workerCount} real Node.js Worker threads for true concurrency
 */

import { Worker, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Check if this is being run as the main executable (not a worker thread)
if (import.meta.url === \`file://\${process.argv[1]}\` && !workerData?.isWorker) {
  console.info('🔧 Starting multi-worker server...');
  console.info(\`⚡ Spawning \${${workerCount}} worker threads...\`);
  
  const workers = [];
  const workerRequests = new Map();
  let currentWorker = 0;
  let requestId = 0;
  
  // Get the path to the current script to use as worker script
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // Create worker threads
  for (let i = 0; i < ${workerCount}; i++) {
    const worker = new Worker(__filename, {
      workerData: { 
        workerId: i,
        userEntryPath: "${userEntryPath}",
        isWorker: true
      }
    });
    
    worker.on('message', (message) => {
      if (message.type === 'worker-ready') {
        console.info(\`✅ Worker \${i} ready\`);
      } else if (message.type === 'response') {
        const pending = workerRequests.get(message.requestId);
        if (pending) {
          workerRequests.delete(message.requestId);
          
          // Convert serialized response back to Response object
          const response = new Response(message.body, {
            status: message.status,
            statusText: message.statusText,
            headers: new Headers(message.headers)
          });
          
          pending.resolve(response);
        }
      }
    });
    
    worker.on('error', (error) => {
      console.error(\`❌ Worker \${i} error:\`, error);
    });
    
    workers.push(worker);
  }
  
  // Round-robin load balancer
  function getNextWorker() {
    const worker = workers[currentWorker];
    currentWorker = (currentWorker + 1) % workers.length;
    return worker;
  }
  
  // Handle request via workers
  async function handleRequest(request) {
    const worker = getNextWorker();
    const reqId = ++requestId;
    
    // Serialize request body if it exists
    const requestBody = request.body ? await request.text() : null;
    
    return new Promise((resolve, reject) => {
      workerRequests.set(reqId, { resolve, reject });
      
      // Serialize request for worker thread
      worker.postMessage({
        type: 'request',
        requestId: reqId,
        url: request.url,
        method: request.method,
        headers: Array.from(request.headers.entries()),
        body: requestBody
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (workerRequests.has(reqId)) {
          workerRequests.delete(reqId);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }
  
  // Create HTTP server that load balances across workers
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

      const response = await handleRequest(request);

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
    console.info(\`🚀 Multi-worker server running at http://\${HOST}:\${PORT}\`);
    console.info(\`⚡ Load balancing across \${${workerCount}} workers\`);
  });
  
  // Graceful shutdown
  const shutdown = async () => {
    console.info('\\n🛑 Shutting down multi-worker server...');
    
    // Terminate all workers
    await Promise.all(workers.map(worker => {
      return new Promise((resolve) => {
        worker.terminate().then(resolve).catch(resolve);
      });
    }));
    
    await new Promise(resolve => httpServer.close(resolve));
    console.info('✅ All workers terminated');
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
}

// WORKER THREAD CODE - this needs to be at top level for imports
import { ServiceWorkerRuntime, createServiceWorkerGlobals, createBucketStorage } from '@b9g/platform';
import { parentPort } from 'worker_threads';

if (workerData?.isWorker && parentPort) {
    console.info(\`[Worker \${workerData.workerId}] Starting ServiceWorker...\`);
    
    // Set up ServiceWorker environment in worker thread
    const runtime = new ServiceWorkerRuntime();
    // For executables, bucket storage root should be the dist directory
    const executableDir = dirname(fileURLToPath(import.meta.url));
    const distDir = dirname(executableDir);
    const buckets = createBucketStorage(distDir);
    
    createServiceWorkerGlobals(runtime, { buckets });
    globalThis.self = runtime;
    globalThis.addEventListener = runtime.addEventListener.bind(runtime);
    globalThis.removeEventListener = runtime.removeEventListener.bind(runtime);
    globalThis.dispatchEvent = runtime.dispatchEvent.bind(runtime);
    
    // Import user's ServiceWorker code
    await import(workerData.userEntryPath);
    
    // Initialize ServiceWorker
    await runtime.install();
    await runtime.activate();
    
    // Handle messages from main thread
    parentPort.on('message', async (message) => {
      if (message.type === 'request') {
        try {
          // Reconstruct request object
          const request = new Request(message.url, {
            method: message.method,
            headers: new Headers(message.headers),
            body: message.body
          });
          
          const response = await runtime.handleRequest(request);
          
          // Serialize response for main thread
          const responseBody = response.body ? await response.text() : null;
          
          parentPort.postMessage({
            type: 'response',
            requestId: message.requestId,
            status: response.status,
            statusText: response.statusText,
            headers: Array.from(response.headers.entries()),
            body: responseBody
          });
          
        } catch (error) {
          console.error(\`[Worker \${workerData.workerId}] Request error:\`, error);
          
          parentPort.postMessage({
            type: 'response',
            requestId: message.requestId,
            status: 500,
            statusText: 'Internal Server Error',
            headers: [['Content-Type', 'text/plain']],
            body: 'Internal Server Error'
          });
        }
      }
    });
    
    // Signal that worker is ready
    parentPort.postMessage({ type: 'worker-ready' });
    console.info(\`[Worker \${workerData.workerId}] Ready to handle requests\`);
}
`;
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
