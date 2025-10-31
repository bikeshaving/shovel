#!/usr/bin/env node
/**
 * Populate static assets for blog app testing
 * This demonstrates using the new File System Access API
 */

import { populateStaticAssets } from "@b9g/staticfiles/populate";
import { getFileSystemRoot, platformRegistry } from "@b9g/platform";
import { createNodePlatform } from "@b9g/platform-node";
import fs from "fs/promises";
import path from "path";

// Manually register Node.js platform for development
platformRegistry.register("node", createNodePlatform());

console.log("🗂️  Populating static assets for blog app...");

// Create sample static assets if they don't exist
await fs.mkdir("src/assets", { recursive: true });

// Create a simple CSS file
const cssContent = `
/* Shovel Blog App Styles */
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  line-height: 1.6;
  margin: 0;
  padding: 20px;
  background: #f8f9fa;
}

header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 0;
  border-bottom: 2px solid #e9ecef;
  margin-bottom: 30px;
}

header img {
  border-radius: 8px;
}

h1 {
  margin: 0;
  color: #343a40;
}

.subtitle {
  margin: 0;
  color: #6c757d;
  font-style: italic;
}

nav {
  margin: 20px 0;
}

nav a {
  margin-right: 20px;
  padding: 8px 16px;
  background: #007bff;
  color: white;
  text-decoration: none;
  border-radius: 4px;
  font-weight: 500;
}

nav a:hover {
  background: #0056b3;
}

.cache-info {
  background: #e7f3ff;
  border: 1px solid #b3d7ff;
  padding: 12px;
  border-radius: 4px;
  margin: 20px 0;
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 14px;
}

.post {
  background: white;
  padding: 20px;
  margin: 20px 0;
  border-radius: 8px;
  border: 1px solid #e9ecef;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.post h2 {
  margin-top: 0;
  color: #343a40;
}

.post h2 a {
  color: inherit;
  text-decoration: none;
}

.post h2 a:hover {
  color: #007bff;
}

.meta {
  color: #6c757d;
  font-size: 14px;
  margin-bottom: 12px;
}

footer {
  margin-top: 40px;
  padding-top: 20px;
  border-top: 1px solid #e9ecef;
  text-align: center;
  color: #6c757d;
}

pre {
  background: #f8f9fa;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
}
`;

await fs.writeFile("src/assets/styles.css", cssContent);

// Create a simple SVG logo
const logoSvg = `
<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <rect width="48" height="48" rx="8" fill="#007bff"/>
  <text x="24" y="32" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="20" font-weight="bold">S</text>
</svg>
`.trim();

await fs.writeFile("src/assets/logo.svg", logoSvg);

console.log("📄 Created sample assets: styles.css, logo.svg");

// Now populate them to the File System Access API storage
try {
  await populateStaticAssets({
    sourceDir: "src/assets",
    filesystem: "static",
    include: ["*", "*.*", "**/*"],
    verbose: true,
  });
  
  console.log("✅ Successfully populated static assets to File System Access API storage");
  
  // Test reading back from filesystem
  console.log("\n🔍 Testing File System Access API...");
  const root = await getFileSystemRoot("static");
  
  console.log("📂 Files in static filesystem:");
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === "file") {
      const file = await handle.getFile();
      console.log(`  📄 ${name} (${file.size} bytes, ${file.type})`);
    } else {
      console.log(`  📁 ${name}/`);
    }
  }
  
} catch (error) {
  console.error("❌ Error populating assets:", error);
  process.exit(1);
}