# @b9g/pubsub-redis

Redis pub/sub backend for Shovel's [BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) implementation. Enables cross-process message delivery using Redis `PUBLISH`/`SUBSCRIBE`.

## Features

- Cross-process BroadcastChannel relay via Redis
- Automatic echo prevention (messages don't loop back to sender)
- Two Redis connections created automatically (Redis requires separate connections for pub and sub)
- Drop-in backend -- no changes to application BroadcastChannel code

## Installation

```bash
npm install @b9g/pubsub-redis redis
```

Requires `@b9g/platform` as a peer dependency.

## Usage

```typescript
import {RedisPubSubBackend} from "@b9g/pubsub-redis";
import {setBroadcastChannelBackend} from "@b9g/platform/runtime";

setBroadcastChannelBackend(new RedisPubSubBackend({
  url: "redis://localhost:6379",
}));
```

Once configured, any `BroadcastChannel.postMessage()` call publishes to Redis, and messages from other processes are delivered to local BroadcastChannel instances automatically.

### In Shovel Config

Configure in `shovel.json` to enable cross-process BroadcastChannel in production:

```json
{
  "broadcastChannel": {
    "module": "@b9g/pubsub-redis",
    "export": "RedisPubSubBackend",
    "url": "redis://localhost:6379"
  }
}
```

## API

### `new RedisPubSubBackend(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string?` | Redis default | Redis connection URL (e.g. `"redis://localhost:6379"`) |

Creates two Redis client connections (publisher + subscriber) and connects them immediately.

### Methods

Implements the `BroadcastChannelBackend` interface:

- **`publish(channelName, data)`** -- Publishes to Redis channel `shovel:bc:{channelName}` with sender ID
- **`subscribe(channelName, callback)`** -- Subscribes to Redis channel, filters out own messages, returns unsubscribe function
- **`dispose()`** -- Gracefully closes both Redis connections

### Echo Prevention

Each backend instance generates a random UUID on creation. Published messages include this sender ID in the payload. When a message is received via subscription, the sender ID is checked -- messages from the same instance are silently dropped. This prevents duplicate delivery when a process both publishes and subscribes to the same channel.

## How It Works

```
Process A                    Redis                    Process B
─────────                    ─────                    ─────────
bc.postMessage("hi")
  → publish("shovel:bc:chat", {data:"hi", sender:"A"})
                              → PUBLISH
                              → subscriber B receives
                                                      → sender !== "B" ✓
                                                      → deliverBroadcastMessage("chat", "hi")
                              → subscriber A receives
  → sender === "A" ✗ (skip)
```

## License

MIT
