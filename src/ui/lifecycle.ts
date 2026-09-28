// 弹窗统一生命周期：按钮路径与 Esc/浏览器关闭路径都经 settled 防重入收口。
// 泛型 T 允许各弹窗 resolve 不同类型（事件 / 布尔 / 字符串等）。

export function wireLifecycle<T>(dlg: HTMLDialogElement, resolve: (v: T) => void): (v: T) => void {
  let settled = false;
  const finish = (result: T) => {
    if (settled) return;
    settled = true;
    dlg.close();
    dlg.remove();
    resolve(result);
  };
  // Esc / 浏览器关闭路径：以"取消"语义收口（null / false 由调用方传入的 fallback 值决定）
  dlg.addEventListener('close', () => {
    if (settled) return;
    settled = true;
    dlg.remove();
    resolve(undefined as unknown as T);
  });
  return finish;
}
