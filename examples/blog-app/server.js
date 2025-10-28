// Server entry point for Shovel CLI
import router from './src/app.js';

// Export the router as default with required interface for Shovel CLI
export default {
  // Handle all requests through the router
  async fetch(request) {
    return await router.match(request, { params: {} });
  },

  // Static paths for SSG build
  staticPaths() {
    return [
      '/',
      '/about',
      '/posts/1',
      '/posts/2', 
      '/posts/3',
      '/api/posts'
    ];
  }
};