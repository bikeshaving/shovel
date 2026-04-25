/// <reference types="@b9g/platform" />
/**
 * Shovel WebSocket chat — single-room demo of the functional events API.
 *
 * Exercised concepts:
 *  - FetchEvent.upgradeWebSocket() returns a WebSocketConnection
 *  - WebSocketConnection.subscribe(channel) — runtime-mediated, hibernation-safe
 *  - websocketmessage event with event.source.{send, subscribe, ...}
 *  - BroadcastChannel as the cross-isolate fanout primitive
 *  - websocketclose event for cleanup hooks
 *
 * Runs on Node, Bun, and Cloudflare without changes.
 */

const ROOM = "room:lobby";

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);

	// WebSocket upgrade — accept and join the lobby
	if (event.request.headers.get("upgrade")?.toLowerCase() === "websocket") {
		const ws = event.upgradeWebSocket();
		ws.subscribe(ROOM);
		ws.send(
			JSON.stringify({
				type: "system",
				text: `Welcome — you are ${ws.id.slice(0, 8)}`,
			}),
		);
		new BroadcastChannel(ROOM).postMessage(
			JSON.stringify({
				type: "system",
				text: `${ws.id.slice(0, 8)} joined`,
			}),
		);
		return;
	}

	// HTTP — serve the chat page
	if (url.pathname === "/" || url.pathname === "/index.html") {
		event.respondWith(
			new Response(PAGE, {
				headers: {"content-type": "text/html; charset=utf-8"},
			}),
		);
		return;
	}

	event.respondWith(new Response("not found", {status: 404}));
});

self.addEventListener("websocketmessage", (event) => {
	// Parse the inbound text. If it's a chat message, fan it out to the room.
	let payload: {text?: string} = {};
	try {
		payload = typeof event.data === "string" ? JSON.parse(event.data) : {};
	} catch (_err) {
		return;
	}
	const text = String(payload.text ?? "").slice(0, 500);
	if (!text) return;

	new BroadcastChannel(ROOM).postMessage(
		JSON.stringify({
			type: "message",
			from: event.source.id.slice(0, 8),
			text,
		}),
	);
});

self.addEventListener("websocketclose", (event) => {
	new BroadcastChannel(ROOM).postMessage(
		JSON.stringify({
			type: "system",
			text: `${event.id.slice(0, 8)} left`,
		}),
	);
});

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Shovel chat</title>
<style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, -apple-system, sans-serif; }
  body { max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
  h1 { margin: 0 0 0.25rem; font-size: 1.4rem; }
  p.sub { margin: 0 0 1.5rem; color: #888; font-size: 0.9rem; }
  #log {
    height: 60vh; overflow-y: auto; border: 1px solid #888;
    border-radius: 6px; padding: 0.75rem; font-family: ui-monospace, monospace;
    font-size: 0.92rem; line-height: 1.5;
  }
  #log div { margin-bottom: 0.25rem; }
  #log .system { color: #888; font-style: italic; }
  #log .me { color: #0a7; }
  form { display: flex; gap: 0.5rem; margin-top: 1rem; }
  input { flex: 1; padding: 0.5rem 0.75rem; font-size: 1rem;
          border: 1px solid #888; border-radius: 6px; background: transparent;
          color: inherit; }
  button { padding: 0.5rem 1.25rem; font-size: 1rem; border: 1px solid #888;
           border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
  button:hover { background: rgba(127,127,127,0.1); }
</style>
</head>
<body>
<h1>Shovel chat</h1>
<p class="sub">Open this page in two windows to see the same lobby.</p>
<div id="log"></div>
<form id="form">
  <input id="input" placeholder="type a message…" autocomplete="off" autofocus />
  <button>Send</button>
</form>
<script>
  const log = document.getElementById("log");
  const form = document.getElementById("form");
  const input = document.getElementById("input");

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(proto + "//" + location.host + "/ws");

  let myId = null;

  function append(text, cls) {
    const div = document.createElement("div");
    if (cls) div.className = cls;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  ws.addEventListener("open", () => append("● connected", "system"));
  ws.addEventListener("close", (e) =>
    append("● disconnected (" + e.code + ")", "system"),
  );
  ws.addEventListener("message", (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "system") {
      // First system message is the welcome — capture our own id
      if (!myId && m.text && m.text.startsWith("Welcome")) {
        myId = m.text.split(" ").pop();
      }
      append(m.text, "system");
    } else if (m.type === "message") {
      const isMe = m.from === myId;
      append((isMe ? "you" : m.from) + ": " + m.text, isMe ? "me" : "");
    }
  });

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    ws.send(JSON.stringify({text}));
    input.value = "";
  });
</script>
</body>
</html>
`;
