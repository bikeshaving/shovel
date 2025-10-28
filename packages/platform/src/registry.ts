/**
 * Platform registry for auto-detection and management
 */

import type { Platform, PlatformDetection, PlatformRegistry } from './types.js';

/**
 * Global platform registry
 */
class DefaultPlatformRegistry implements PlatformRegistry {
  private platforms = new Map<string, Platform>();

  register(name: string, platform: Platform): void {
    this.platforms.set(name, platform);
  }

  get(name: string): Platform | undefined {
    return this.platforms.get(name);
  }

  detect(): PlatformDetection {
    const detections: PlatformDetection[] = [];

    // Check for Bun
    if (typeof Bun !== 'undefined') {
      detections.push({
        platform: 'bun',
        confidence: 0.9,
        reasons: ['Bun global detected']
      });
    }

    // Check for Cloudflare Workers
    if (typeof caches !== 'undefined' && typeof Response !== 'undefined' && typeof crypto !== 'undefined') {
      // Additional check for Workers-specific globals
      if (typeof addEventListener !== 'undefined' && typeof fetch !== 'undefined') {
        detections.push({
          platform: 'cloudflare-workers',
          confidence: 0.8,
          reasons: ['Worker-like environment detected', 'Web APIs available']
        });
      }
    }

    // Check for Vercel Edge Runtime
    if (typeof EdgeRuntime !== 'undefined') {
      detections.push({
        platform: 'vercel',
        confidence: 0.9,
        reasons: ['Vercel EdgeRuntime detected']
      });
    }

    // Check for Deno
    if (typeof Deno !== 'undefined') {
      detections.push({
        platform: 'deno',
        confidence: 0.9,
        reasons: ['Deno global detected']
      });
    }

    // Check for Node.js (fallback)
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      detections.push({
        platform: 'node',
        confidence: 0.7,
        reasons: ['Node.js process detected']
      });
    }

    // Return highest confidence detection
    if (detections.length === 0) {
      return {
        platform: 'unknown',
        confidence: 0,
        reasons: ['No platform detected']
      };
    }

    return detections.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );
  }

  list(): string[] {
    return Array.from(this.platforms.keys());
  }
}

/**
 * Global platform registry instance
 */
export const platformRegistry = new DefaultPlatformRegistry();

/**
 * Auto-detect and return the appropriate platform
 */
export function detectPlatform(): Platform | null {
  const detection = platformRegistry.detect();
  
  if (detection.confidence > 0.5) {
    const platform = platformRegistry.get(detection.platform);
    if (platform) {
      return platform;
    }
  }

  return null;
}

/**
 * Get platform by name with error handling
 */
export function getPlatform(name: string): Platform {
  const platform = platformRegistry.get(name);
  if (!platform) {
    const available = platformRegistry.list();
    throw new Error(
      `Platform '${name}' not found. Available platforms: ${available.join(', ')}`
    );
  }
  return platform;
}