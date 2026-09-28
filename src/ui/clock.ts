// ─────────────────────────────────────────────────────────────
// clock.ts — 倒计时驱动器（每秒副作用组件，从组合根拆出）
// 职责：预约倒计时文本、专注经过分钟数、相位跃迁检测（重渲染+通知）、标题闪烁。
// 依赖全部注入（不读全局），便于将来单独测试。
// ─────────────────────────────────────────────────────────────

import { bookingState, computeChain } from '../logic/chain';
import type { AppState } from '../types';

export interface ClockDeps {
  getState(): AppState;
  getCurrentId(): string;
  rerender(): void;
  notify(title: string, body: string): void;
}

const BASE_TITLE = typeof document !== 'undefined' ? document.title : '链 · CTDP';

export function startClock(deps: ClockDeps): void {
  let lastPhase = bookingState(deps.getState(), deps.getCurrentId()).phase;
  let flashOn = false;

  setInterval(() => {
    const view = bookingState(deps.getState(), deps.getCurrentId());
    if (view.phase !== lastPhase) {
      lastPhase = view.phase;
      deps.rerender();
      if (view.phase === 'due') {
        deps.notify('预约到期', '宽限 5 分钟内立即触发 — 链 · CTDP');
      } else if (view.phase === 'overdue') {
        deps.notify('预约失约', '打开页面完成下必为例裁决');
      } else if (view.phase === 'none') {
        document.title = BASE_TITLE;
      }
      return;
    }
    // 标题闪烁：due/overdue 期间持续，回正自动恢复
    if (view.phase === 'due' || view.phase === 'overdue') {
      flashOn = !flashOn;
      document.title = flashOn ? '⚠ 预约待处理' : BASE_TITLE;
    }
    // 预约倒计时文本（局部更新）
    const el = document.getElementById('countdown');
    if (el && view.deadline !== null) {
      const remain = Math.max(0, Math.ceil((view.deadline - Date.now()) / 1000));
      const m = Math.floor(remain / 60);
      const sec = String(remain % 60).padStart(2, '0');
      el.textContent = `${m}:${sec}`;
    }
    // 主链专注中的经过分钟数（局部更新）
    const elapsedEl = document.getElementById('elapsed');
    if (elapsedEl) {
      const v = computeChain(deps.getState(), deps.getCurrentId());
      if (v?.activeSince != null) {
        elapsedEl.textContent = String(Math.floor((Date.now() - v.activeSince) / 60000));
      }
    }
  }, 1000);
}
