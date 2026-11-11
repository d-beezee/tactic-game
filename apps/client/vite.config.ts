import { defineConfig } from 'vite';

// in development the API runs as a separate process (apps/server); in production one server does both
export default defineConfig({ server: { proxy: { '/api': 'http://localhost:3000' } } });
