self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);

	if (url.pathname === "/env") {
		event.respondWith(
			Response.json({
				port: process.env.PORT || "default",
				host: process.env.HOST || "default",
				nodeEnv: process.env.NODE_ENV || "default",
			}),
		);
	} else {
		event.respondWith(new Response("Server is running"));
	}
});
