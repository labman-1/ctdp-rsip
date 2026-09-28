// PWA 内嵌：manifest 与图标全部运行时生成（canvas 图标 → dataURL，
// manifest → Blob URL），维持单文件产物约束。Hamon 验证过的方案。
// service worker 注册失败时静默降级 —— localStorage 本身就是离线的，
// SW 只优化"离线打开"体验，不是功能依赖。

function makeIcon(size: number): string {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#101010';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = `bold ${size * 0.55}px system-ui, "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('链', size / 2, size / 2 + size * 0.03);
  return c.toDataURL('image/png');
}

export function setupPwa(): void {
  // 注册 Service Worker（network-first 缓存，见 public/sw.js）；file:// 或不支持时静默跳过
  try {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      void navigator.serviceWorker.register('./sw.js');
    }
  } catch { /* SW 失败不影响核心功能 */ }
  try {
    const icon192 = makeIcon(192);
    const icon512 = makeIcon(512);
    const manifest = {
      name: '链 · CTDP',
      short_name: '链',
      start_url: '.',
      display: 'standalone',
      background_color: '#101010',
      theme_color: '#101010',
      icons: [
        { src: icon192, sizes: '192x192', type: 'image/png' },
        { src: icon512, sizes: '512x512', type: 'image/png' },
      ],
    };
    const manifestUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = manifestUrl;
    document.head.appendChild(link);

    // apple-touch-icon（iOS 添加到主屏幕）
    const appleIcon = document.createElement('link');
    appleIcon.rel = 'apple-touch-icon';
    appleIcon.href = icon192;
    document.head.appendChild(appleIcon);
  } catch {
    // PWA 失败不影响核心功能
  }
}
