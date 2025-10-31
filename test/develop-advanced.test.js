import * as FS from "fs/promises";
import { spawn } from "child_process";
import { test, expect, beforeAll, afterAll } from "bun:test";

/**
 * Advanced development server tests
 * Tests more complex scenarios and edge cases for the Worker-based architecture
 */

const TIMEOUT = 45000; // 45 second timeout for complex tests

// Helper to start a development server
function startDevServer(fixture, port, extraArgs = []) {
  const args = [
    "./src/cli.js", 
    "develop", 
    fixture, 
    "--port", 
    port.toString(),
    ...extraArgs
  ];
  
  return spawn("node", args, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development" }
  });
}

// Helper to wait for server to be ready and return response
async function waitForServer(port, timeoutMs = 15000) {
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
async function fetchWithRetry(port, path = "/", retries = 10, delay = 300) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`http://localhost:${port}${path}`);
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
      }, 3000);
    });
  }
  
  // Wait for port to be free
  await new Promise(resolve => setTimeout(resolve, 1500));
}

test("deep dependency chain hot reload", async () => {
  const PORT = 13320;
  let serverProcess;
  
  // Create test files for deep dependency chain
  const fileA = "./fixtures/chain-a.ts";
  const fileB = "./fixtures/chain-b.ts"; 
  const fileC = "./fixtures/chain-c.ts";
  const fileMain = "./fixtures/chain-main.ts";
  
  // Backup any existing files
  const backups = {};
  for (const file of [fileA, fileB, fileC, fileMain]) {
    try {
      backups[file] = await FS.readFile(file, "utf8");
    } catch (e) {
      // File doesn't exist, will be created
    }
  }
  
  try {
    // Create deep dependency chain: main -> A -> B -> C
    await FS.writeFile(fileC, `export const value = "C-original";`);
    await FS.writeFile(fileB, `import {value as cValue} from "./chain-c.ts"; export const value = "B-" + cValue;`);
    await FS.writeFile(fileA, `import {value as bValue} from "./chain-b.ts"; export const value = "A-" + bValue;`);
    await FS.writeFile(fileMain, `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {value} from "./chain-a.ts";

export default {
  async fetch(req: Request) {
    const html = renderer.render(jsx\`<div>\${value}</div>\`);
    return new Response(html, {
      headers: {"content-type": "text/html; charset=UTF-8"},
    });
  },
};`);

    serverProcess = startDevServer(fileMain, PORT);
    
    // Wait for initial response - should show deep chain
    const initialResponse = await waitForServer(PORT);
    expect(initialResponse).toBe("<div>A-B-C-original</div>");
    
    // Modify the deepest dependency (C)
    await FS.writeFile(fileC, `export const value = "C-modified";`);
    
    // Wait for hot reload to propagate through the chain
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const updatedResponse = await fetchWithRetry(PORT);
    expect(updatedResponse).toBe("<div>A-B-C-modified</div>");
    
  } finally {
    // Restore original files
    for (const [file, content] of Object.entries(backups)) {
      if (content) {
        await FS.writeFile(file, content);
      } else {
        try { await FS.unlink(file); } catch (e) {}
      }
    }
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);

test("concurrent file modifications", async () => {
  const PORT = 13321;
  let serverProcess;
  
  const originalContents = await FS.readFile("./fixtures/server-hello.ts", "utf8");
  
  try {
    serverProcess = startDevServer("./fixtures/server-hello.ts", PORT);
    
    const initialResponse = await waitForServer(PORT);
    expect(initialResponse).toBe("<marquee>Hello world</marquee>");
    
    // Rapidly modify the file multiple times
    const modifications = [
      "Hello rapid-1",
      "Hello rapid-2", 
      "Hello rapid-3",
      "Hello final"
    ];
    
    for (const [i, text] of modifications.entries()) {
      const content = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

export default {
  async fetch(req: Request) {
    const html = renderer.render(jsx\`<marquee>${text}</marquee>\`);
    return new Response(html, {
      headers: {"content-type": "text/html; charset=UTF-8"},
    });
  },
};`;
      await FS.writeFile("./fixtures/server-hello.ts", content);
      
      // Small delay between modifications
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Wait for final reload
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    const finalResponse = await fetchWithRetry(PORT);
    expect(finalResponse).toBe("<marquee>Hello final</marquee>");
    
  } finally {
    await FS.writeFile("./fixtures/server-hello.ts", originalContents);
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);

test("high worker count stress test", async () => {
  const PORT = 13322;
  let serverProcess;
  
  try {
    // Start server with many workers
    serverProcess = startDevServer("./fixtures/server-hello.ts", PORT, ["--workers", "8"]);
    
    await waitForServer(PORT);
    
    // Make many concurrent requests
    const concurrentRequests = Array.from({ length: 50 }, () => 
      fetchWithRetry(PORT, "/", 5, 100)
    );
    
    const responses = await Promise.all(concurrentRequests);
    
    // All responses should be consistent
    const uniqueResponses = [...new Set(responses)];
    expect(uniqueResponses.length).toBe(1);
    expect(uniqueResponses[0]).toBe("<marquee>Hello world</marquee>");
    
  } finally {
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);

test("file deletion and recreation", async () => {
  const PORT = 13323;
  let serverProcess;
  
  const testFile = "./fixtures/temp-delete-test.ts";
  const originalContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

export default {
  async fetch(req: Request) {
    const html = renderer.render(jsx\`<div>Original</div>\`);
    return new Response(html, {
      headers: {"content-type": "text/html; charset=UTF-8"},
    });
  },
};`;

  try {
    // Create test file
    await FS.writeFile(testFile, originalContent);
    
    serverProcess = startDevServer(testFile, PORT);
    
    const initialResponse = await waitForServer(PORT);
    expect(initialResponse).toBe("<div>Original</div>");
    
    // Delete the file
    await FS.unlink(testFile);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Recreate with different content
    const newContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

export default {
  async fetch(req: Request) {
    const html = renderer.render(jsx\`<div>Recreated</div>\`);
    return new Response(html, {
      headers: {"content-type": "text/html; charset=UTF-8"},
    });
  },
};`;
    await FS.writeFile(testFile, newContent);
    
    // Wait for reload
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const finalResponse = await fetchWithRetry(PORT);
    expect(finalResponse).toBe("<div>Recreated</div>");
    
  } finally {
    try { await FS.unlink(testFile); } catch (e) {}
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);

test("syntax error recovery", async () => {
  const PORT = 13324;
  let serverProcess;
  
  const originalContents = await FS.readFile("./fixtures/server-hello.ts", "utf8");
  
  try {
    serverProcess = startDevServer("./fixtures/server-hello.ts", PORT);
    
    const initialResponse = await waitForServer(PORT);
    expect(initialResponse).toBe("<marquee>Hello world</marquee>");
    
    // Introduce syntax error
    await FS.writeFile("./fixtures/server-hello.ts", "this is not valid TypeScript at all!!!!");
    
    // Wait for attempted reload
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Server should still respond (with last good version or error page)
    const errorResponse = await fetchWithRetry(PORT);
    expect(typeof errorResponse).toBe("string");
    expect(errorResponse.length).toBeGreaterThan(0);
    
    // Fix the syntax error
    await FS.writeFile("./fixtures/server-hello.ts", `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

export default {
  async fetch(req: Request) {
    const html = renderer.render(jsx\`<marquee>Recovered!</marquee>\`);
    return new Response(html, {
      headers: {"content-type": "text/html; charset=UTF-8"},
    });
  },
};`);
    
    // Wait for recovery
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const recoveredResponse = await fetchWithRetry(PORT);
    expect(recoveredResponse).toBe("<marquee>Recovered!</marquee>");
    
  } finally {
    await FS.writeFile("./fixtures/server-hello.ts", originalContents);
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);

test("large file handling", async () => {
  const PORT = 13325;
  let serverProcess;
  
  const largeFile = "./fixtures/large-test.ts";
  
  try {
    // Create a large file with many dependencies
    const imports = Array.from({ length: 50 }, (_, i) => 
      `const var${i} = "value${i}";`
    ).join('\n');
    
    const largeContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

${imports}

const allVars = [${Array.from({ length: 50 }, (_, i) => `var${i}`).join(', ')}];

export default {
  async fetch(req: Request) {
    const html = renderer.render(jsx\`<div>Variables: \${allVars.length}</div>\`);
    return new Response(html, {
      headers: {"content-type": "text/html; charset=UTF-8"},
    });
  },
};`;
    
    await FS.writeFile(largeFile, largeContent);
    
    serverProcess = startDevServer(largeFile, PORT);
    
    const response = await waitForServer(PORT);
    expect(response).toBe("<div>Variables: 50</div>");
    
    // Modify the large file
    const modifiedContent = largeContent.replace("Variables: \${allVars.length}", "Variables: Modified");
    await FS.writeFile(largeFile, modifiedContent);
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const updatedResponse = await fetchWithRetry(PORT);
    expect(updatedResponse).toBe("<div>Variables: Modified</div>");
    
  } finally {
    try { await FS.unlink(largeFile); } catch (e) {}
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);

test("cache coordination during rapid rebuilds", async () => {
  const PORT = 13326;
  let serverProcess;
  
  // Create a file that uses caching
  const cacheFile = "./fixtures/cache-test.ts";
  const cacheContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

export default {
  async fetch(req: Request) {
    // Simulate cache usage
    const timestamp = Date.now();
    const html = renderer.render(jsx\`<div>Cached: \${timestamp}</div>\`);
    return new Response(html, {
      headers: {"content-type": "text/html; charset=UTF-8"},
    });
  },
};`;

  try {
    await FS.writeFile(cacheFile, cacheContent);
    
    serverProcess = startDevServer(cacheFile, PORT, ["--workers", "4"]);
    
    await waitForServer(PORT);
    
    // Make rapid requests during file modifications
    const rapidTest = async () => {
      const requests = [];
      
      // Start making requests
      for (let i = 0; i < 20; i++) {
        requests.push(fetchWithRetry(PORT, "/", 3, 100));
        
        // Modify file every few requests
        if (i % 5 === 0) {
          const modified = cacheContent.replace("Cached:", `Modified-${i}:`);
          await FS.writeFile(cacheFile, modified);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      return Promise.allSettled(requests);
    };
    
    const results = await rapidTest();
    
    // Most requests should succeed
    const successful = results.filter(r => r.status === 'fulfilled');
    expect(successful.length).toBeGreaterThan(15);
    
    // All successful responses should be strings
    successful.forEach(result => {
      expect(typeof result.value).toBe("string");
      expect(result.value.length).toBeGreaterThan(0);
    });
    
  } finally {
    try { await FS.unlink(cacheFile); } catch (e) {}
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);

test("different file extensions", async () => {
  const PORT = 13327;
  let serverProcess;
  
  const jsFile = "./fixtures/js-test.js";
  const jsContent = `
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

export default {
  async fetch(req) {
    const html = renderer.render(jsx\`<div>JavaScript works!</div>\`);
    return new Response(html, {
      headers: {"content-type": "text/html; charset=UTF-8"},
    });
  },
};`;

  try {
    await FS.writeFile(jsFile, jsContent);
    
    serverProcess = startDevServer(jsFile, PORT);
    
    const response = await waitForServer(PORT);
    expect(response).toBe("<div>JavaScript works!</div>");
    
    // Modify the JS file
    const modified = jsContent.replace("JavaScript works!", "JavaScript modified!");
    await FS.writeFile(jsFile, modified);
    
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    const updatedResponse = await fetchWithRetry(PORT);
    expect(updatedResponse).toBe("<div>JavaScript modified!</div>");
    
  } finally {
    try { await FS.unlink(jsFile); } catch (e) {}
    await killServer(serverProcess, PORT);
  }
}, TIMEOUT);