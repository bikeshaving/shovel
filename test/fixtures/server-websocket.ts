/// <reference types="@b9g/platform" />
self.addEventListener("fetch", (event) => {
	if (event.request.headers.get("upgrade") === "websocket") {
		const ws = event.upgradeWebSocket();
		ws.send("dev welcome");
		return;
	}
	event.respondWith(
		new Response("dev http", {
			headers: {"content-type": "text/plain"},
		}),
	);
});

self.addEventListener("websocketmessage", (event) => {
	event.source.send("dev echo: " + event.data);
});
