import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// base './' 使产物既可部署到 GitHub Pages 子路径，也可直接双击 file:// 打开
export default defineConfig({
  plugins: [viteSingleFile()],
  base: './',
  build: {
    target: 'es2020',
  },
});
