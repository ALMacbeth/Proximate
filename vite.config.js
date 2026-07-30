import { defineConfig } from 'vite';
import plugin from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
    base: '/SoAInterface/',
    plugins: [plugin()],
    server: {
        port: 49396,
        watch: {
            // ignore Visual Studio metadata and other common noisy folders
            ignored: ['**/.vs/**', '**/node_modules/**', '**/.git/**']
        }
    }
})