const ROOM = "room:lobby";

self.addEventListener("fetch", (event) => {
	if (event.request.headers.get("upgrade")?.toLowerCase() === "websocket") {
		const ws = event.upgradeWebSocket();
		ws.subscribe(ROOM);
		ws.send(JSON.stringify({type: "ready", id: ws.id}));
		return;
	}
	event.respondWith(new Response("not found", {status: 404}));
});
