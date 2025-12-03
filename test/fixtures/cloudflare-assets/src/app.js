import "./style.css" with {assetBase: "/assets/"};

self.addEventListener("fetch", (event) => {
	event.respondWith(
		new Response("<html>Test</html>", {
			headers: {"content-type": "text/html"},
		}),
	);
});
