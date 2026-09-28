import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'));

// base './' 使产物既可部署到 GitHub Pages 子路径，也可直接双击 file:// 打开
export default defineConfig({
  plugins: [viteSingleFile()],
  base: './',
  define: {
    // 构建时注入版本号：包版本 + 构建时间戳（页面页脚显示，用于识别缓存旧版）
    __APP_VERSION__: JSON.stringify(`${pkg.version}.${Math.floor(Date.now() / 60000)}`),
  },
  build: {
    target: 'es2020',
  },
});
