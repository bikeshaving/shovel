// Track lifecycle events
let installed = false;
let activated = false;

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			installed = true;
		})(),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			activated = true;
		})(),
	);
});

self.addEventListener("fetch", (event) => {
	event.respondWith(
		new Response(
			JSON.stringify({
				installed,
				activated,
				message: "Hello from Cloudflare with lifecycle!",
			}),
			{
				headers: {"content-type": "application/json"},
			},
		),
	);
});
