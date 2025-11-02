/**
 * Database Seeding Script
 * Populates the database with sample data for development
 */

import { PostsDB, DocsDB, UsersDB } from './database.js';

// Sample blog posts
const samplePosts = [
    {
        title: "Welcome to Shovel Admin",
        slug: "welcome-to-shovel-admin",
        content: `# Welcome to Shovel Admin Dashboard

This is a demonstration of Shovel's cache-first architecture with persistent SQLite storage. 

## Features

- **Cache-First Performance**: Every request hits cache first for blazing speed
- **SQLite Backend**: Reliable, embedded database storage
- **Bun Runtime**: Fast JavaScript runtime with built-in SQLite support
- **Universal Deployment**: Works on Fly.io, Cloudflare Workers, and more

## Cache Strategy

When you edit posts, Shovel automatically invalidates relevant cache entries while keeping performance optimal.`,
        excerpt: "Introduction to the Shovel Admin Dashboard with cache-first architecture and SQLite storage.",
        status: "published"
    },
    {
        title: "Cache-First Architecture Benefits",
        slug: "cache-first-benefits", 
        content: `# Why Cache-First?

Traditional web frameworks cache as an afterthought. Shovel puts caching at the center:

## Performance Benefits

- **Sub-10ms responses** from cached content
- **Automatic cache invalidation** on data changes
- **Edge distribution** with platform-native caching
- **Zero-downtime deployments** with versioned caches

## Developer Experience

- **No cache configuration** - it just works
- **Predictable performance** - cache hits are guaranteed fast
- **Easy debugging** with cache status headers`,
        excerpt: "Deep dive into the performance and DX benefits of cache-first architecture.",
        status: "published"
    },
    {
        title: "SQLite + Bun Performance",
        slug: "sqlite-bun-performance",
        content: `# SQLite + Bun: A Perfect Match

This admin dashboard showcases the power of combining SQLite with Bun runtime:

## Why SQLite?

- **Zero-configuration** database
- **Excellent performance** for read-heavy workloads
- **ACID compliance** with transaction safety
- **Single file deployment** - perfect for containers

## Why Bun?

- **3x faster** than Node.js for many workloads
- **Built-in SQLite** support with \`bun:sqlite\`
- **TypeScript native** with excellent developer experience
- **Drop-in replacement** for Node.js applications`,
        excerpt: "Exploring the performance benefits of SQLite and Bun for web applications.",
        status: "draft"
    }
];

// Sample documentation pages
const sampleDocs = [
    {
        title: "Getting Started",
        slug: "getting-started",
        content: `# Getting Started with Shovel

Shovel is a cache-first metaframework for building fast web applications.

## Installation

\`\`\`bash
npm install @b9g/shovel
\`\`\`

## Quick Start

\`\`\`javascript
import { Router } from '@b9g/router';

const router = new Router();

router.route('/').get(async (request) => {
  return new Response('Hello, Shovel!');
});
\`\`\`

## Key Concepts

- **ServiceWorker-native**: Universal runtime across all platforms
- **Cache-first**: Every request hits cache first for performance
- **Platform-agnostic**: Deploy anywhere with platform adapters`,
        category: "guide",
        version: "1.0",
        status: "published"
    },
    {
        title: "Cache Management",
        slug: "cache-management",
        content: `# Cache Management

Shovel provides automatic cache management with manual override capabilities.

## Automatic Cache Invalidation

\`\`\`javascript
// Increment cache version when making breaking changes
const cacheVersion = "v2"; 
const cache = await self.caches.open(\`pages-\${cacheVersion}\`);
\`\`\`

## Cache Headers

Control caching behavior with standard HTTP headers:

\`\`\`javascript
return new Response(content, {
  headers: {
    'Cache-Control': 'public, max-age=3600'
  }
});
\`\`\``,
        category: "guide", 
        version: "1.0",
        status: "published"
    },
    {
        title: "API Reference",
        slug: "api-reference",
        content: `# API Reference

Complete reference for Shovel's core APIs.

## Router

### \`Router.route(pattern)\`

Creates a new route with the given pattern.

\`\`\`javascript
router.route('/posts/:id').get(handler);
\`\`\`

### \`Router.use(middleware)\`

Adds global middleware to the router.

## Cache

### \`self.caches.open(name)\`

Opens a named cache for storing responses.`,
        category: "reference",
        version: "1.0", 
        status: "draft"
    }
];

// Sample admin user
const sampleUsers = [
    {
        username: "admin",
        email: "admin@shovel.dev",
        password_hash: "$2b$10$dummy.hash.for.demo.purposes.only", // In real app, use bcrypt
        role: "admin"
    }
];

async function seed() {
    console.log("🌱 Seeding database...");
    
    try {
        // Seed posts
        console.log("📝 Creating sample posts...");
        for (const post of samplePosts) {
            try {
                PostsDB.create(post);
                console.log(`  ✅ Created post: ${post.title}`);
            } catch (error) {
                if (error.message.includes('UNIQUE constraint failed')) {
                    console.log(`  ⚠️  Post already exists: ${post.title}`);
                } else {
                    throw error;
                }
            }
        }
        
        // Seed docs
        console.log("📚 Creating sample documentation...");
        for (const doc of sampleDocs) {
            try {
                DocsDB.create(doc);
                console.log(`  ✅ Created doc: ${doc.title}`);
            } catch (error) {
                if (error.message.includes('UNIQUE constraint failed')) {
                    console.log(`  ⚠️  Doc already exists: ${doc.title}`);
                } else {
                    throw error;
                }
            }
        }
        
        // Seed users
        console.log("👤 Creating sample users...");
        for (const user of sampleUsers) {
            try {
                UsersDB.create(user);
                console.log(`  ✅ Created user: ${user.username}`);
            } catch (error) {
                if (error.message.includes('UNIQUE constraint failed')) {
                    console.log(`  ⚠️  User already exists: ${user.username}`);
                } else {
                    throw error;
                }
            }
        }
        
        console.log("🎉 Database seeding complete!");
        
    } catch (error) {
        console.error("❌ Seeding failed:", error);
        process.exit(1);
    }
}

// Run seeding if called directly
if (import.meta.main) {
    seed();
}

export { seed };