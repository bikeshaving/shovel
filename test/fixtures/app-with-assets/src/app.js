import cssUrl from "./style.css" with {assetBase: "/assets/"};
import jsUrl from "./client.js" with {assetBase: "/assets/"};
import {assets} from "@b9g/assets/middleware";

const serveAssets = assets();

self.addEventListener("fetch", (event) => {
	event.respondWith(
		(async () => {
			// Try assets middleware first
			const assetResponse = await serveAssets(event.request);
			if (assetResponse) return assetResponse;

			// App routes
			const url = new URL(event.request.url);
			if (url.pathname === "/") {
				return new Response(
					`<!DOCTYPE html>
<html>
	<head>
		<title>Assets Test</title>
		<link rel="stylesheet" href="${cssUrl}">
	</head>
	<body>
		<h1>App with Assets</h1>
		<script src="${jsUrl}"></script>
	</body>
</html>`,
					{
						headers: {"content-type": "text/html; charset=utf-8"},
					},
				);
			}

			return new Response("Not found", {status: 404});
		})(),
	);
});
