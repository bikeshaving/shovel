import * as FS from "fs/promises";
import { spawn } from "child_process";
import { test, expect, beforeAll, afterAll } from "bun:test";

/**
 * Development server hot reload tests
 * Tests our Worker-based architecture for dependency invalidation
 */

const TIMEOUT = 30000; // 30 second timeout for all tests

// Helper to start a development server
function startDevServer(fixture, port) {
  const args = [
    "./src/cli.js", 
    "develop", 
    fixture, 
    "--port", 
    port.toString()
  ];
  
  return spawn("node", args, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development" }
  });
}

// Helper to wait for server to be ready and return response
async function waitForServer(port, timeoutMs = 10000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}`);
      if (response.ok) {
        return await response.text();
      }
    } catch (err) {
      // Server not ready yet, continue waiting
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  throw new Error(`Server at port ${port} never became ready within ${timeoutMs}ms`);
}

// Helper to fetch from server with retry
async function fetchWithRetry(port, retries = 5, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}`);
      return await response.text();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Helper to kill process and wait for port to be free
async function killServer(process, port) {
  if (process && !process.killed) {
    process.kill('SIGTERM');
    
    // Wait for process to exit
    await new Promise((resolve) => {
      process.on('exit', resolve);
      // Force kill if it doesn't exit gracefully
      setTimeout(() => {
        if (!process.killed) {
          process.kill('SIGKILL');
        }
      }, 2000);
    });
  }
  
  // Wait for port to be free
  await new Promise(resolve => setTimeout(resolve, 1000));
}

test("basic server startup and response", async () => {
  const PORT = 13310;
  let serverProcess;
  
  try {
    // Start development server with blog app
    serverProcess = startDevServer("./examples/blog-app/src/app.js", PORT);
    
    // Wait for server to be ready
    const response = await waitForServer(PORT);
    
    // Verify server responds correctly (blog app home page)
    expect(response).toContain("<title>Home - Shovel Blog</title>");
    
  } finally {
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);

test("hot reload on root file change", async () => {
  const PORT = 13311;
  let serverProcess;
  
  // Backup original file
  const originalContents = await FS.readFile("./fixtures/server-hello.ts", "utf8");
  
  try {
    // Start development server
    serverProcess = startDevServer("./fixtures/server-hello.ts", PORT);
    
    // Wait for initial response
    const initialResponse = await waitForServer(PORT);
    expect(initialResponse).toBe("<marquee>Hello world</marquee>");
    
    // Modify the root file
    await FS.copyFile("./fixtures/server-goodbye.ts", "./fixtures/server-hello.ts");
    
    // Wait for hot reload and verify change
    await new Promise(resolve => setTimeout(resolve, 2000)); // Give time for reload
    
    const updatedResponse = await fetchWithRetry(PORT);
    expect(updatedResponse).toBe("<marquee>Goodbye world</marquee>");
    
  } finally {
    // Restore original file
    await FS.writeFile("./fixtures/server-hello.ts", originalContents);
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);

test("hot reload on dependency change", async () => {
  const PORT = 13312;
  let serverProcess;
  
  // Backup original dependency file
  const originalDependencyContents = await FS.readFile("./fixtures/server-dependency-hello.ts", "utf8");
  
  try {
    // Start development server with file that has dependencies
    serverProcess = startDevServer("./fixtures/server-dependent.ts", PORT);
    
    // Wait for initial response
    const initialResponse = await waitForServer(PORT);
    expect(initialResponse).toBe("<marquee>Hello from dependency-hello.ts</marquee>");
    
    // Modify the dependency file
    await FS.copyFile("./fixtures/server-dependency-goodbye.ts", "./fixtures/server-dependency-hello.ts");
    
    // Wait for hot reload and verify dependency change propagated
    await new Promise(resolve => setTimeout(resolve, 2000)); // Give time for reload
    
    const updatedResponse = await fetchWithRetry(PORT);
    expect(updatedResponse).toBe("<marquee>Goodbye from dependency-hello.ts</marquee>");
    
  } finally {
    // Restore original dependency file
    await FS.writeFile("./fixtures/server-dependency-hello.ts", originalDependencyContents);
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);

test("hot reload with dynamic imports", async () => {
  const PORT = 13313;
  let serverProcess;
  
  // Backup original dependency file
  const originalDependencyContents = await FS.readFile("./fixtures/server-dependency-hello.ts", "utf8");
  
  try {
    // Start development server with file that uses dynamic imports
    serverProcess = startDevServer("./fixtures/server-dynamic-dependent.ts", PORT);
    
    // Wait for initial response
    const initialResponse = await waitForServer(PORT);
    expect(initialResponse).toBe('<marquee behavior="alternate">Hello from dependency-hello.ts</marquee>');
    
    // Modify the dependency file
    await FS.copyFile("./fixtures/server-dependency-goodbye.ts", "./fixtures/server-dependency-hello.ts");
    
    // Wait for hot reload and verify dynamic import change propagated
    await new Promise(resolve => setTimeout(resolve, 2000)); // Give time for reload
    
    const updatedResponse = await fetchWithRetry(PORT);
    expect(updatedResponse).toBe('<marquee behavior="alternate">Goodbye from dependency-hello.ts</marquee>');
    
  } finally {
    // Restore original dependency file
    await FS.writeFile("./fixtures/server-dependency-hello.ts", originalDependencyContents);
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);

test("worker coordination - multiple requests during reload", async () => {
  const PORT = 13314;
  let serverProcess;
  
  // Backup original file
  const originalContents = await FS.readFile("./fixtures/server-hello.ts", "utf8");
  
  try {
    // Start development server with multiple workers
    serverProcess = startDevServer("./fixtures/server-hello.ts", PORT);
    
    // Wait for initial response
    const initialResponse = await waitForServer(PORT);
    expect(initialResponse).toBe("<marquee>Hello world</marquee>");
    
    // Modify the file
    await FS.copyFile("./fixtures/server-goodbye.ts", "./fixtures/server-hello.ts");
    
    // Make multiple concurrent requests during reload
    await new Promise(resolve => setTimeout(resolve, 1000)); // Start reload
    
    const concurrentRequests = Array.from({ length: 10 }, () => 
      fetchWithRetry(PORT, 10, 200)
    );
    
    const responses = await Promise.all(concurrentRequests);
    
    // All responses should be consistent (either old or new, but not mixed)
    const uniqueResponses = [...new Set(responses)];
    expect(uniqueResponses.length).toBeLessThanOrEqual(2); // Should be either 1 or 2 unique responses
    
    // Final response should be the updated version
    const finalResponse = await fetchWithRetry(PORT);
    expect(finalResponse).toBe("<marquee>Goodbye world</marquee>");
    
  } finally {
    // Restore original file
    await FS.writeFile("./fixtures/server-hello.ts", originalContents);
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);

test("error handling - malformed file", async () => {
  const PORT = 13315;
  let serverProcess;
  
  // Backup original file
  const originalContents = await FS.readFile("./fixtures/server-hello.ts", "utf8");
  
  try {
    // Start development server
    serverProcess = startDevServer("./fixtures/server-hello.ts", PORT);
    
    // Wait for initial response
    const initialResponse = await waitForServer(PORT);
    expect(initialResponse).toBe("<marquee>Hello world</marquee>");
    
    // Write malformed TypeScript
    await FS.writeFile("./fixtures/server-hello.ts", "this is not valid typescript!!!");
    
    // Wait a bit for attempted reload
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Server should still be running and serving something (error page or last good version)
    const response = await fetchWithRetry(PORT);
    expect(typeof response).toBe("string");
    expect(response.length).toBeGreaterThan(0);
    
  } finally {
    // Restore original file
    await FS.writeFile("./fixtures/server-hello.ts", originalContents);
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);