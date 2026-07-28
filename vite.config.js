import { defineConfig } from 'vite';
import plugin from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
    base: '/SoAInterface/',
    plugins: [plugin()],
    server: {
        port: 49396,
    }
})