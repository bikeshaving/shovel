import { test, expect, describe } from 'bun:test';
import { staticFilesPlugin } from './plugin.js';
import { createStaticFilesHandler } from './handler.js';
import { mergeConfig, mergeRuntimeConfig, DEFAULT_CONFIG } from './shared.js';

describe('@b9g/staticfiles', () => {
  describe('Configuration', () => {
    test('mergeConfig uses defaults', () => {
      const config = mergeConfig();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    test('mergeConfig overrides defaults', () => {
      const config = mergeConfig({
        publicPath: '/custom/',
        outputDir: 'public/assets'
      });
      
      expect(config.publicPath).toBe('/custom/');
      expect(config.outputDir).toBe('public/assets');
      expect(config.hashLength).toBe(8); // default preserved
    });

    test('mergeRuntimeConfig sets dev mode correctly', () => {
      const config = mergeRuntimeConfig();
      expect(typeof config.dev).toBe('boolean');
      expect(config.sourceDir).toBe('src');
    });
  });

  describe('Plugin', () => {
    test('creates plugin with correct name', () => {
      const plugin = staticFilesPlugin();
      expect(plugin.name).toBe('shovel-staticfiles');
      expect(typeof plugin.setup).toBe('function');
    });

    test('accepts configuration options', () => {
      const plugin = staticFilesPlugin({
        publicPath: '/static/',
        outputDir: 'dist/static'
      });
      expect(plugin.name).toBe('shovel-staticfiles');
    });
  });

  describe('Handler', () => {
    test('creates handler function', () => {
      const handler = createStaticFilesHandler();
      expect(typeof handler).toBe('function');
    });

    test('returns 404 for non-asset paths', async () => {
      const handler = createStaticFilesHandler({
        publicPath: '/static/'
      });
      
      const request = new Request('http://example.com/api/users');
      const response = await handler(request);
      
      expect(response.status).toBe(404);
    });

    test('handles asset requests correctly', async () => {
      const handler = createStaticFilesHandler({
        publicPath: '/static/',
        dev: true,
        sourceDir: 'src'
      });
      
      const request = new Request('http://example.com/static/nonexistent.svg');
      const response = await handler(request);
      
      // Should return 404 for non-existent file in dev mode
      expect(response.status).toBe(404);
    });
  });

  describe('Integration', () => {
    test('plugin and handler use compatible configuration', () => {
      const config = {
        publicPath: '/static/',
        outputDir: 'dist/static',
        manifest: 'dist/static-manifest.json'
      };

      const plugin = staticFilesPlugin(config);
      const handler = createStaticFilesHandler(config);

      expect(plugin.name).toBe('shovel-staticfiles');
      expect(typeof handler).toBe('function');
    });
  });
});