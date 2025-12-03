self.addEventListener("fetch", (event) => {
	event.respondWith(
		new Response("Hello from Cloudflare!", {
			headers: {"content-type": "text/plain"},
		}),
	);
});
