# 🚀 Introducing Shovel (November 11, 2025)

*The ServiceWorker framework that runs everywhere*

---

## What is Shovel?

**Shovel** is a full-stack JavaScript framework that lets you write **ServiceWorker-style applications** that run seamlessly across **Node.js**, **Bun**, and **Cloudflare Workers**.

Write once. Deploy anywhere. Use web standards.

```javascript
// Your server.js - runs identically on Node, Bun, or Cloudflare
self.addEventListener('fetch', async (event) => {
  const cache = await self.caches.open('api');
  const bucket = await self.buckets.getDirectoryHandle('static');
  
  // Your familiar ServiceWorker code here
  event.respondWith(/* your response */);
});
```

## The Problem Shovel Solves

Modern JavaScript runs in **three fundamentally different environments**:

- 🟢 **Node.js**: Server-side with `worker_threads` and file system access
- 🥖 **Bun**: Native performance with Web Workers and TypeScript support  
- ☁️ **Cloudflare Workers**: Edge computing with KV/R2/D1 storage

Each has different APIs, different capabilities, different deployment models. **Shovel unifies them all** behind the familiar ServiceWorker standard.

## Core Philosophy

### 🌐 **Web Standards First**
Uses real web APIs like `CacheStorage`, `FileSystemDirectoryHandle`, and ServiceWorker events. No proprietary APIs to learn.

### ⚡ **Runtime Adaptive** 
Automatically detects your environment and optimizes for it. Worker threads on Node, Web Workers on Bun, direct execution on Cloudflare.

### 🔧 **Pluggable Everything**
Caches, file systems, and storage backends are all configurable. Memory for development, Redis for production, R2 for edge.

### 🎭 **Zero Configuration**
Just write ServiceWorker code. Shovel handles the complexity of making it work everywhere.

## Architecture Elegance

```
┌─────────────────────────────────────────────┐
│        Your ServiceWorker App               │ ← Standard web APIs
├─────────────────────────────────────────────┤
│   ServiceWorkerRegistration (Central Hub)   │ ← Registry coordination  
├─────────────────────────────────────────────┤
│  Node Platform │ Bun Platform │ CF Platform │ ← Runtime adapters
├─────────────────────────────────────────────┤
│   Node.js      │     Bun      │   Workers   │ ← JavaScript engines
└─────────────────────────────────────────────┘
```

## What Makes It Special

### 🧠 **Smart Registries**
Shovel's `ServiceWorkerRegistration` acts as a central registry that creates caches and file systems by name and configuration:

```javascript
// Development: memory storage
const cache = await self.caches.open('api'); // → MemoryCache

// Production: Redis cluster  
const cache = await self.caches.open('api'); // → RedisCache

// Edge: Cloudflare native
const cache = await self.caches.open('api'); // → Cloudflare Cache API
```

### 🔀 **Generator-Based Routing**
Clean, composable middleware using JavaScript generators:

```javascript
function* authMiddleware(request, context) {
  // Pre-processing
  yield* next(); // Pass control to next middleware
  // Post-processing  
}
```

### 📦 **Unified Storage**
File system access through web standards, with pluggable backends:

```javascript
const bucket = await self.buckets.getDirectoryHandle('static');
// → Node.js file system, R2 bucket, or S3 bucket based on config
```

## Developer Experience

### 🎯 **Familiar APIs**
If you know ServiceWorkers, you know Shovel. No new concepts to learn.

### 🔥 **Hot Reload Everywhere**
Development mode with instant updates across all platforms.

### 📊 **Comprehensive Testing**
108 tests across all packages ensuring reliability.

### 🏗️ **TypeScript Native**
Full TypeScript support with proper module resolution.

## Ready for Production

Shovel is launching with:
- ✅ **Comprehensive test coverage** across all platforms
- ✅ **Standardized ServiceWorker APIs** 
- ✅ **Clean package exports** for reliable imports
- ✅ **Architectural refinements** for long-term maintainability

## Get Started

```bash
npm create @b9g/shovel my-app
```

Or install manually:

```bash
npm install @b9g/platform-node  # For Node.js
npm install @b9g/platform-bun   # For Bun  
npm install @b9g/platform-cloudflare # For Cloudflare
```

```javascript
import { NodePlatform } from '@b9g/platform-node';

const platform = new NodePlatform();
const serviceWorker = await platform.loadServiceWorker('./server.js');
const server = platform.createServer(serviceWorker.handleRequest);
```

---

**Shovel: Where web standards meet universal deployment.** 

*Write ServiceWorker code. Run it everywhere. Focus on your app, not the infrastructure.*

🚀 **Ready to dig in?** Check out the [documentation](/) and start building universal JavaScript applications today.