self.addEventListener("fetch", (event) => {
	const upgrade = event.request.headers.get("upgrade");
	if (upgrade && upgrade.toLowerCase() === "websocket") {
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
