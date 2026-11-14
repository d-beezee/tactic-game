import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// in development the API runs as a separate process (apps/server); in production one server does both
export default defineConfig({ plugins: [react()], server: { proxy: { '/api': 'http://localhost:3000' } } });
