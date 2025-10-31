#!/usr/bin/env node

/**
 * Example of using Node platform with hot reloading for a Shovel app
 *
 * Usage:
 *   node examples/hot-reload-server.js
 *
 * Then edit the example app file and see hot reloading in action!
 */

import {createNodePlatform} from "../dist/src/platform.js";
import {Router} from "@b9g/router";

// Create platform with hot reloading enabled
const platform = createNodePlatform({
	hotReload: true,
	port: 3000,
	host: "localhost",
});

// Simple handler that we'll hot reload
function createHandler() {
	const router = new Router();

	router.get(
		"/",
		() =>
			new Response(
				`
    <html>
      <body>
        <h1>Hot Reloading Node Platform!</h1>
        <p>Time: ${new Date().toISOString()}</p>
        <p>Edit this file and see the changes automatically!</p>
      </body>
    </html>
  `,
				{
					headers: {"Content-Type": "text/html"},
				},
			),
	);

	return router.handler();
}

// Start server with hot reloading
const handler = createHandler();
const server = platform.createServer(handler, {
	port: 3000,
	entry: import.meta.url, // This file will be watched for changes
});

server.listen(() => {
	console.log("🔥 Hot reload server running at http://localhost:3000");
	console.log("💡 Edit this file and see changes automatically reflected!");
});

// Export handler for hot reloading
export default createHandler;
