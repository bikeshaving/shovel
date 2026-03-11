# @b9g/platform

## 0.1.19

### Bug Fixes

- Fix missing `setBroadcastChannelBackend`, `setBroadcastChannelRelay`, `deliverBroadcastMessage`, and `ShovelBroadcastChannel` exports from `@b9g/platform/runtime`. These were added in source but not included in the 0.1.18 published build, breaking `@b9g/platform-cloudflare@0.1.17` which imports `setBroadcastChannelBackend`.
