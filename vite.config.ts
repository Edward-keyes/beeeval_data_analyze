import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths"

// https://vite.dev/config/
export default defineConfig({
    // 明确指定项目根目录
    root: process.cwd(),

    // 如果是部署到子路径，请取消注释并设置正确的 base
    // base: '/your-subpath/',

    build: {
        sourcemap: 'hidden',
        // 添加构建输出目录
        outDir: 'dist',
        // 优化构建
        minify: 'esbuild',
        rollupOptions: {
            output: {
                manualChunks: undefined, // 或配置代码分割策略
            }
        }
    },

    server: {
        port: 3000,
        // true = 监听 0.0.0.0，同局域网可访问；仅本机用可改回 'localhost'
        host: true,
        open: true,
        proxy: {
            '/api': {
                target: 'http://localhost:8004',
                changeOrigin: true,
            },
            // 视频截图直接走后端 StaticFiles。dev 模式下也把它代理到 8004，
            // 避免前端用相对路径 /screenshots/xxx.jpg 时打到 vite 的 3000 上 404。
            '/screenshots': {
                target: 'http://localhost:8004',
                changeOrigin: true,
            },
        },
        hmr: {
            overlay: true
        }
    },

    plugins: [
        react({
            babel: {
                plugins: [
                    'react-dev-locator',
                ],
            },
            jsxRuntime: 'automatic',
        }),

        tsconfigPaths()
    ],

    // 添加别名配置（如果需要）
    resolve: {
        alias: {
            '@': '/src',
        }
    }
})