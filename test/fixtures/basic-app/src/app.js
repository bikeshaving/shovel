self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);

	if (url.pathname === "/") {
		event.respondWith(
			new Response(
				`<!DOCTYPE html>
<html>
	<head><title>Basic App</title></head>
	<body><h1>Hello from basic app!</h1></body>
</html>`,
				{
					headers: {"content-type": "text/html; charset=utf-8"},
				},
			),
		);
	} else if (url.pathname === "/health") {
		event.respondWith(
			Response.json({
				status: "ok",
				timestamp: Date.now(),
			}),
		);
	} else {
		event.respondWith(new Response("Not found", {status: 404}));
	}
});
