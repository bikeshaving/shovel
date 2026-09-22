self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	const upgrade = event.request.headers.get("upgrade");

	// Only /ws actually upgrades. A request with an Upgrade header to any
	// other path must NOT engage WebSocket machinery — the handler, not the
	// header, decides. (This is the DoS-relevant invariant: the Durable
	// Object is touched only when upgradeWebSocket() is actually called.)
	if (
		url.pathname === "/ws" &&
		upgrade &&
		upgrade.toLowerCase() === "websocket"
	) {
		const ws = event.upgradeWebSocket();
		ws.subscribe("room:lobby");
		ws.send(JSON.stringify({type: "welcome", id: ws.id}));
		return;
	}

	event.respondWith(
		new Response("HTTP fallback", {
			headers: {"content-type": "text/plain"},
		}),
	);
});

self.addEventListener("websocketmessage", (event) => {
	event.source.send(`echo: ${event.data}`);
});

self.addEventListener("websocketclose", (_event) => {
	// no-op; runtime cleans up subscriptions
});
