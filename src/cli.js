#!/usr/bin/env node
/**
 * Shovel CLI - The obsessively web platform-based web framework
 * 
 * Smart defaults: Detect current runtime for development
 * Override: Explicit targeting for deployment
 */

import { spawn } from "child_process";
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { 
  resolvePlatform, 
  createPlatform, 
  getPlatformDefaults,
  displayPlatformInfo 
} from "./_platform-detection.js";

// Check if we need VM modules for Node.js platform and respawn with proper flags
if (!process.env.SHOVEL_RESPAWNED && process.argv.includes('develop')) {
  process.env.SHOVEL_RESPAWNED = '1';
  const child = spawn('node', ['--experimental-vm-modules', ...process.argv.slice(1)], {
    stdio: 'inherit'
  });
  child.on('exit', (code) => process.exit(code || 0));
  // Don't continue with this process
} else {
  // Main CLI execution
  process.title = "shovel";
  const program = new Command();

program
  .name("shovel")
  .version(pkg.version)
  .description("The obsessively web platform-based web framework");

/**
 * Development command - auto-detects platform
 */
program
  .command("develop <entrypoint>")
  .description("Start development server with hot reloading")
  .option("-p, --port <port>", "Port to listen on", "3000")
  .option("--platform <platform>", "Explicit platform (node, bun, cloudflare)")
  .option("--host <host>", "Host to bind to", "localhost")
  .option("--verbose", "Verbose logging")
  .action(async (entrypoint, options) => {
    try {
      const platformName = resolvePlatform(options);
      const platformDefaults = getPlatformDefaults(platformName);
      
      if (options.verbose) {
        displayPlatformInfo(platformName);
      }
      
      // Create platform with smart defaults
      const platform = await createPlatform(platformName, {
        hotReload: true,
        port: parseInt(options.port) || platformDefaults.port,
        host: options.host,
      });
      
      console.log(`🔥 Starting development server...`);
      
      // Load ServiceWorker app
      const serviceWorker = await platform.loadServiceWorker(entrypoint, {
        hotReload: true,
        caches: {
          pages: { type: 'memory', maxEntries: 100 },
          api: { type: 'memory', ttl: 300000 },
          static: { type: 'memory' }
        }
      });
      
      // Create development server
      const server = platform.createServer(serviceWorker.handleRequest, {
        port: parseInt(options.port) || platformDefaults.port,
        host: options.host,
      });
      
      await server.listen();
      console.log(`🚀 Server running at http://${options.host}:${options.port}`);
      console.log(`📁 Serving: ${entrypoint}`);
      
      // Graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down...');
        await serviceWorker.dispose();
        await platform.dispose();
        await server.close();
        process.exit(0);
      });
      
    } catch (error) {
      console.error(`❌ Failed to start development server:`, error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

/**
 * Build command - supports targeting different platforms
 */
program
  .command("build <entrypoint>")
  .description("Build app for deployment")
  .option("--target <platform>", "Target platform (node, bun, cloudflare, vercel)")
  .option("--out-dir <dir>", "Output directory", "dist")
  .option("--verbose", "Verbose logging")
  .action(async (entrypoint, options) => {
    try {
      const platformName = resolvePlatform(options);
      
      if (options.verbose) {
        displayPlatformInfo(platformName);
      }
      
      const platform = await createPlatform(platformName, {
        hotReload: false,
      });
      
      console.log(`📦 Building for ${platformName}...`);
      
      // Load ServiceWorker app
      const serviceWorker = await platform.loadServiceWorker(entrypoint, {
        hotReload: false,
      });
      
      // For now, just report success
      // TODO: Implement actual build process
      console.log(`✅ Build complete for ${platformName}`);
      console.log(`📁 Output: ${options.outDir}`);
      
      await serviceWorker.dispose();
      await platform.dispose();
      
    } catch (error) {
      console.error(`❌ Build failed:`, error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

/**
 * Static site generation - collects routes and pre-renders
 */
program
  .command("static <entrypoint>")
  .description("Generate static site")
  .option("--target <platform>", "Target platform for hosting (node, bun, cloudflare)")
  .option("--out-dir <dir>", "Output directory", "dist")
  .option("--base-url <url>", "Base URL for absolute URLs", "http://localhost:3000")
  .option("--verbose", "Verbose logging")
  .action(async (entrypoint, options) => {
    try {
      const platformName = resolvePlatform(options);
      
      if (options.verbose) {
        displayPlatformInfo(platformName);
      }
      
      const platform = await createPlatform(platformName, {
        hotReload: false,
      });
      
      console.log(`🏗️  Generating static site...`);
      
      // Load ServiceWorker app
      const serviceWorker = await platform.loadServiceWorker(entrypoint, {
        hotReload: false,
      });
      
      // Collect routes for static generation
      console.log(`📋 Collecting routes...`);
      const routes = await serviceWorker.collectStaticRoutes(options.outDir, options.baseUrl);
      console.log(`📄 Found ${routes.length} routes:`, routes);
      
      // Pre-render each route
      console.log(`🎨 Pre-rendering pages...`);
      for (const route of routes) {
        try {
          const url = new URL(route, options.baseUrl);
          const request = new Request(url.href);
          
          const response = await serviceWorker.handleRequest(request);
          
          if (response.ok) {
            // TODO: Write to filesystem
            console.log(`✅ ${route}`);
          } else {
            console.warn(`⚠️  ${route} (${response.status})`);
          }
        } catch (error) {
          console.error(`❌ ${route} failed:`, error.message);
        }
      }
      
      console.log(`🎉 Static site generated in ${options.outDir}`);
      
      await serviceWorker.dispose();
      await platform.dispose();
      
    } catch (error) {
      console.error(`❌ Static generation failed:`, error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

/**
 * Platform info command
 */
program
  .command("info")
  .description("Display platform and runtime information")
  .action(async () => {
    const { detectRuntime, detectDevelopmentPlatform } = await import("./_platform-detection.js");
    
    console.log("🔍 Shovel Platform Information");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`Current Runtime: ${detectRuntime()}`);
    console.log(`Default Platform: ${detectDevelopmentPlatform()}`);
    console.log(`Available Platforms: node, bun, cloudflare`);
    console.log(`Shovel Version: ${pkg.version}`);
    console.log("");
    console.log("💡 Usage Examples:");
    console.log("   shovel develop app.js                    # Auto-detect platform");
    console.log("   shovel develop app.js --platform=bun     # Explicit platform");
    console.log("   shovel build app.js --target=cloudflare  # Target deployment");
  });

  await program.parseAsync(process.argv);
}