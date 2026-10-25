# shovel-chat

Single-room chat over WebSockets, in ~150 lines of source.

The same `src/server.ts` runs on Node, Bun, and Cloudflare Workers without any
platform-specific code. It's the smallest demo that exercises the full
WebSocket functional-events surface:

| API | Used by |
|---|---|
| `FetchEvent.upgradeWebSocket()` | accepting the connection |
| `WebSocketConnection.subscribe(channel)` | joining the lobby room |
| `WebSocketConnection.send(data)` | greeting the new user |
| `websocketmessage` event + `event.source.id` | identifying the sender |
| `BroadcastChannel.postMessage()` | fanout to every connection in the room |
| `websocketclose` event | "user left" notification |

## Run it

### Node

```sh
npm install
npm run develop
# open http://localhost:7777 in two windows
```

### Bun

```sh
bun install
bun run develop
```

### Cloudflare Workers (production)

```sh
npm install
npm run build:cf
npm run deploy
```

The Cloudflare deploy uses `wrangler.toml`'s `SHOVEL_WS` Durable Object
binding to give the runtime a hibernation-capable home for accepted
WebSocket connections — see the binding block at the bottom of
`wrangler.toml`.

## How fanout works

There's only one routing primitive: `BroadcastChannel`. A connection that
calls `subscribe("room:lobby")` registers as a runtime-mediated subscriber to
that channel. Anyone — same isolate, another worker, a cron job, even another
Cloudflare colo (with the `SHOVEL_PUBSUB` binding configured) — can fan a
message out by publishing on that channel:

```js
new BroadcastChannel("room:lobby").postMessage(payload);
```

The runtime forwards the payload to every subscribed connection's `send()`.
No closures. No enumeration. Hibernation-safe by construction.
