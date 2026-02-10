# @b9g/pubsub-redis

Redis pub/sub backend for Shovel BroadcastChannel.

Uses Redis `PUBLISH`/`SUBSCRIBE` for cross-process BroadcastChannel relay. Requires a Redis server — two client connections are created automatically (Redis doesn't allow publish and subscribe on the same connection).

## Usage

```typescript
import {RedisPubSubBackend} from "@b9g/pubsub-redis";
import {setBroadcastChannelBackend} from "@b9g/platform/runtime";

setBroadcastChannelBackend(new RedisPubSubBackend({
  url: "redis://localhost:6379",
}));
```

Once configured, any `BroadcastChannel.postMessage()` call will publish to Redis, and messages from other processes will be delivered to local BroadcastChannel instances automatically.
