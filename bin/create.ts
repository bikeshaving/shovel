#!/usr/bin/env sh
//bin/true; exec "$([ "${npm_config_user_agent#bun/}" != "$npm_config_user_agent" ] && echo bun || echo node)" "$0" "$@"

import {intro, outro, text, select, confirm, spinner} from "@clack/prompts";
import picocolors from "picocolors";
const {cyan, green, red, dim, bold} = picocolors;
import {mkdir, writeFile} from "fs/promises";
import {join, resolve} from "path";
import {existsSync} from "fs";

interface ProjectConfig {
	name: string;
	platform: "node" | "bun" | "cloudflare";
	template: "basic" | "api" | "echo";
	typescript: boolean;
}

async function main() {
	console.info("");

	intro(cyan("🚀 Create Shovel App"));

	console.info(dim("The ServiceWorker framework that runs everywhere\n"));

	// Get project name from args or prompt
	let projectName = process.argv[2];

	if (!projectName) {
		const nameResult = await text({
			message: "What is your project name?",
			placeholder: "my-shovel-app",
			validate: (value) => {
				if (!value) return "Project name is required";
				if (!/^[a-z0-9-]+$/.test(value))
					return "Use lowercase letters, numbers, and hyphens only";
				return undefined;
			},
		});

		if (typeof nameResult === "symbol") {
			outro(red("❌ Project creation cancelled"));
			process.exit(0);
		}

		projectName = nameResult;
	}

	// eslint-disable-next-line no-restricted-properties -- CLI needs cwd for project creation
	const projectPath = resolve(process.cwd(), projectName);

	// Check if directory exists
	if (existsSync(projectPath)) {
		const overwrite = await confirm({
			message: `Directory "${projectName}" already exists. Overwrite?`,
		});

		if (typeof overwrite === "symbol" || !overwrite) {
			outro(red("❌ Project creation cancelled"));
			process.exit(0);
		}
	}

	// Platform selection
	const platform = await select({
		message: "Which platform are you targeting?",
		options: [
			{
				value: "node" as const,
				label: `${bold("Node.js")} - Traditional server with worker threads`,
				hint: "Most common choice",
			},
			{
				value: "bun" as const,
				label: `${bold("Bun")} - Native performance with Web Workers`,
			},
			{
				value: "cloudflare" as const,
				label: `${bold("Cloudflare")} - Edge runtime with KV/R2/D1`,
			},
		],
	});

	if (typeof platform === "symbol") {
		outro(red("❌ Project creation cancelled"));
		process.exit(0);
	}

	// Template selection
	const template = await select({
		message: "Choose a starter template:",
		options: [
			{
				value: "basic" as const,
				label: `${bold("Basic")} - Simple hello world with routing`,
			},
			{
				value: "api" as const,
				label: `${bold("API")} - REST endpoints with JSON responses`,
			},
			{
				value: "echo" as const,
				label: `${bold("Echo")} - HTTP request echo service (like httpbin)`,
			},
		],
	});

	if (typeof template === "symbol") {
		outro(red("❌ Project creation cancelled"));
		process.exit(0);
	}

	// TypeScript option
	const typescript = await confirm({
		message: "Use TypeScript?",
		initialValue: false,
	});

	if (typeof typescript === "symbol") {
		outro(red("❌ Project creation cancelled"));
		process.exit(0);
	}

	const config: ProjectConfig = {
		name: projectName,
		platform,
		template,
		typescript,
	};

	// Create project
	const s = spinner();
	s.start("Creating your Shovel project...");

	try {
		await createProject(config, projectPath);
		s.stop("✅ Project created successfully!");

		console.info("");
		outro(green("🎉 Your Shovel project is ready!"));

		console.info("");
		console.info(cyan("Next steps:"));
		console.info(`  ${dim("$")} cd ${projectName}`);
		console.info(`  ${dim("$")} npm install`);
		console.info(`  ${dim("$")} npm run develop`);
		console.info("");
		console.info(
			`🌐 Your app will be available at: ${bold("http://localhost:3000")}`,
		);
		console.info("");
		console.info(dim("Happy coding with Shovel! 🚀"));
	} catch (error) {
		s.stop("❌ Failed to create project");
		console.error(red("Error:"), error);
		process.exit(1);
	}
}

async function createProject(config: ProjectConfig, projectPath: string) {
	// Create project directory
	await mkdir(projectPath, {recursive: true});
	await mkdir(join(projectPath, "src"), {recursive: true});

	// Create package.json
	const packageJson = {
		name: config.name,
		private: true,
		version: "1.0.0",
		description: `Shovel ${config.template} app for ${config.platform}`,
		type: "module",
		scripts: {
			develop: `shovel develop src/app.${config.typescript ? "ts" : "js"} --platform ${config.platform}`,
			build: `shovel build src/app.${config.typescript ? "ts" : "js"} --platform ${config.platform}`,
			start: "node dist/server/index.js",
		},
		dependencies: {
			"@b9g/router": "^0.1.0",
			"@b9g/platform": "^0.1.0",
			[`@b9g/platform-${config.platform}`]: "^0.1.0",
			"@b9g/shovel": "^0.1.0",
		},
		devDependencies: config.typescript
			? {
					"@types/node": "^20.0.0",
					typescript: "^5.0.0",
				}
			: {},
	};

	await writeFile(
		join(projectPath, "package.json"),
		JSON.stringify(packageJson, null, 2),
	);

	// Create app file
	const appFile = generateAppFile(config);
	const appExt = config.typescript ? "ts" : "js";
	await writeFile(join(projectPath, `src/app.${appExt}`), appFile);

	// Create TypeScript config if needed
	if (config.typescript) {
		const tsConfig = {
			compilerOptions: {
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "bundler",
				allowSyntheticDefaultImports: true,
				esModuleInterop: true,
				strict: true,
				skipLibCheck: true,
				forceConsistentCasingInFileNames: true,
				lib: ["ES2022", "WebWorker"],
			},
			include: ["src/**/*"],
			exclude: ["node_modules", "dist"],
		};

		await writeFile(
			join(projectPath, "tsconfig.json"),
			JSON.stringify(tsConfig, null, 2),
		);
	}

	// Create README
	const readme = generateReadme(config);
	await writeFile(join(projectPath, "README.md"), readme);

	// Create .gitignore
	const gitignore = `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
`;
	await writeFile(join(projectPath, ".gitignore"), gitignore);
}

function generateAppFile(config: ProjectConfig): string {
	const helperImports =
		config.template === "echo" && config.typescript
			? `
// Helper functions for echo service
function getRequestInfo(request: Request) {
  return {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
  };
}

async function parseBody(request: Request) {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return await request.json();
    } catch (err) {
      // Only ignore JSON parse errors, rethrow others
      if (
        !(err instanceof SyntaxError) ||
        !/^(Unexpected token|Expected|JSON)/i.test(String(err.message))
      ) {
        throw err;
      }
      return null;
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    try {
      const formData = await request.formData();
      return Object.fromEntries(formData.entries());
    } catch (err) {
      // Only ignore form data parse errors, rethrow others
      if (
        !(err instanceof TypeError) ||
        !String(err.message).includes('FormData')
      ) {
        throw err;
      }
      return null;
    }
  }

  try {
    const text = await request.text();
    return text || null;
  } catch (err) {
    // Only ignore body already consumed errors, rethrow others
    if (
      !(err instanceof TypeError) ||
      !String(err.message).includes('body')
    ) {
      throw err;
    }
    return null;
  }
}
`
			: config.template === "echo"
				? `
// Helper functions for echo service
function getRequestInfo(request) {
  return {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
  };
}

async function parseBody(request) {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return await request.json();
    } catch (err) {
      // Only ignore JSON parse errors, rethrow others
      if (
        !(err instanceof SyntaxError) ||
        !/^(Unexpected token|Expected|JSON)/i.test(String(err.message))
      ) {
        throw err;
      }
      return null;
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    try {
      const formData = await request.formData();
      return Object.fromEntries(formData.entries());
    } catch (err) {
      // Only ignore form data parse errors, rethrow others
      if (
        !(err instanceof TypeError) ||
        !String(err.message).includes('FormData')
      ) {
        throw err;
      }
      return null;
    }
  }

  try {
    const text = await request.text();
    return text || null;
  } catch (err) {
    // Only ignore body already consumed errors, rethrow others
    if (
      !(err instanceof TypeError) ||
      !String(err.message).includes('body')
    ) {
      throw err;
    }
    return null;
  }
}
`
				: "";

	return `${helperImports}import { Router } from "@b9g/router";

const router = new Router();

${generateRoutes(config)}

// ServiceWorker lifecycle events
self.addEventListener("install", (event) => {
  console.info("[${config.name}] ServiceWorker installed");
});

self.addEventListener("activate", (event) => {
  console.info("[${config.name}] ServiceWorker activated");
});

// Handle HTTP requests
self.addEventListener("fetch", (event) => {
  try {
    const responsePromise = router.handler(event.request);
    event.respondWith(responsePromise);
  } catch (error) {
    console.error("[${config.name}] Error handling request:", error);
    event.respondWith(
      new Response(
        JSON.stringify({
          error: "Internal server error",
          message: error.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
  }
});
`;
}

function generateRoutes(config: ProjectConfig): string {
	switch (config.template) {
		case "basic":
			return `// Basic routes
router.route("/").get(async (request, context) => {
  const html = \`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Welcome to Shovel!</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: system-ui; max-width: 600px; margin: 2rem auto; padding: 2rem; }
          h1 { color: #2563eb; }
          .info { background: #f1f5f9; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
          code { background: #e2e8f0; padding: 0.2rem 0.4rem; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>🚀 Welcome to Shovel!</h1>
        <p>Your ${config.template} app is running on the <strong>${config.platform}</strong> platform.</p>
        
        <div class="info">
          <strong>Try these endpoints:</strong>
          <ul>
            <li><a href="/api/hello">GET /api/hello</a> - Simple API endpoint</li>
            <li><a href="/api/time">GET /api/time</a> - Current timestamp</li>
          </ul>
        </div>
        
        <p>Edit <code>src/app.${config.typescript ? "ts" : "js"}</code> to customize your app!</p>
      </body>
    </html>
  \`;
  
  return new Response(html, {
    headers: { "Content-Type": "text/html" }
  });
});

router.route("/api/hello").get(async (request, context) => {
  return new Response(JSON.stringify({
    message: "Hello from Shovel! 🚀",
    platform: "${config.platform}",
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
});

router.route("/api/time").get(async (request, context) => {
  return new Response(JSON.stringify({
    time: new Date().toISOString(),
    unix: Date.now(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  }), {
    headers: { "Content-Type": "application/json" }
  });
});`;

		case "api":
			return `// API routes
router.route("/").get(async (request, context) => {
  return new Response(JSON.stringify({
    name: "${config.name}",
    platform: "${config.platform}", 
    endpoints: [
      { method: "GET", path: "/api/users", description: "Get all users" },
      { method: "POST", path: "/api/users", description: "Create a user" },
      { method: "GET", path: "/api/users/:id", description: "Get user by ID" },
      { method: "GET", path: "/health", description: "Health check" }
    ]
  }), {
    headers: { "Content-Type": "application/json" }
  });
});

// Mock users data
const users = [
  { id: 1, name: "Alice Johnson", email: "alice@example.com", active: true },
  { id: 2, name: "Bob Smith", email: "bob@example.com", active: true },
  { id: 3, name: "Carol Davis", email: "carol@example.com", active: false }
];

router.route("/api/users").get(async (request, context) => {
  const url = new URL(request.url);
  const active = url.searchParams.get('active');
  
  let filteredUsers = users;
  if (active !== null) {
    filteredUsers = users.filter(user => user.active === (active === 'true'));
  }
  
  return new Response(JSON.stringify({
    users: filteredUsers,
    total: filteredUsers.length
  }), {
    headers: { "Content-Type": "application/json" }
  });
});

router.route("/api/users").post(async (request, context) => {
  const userData = await request.json();
  const newUser = {
    id: Math.max(...users.map(u => u.id)) + 1,
    name: userData.name || "Unknown User",
    email: userData.email || \`user\${Date.now()}@example.com\`,
    active: userData.active !== false
  };
  
  users.push(newUser);
  
  return new Response(JSON.stringify({
    success: true,
    user: newUser
  }), {
    status: 201,
    headers: { "Content-Type": "application/json" }
  });
});

router.route("/api/users/:id").get(async (request, context) => {
  const id = parseInt(context.params.id);
  const user = users.find(u => u.id === id);
  
  if (!user) {
    return new Response(JSON.stringify({
      error: "User not found"
    }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  
  return new Response(JSON.stringify({ user }), {
    headers: { "Content-Type": "application/json" }
  });
});

router.route("/health").get(async (request, context) => {
  return new Response(JSON.stringify({
    status: "ok",
    platform: "${config.platform}",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  }), {
    headers: { "Content-Type": "application/json" }
  });
});`;

		case "echo":
			return `// Echo service routes (like httpbin)
router.route("/").get(async (request, context) => {
  const html = \`
    <!DOCTYPE html>
    <html>
      <head>
        <title>HTTP Echo Service</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: monospace; max-width: 800px; margin: 2rem auto; padding: 2rem; }
          h1 { color: #059669; }
          .endpoint { background: #f0fdf4; padding: 1rem; margin: 1rem 0; border-radius: 8px; }
          code { background: #dcfce7; padding: 0.2rem 0.4rem; border-radius: 4px; }
        </style>
      </head>
      <body>
        <h1>🔄 HTTP Echo Service</h1>
        <p>A simple HTTP request/response inspection service.</p>
        
        <div class="endpoint">
          <strong>POST /echo</strong><br>
          Echo back request details including headers, body, and metadata.
        </div>
        
        <div class="endpoint">
          <strong>GET /ip</strong><br>
          Get your IP address.
        </div>
        
        <div class="endpoint">
          <strong>GET /headers</strong><br>
          Get your request headers.
        </div>
        
        <div class="endpoint">
          <strong>GET /user-agent</strong><br>
          Get your user agent string.
        </div>
        
        <p>Try: <code>curl -X POST https://your-app.com/echo -d '{"test": "data"}'</code></p>
      </body>
    </html>
  \`;
  
  return new Response(html, {
    headers: { "Content-Type": "text/html" }
  });
});

router.route("/echo").all(async (request, context) => {
  const info = getRequestInfo(request);
  const body = await parseBody(request);
  
  const response = {
    ...info,
    body,
    contentType: request.headers.get("content-type") || null,
    timestamp: new Date().toISOString()
  };
  
  return new Response(JSON.stringify(response, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
});

router.route("/ip").get(async (request, context) => {
  const ip = request.headers.get("x-forwarded-for") || 
            request.headers.get("x-real-ip") || 
            "127.0.0.1";
            
  return new Response(JSON.stringify({ ip }), {
    headers: { "Content-Type": "application/json" }
  });
});

router.route("/headers").get(async (request, context) => {
  return new Response(JSON.stringify({
    headers: Object.fromEntries(request.headers.entries())
  }, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
});

router.route("/user-agent").get(async (request, context) => {
  return new Response(JSON.stringify({
    userAgent: request.headers.get("user-agent") || "Unknown"
  }), {
    headers: { "Content-Type": "application/json" }
  });
});`;

		default:
			return "// Routes will be added here";
	}
}

function generateReadme(config: ProjectConfig): string {
	return `# ${config.name}

A Shovel ${config.template} application for the ${config.platform} platform.

## 🚀 Getting Started

\`\`\`bash
npm install
npm run develop
\`\`\`

Your app will be available at: **http://localhost:3000**

## 📁 Project Structure

- \`src/app.${config.typescript ? "ts" : "js"}\` - Main ServiceWorker application
- \`package.json\` - Dependencies and scripts${config.typescript ? "\n- `tsconfig.json` - TypeScript configuration" : ""}

## 🛠️ Available Scripts

- \`npm run develop\` - Start development server with hot reload
- \`npm run build\` - Build for production
- \`npm run start\` - Start production server

## ✨ Features

- ✅ **ServiceWorker APIs** - Standard web APIs (\`self.addEventListener\`, etc.)
- ✅ **${config.platform} Runtime** - Optimized for ${config.platform}
- ✅ **${config.typescript ? "TypeScript" : "JavaScript"}** - ${config.typescript ? "Full type safety" : "Modern JavaScript"} with ESM modules
- ✅ **${config.template} Template** - Ready-to-use starter with routing

## 📚 Learn More

- [Shovel Documentation](https://github.com/b9g/shovel)
- [ServiceWorker API](https://developer.mozilla.org/docs/Web/API/ServiceWorker)

---

Built with 🚀 [Shovel](https://github.com/b9g/shovel) - The ServiceWorker framework that runs everywhere.
`;
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
	outro(red("❌ Project creation cancelled"));
	process.exit(0);
});

main().catch((error) => {
	console.error(red("Fatal error:"), error);
	process.exit(1);
});
