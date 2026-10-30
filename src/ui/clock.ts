// ─────────────────────────────────────────────────────────────
// clock.ts — 倒计时驱动器（每秒副作用组件，从组合根拆出）
// 职责：预约倒计时文本、专注经过分钟数、相位跃迁检测（重渲染+通知）、标题状态机。
// 依赖全部注入（不读全局），便于将来单独测试。
// ─────────────────────────────────────────────────────────────

import { bookingState, computeChain } from '../logic/chain';
import type { BookingPhase } from '../logic/chain';
import type { AppState } from '../types';

export interface ClockDeps {
  getState(): AppState;
  getCurrentId(): string;
  rerender(): void;
  notify(title: string, body: string): void;
}

const BASE_TITLE = typeof document !== 'undefined' ? document.title : 'CTDP·RSIP';
const DUE_TITLE = '⚠ 预约到期 · 立即触发';
const OVERDUE_TITLE = '⚠ 预约失约 · 待裁决';
/** 报警突发时长：进入 due 的现场观察时刻起 30 秒 1Hz 闪（撞针时刻），其后转静态——
 *  无界闪烁=警报疲劳+违反"无动画"审美原则；加载进已到期态不突发（页面内状态行已在提示） */
const BURST_MS = 30_000;

/** 标题状态机（纯函数）：due 突发期 1Hz 闪（warn↔基名），其余 due/overdue 静态警示，无事项恢复基名 */
export function titleFor(phase: BookingPhase, burstActive: boolean, flashOn: boolean): string {
  if (phase === 'overdue') return OVERDUE_TITLE;
  if (phase === 'due') {
    if (!burstActive) return DUE_TITLE;
    return flashOn ? DUE_TITLE : BASE_TITLE;
  }
  return BASE_TITLE;
}

export function startClock(deps: ClockDeps): void {
  let lastPhase = bookingState(deps.getState(), deps.getCurrentId()).phase;
  let flashOn = false;
  let burstUntil = 0; // 仅当页面在场观察到 due 跃迁时置位；加载进 in-due 为 0（不突发）

  setInterval(() => {
    const view = bookingState(deps.getState(), deps.getCurrentId());
    if (view.phase !== lastPhase) {
      lastPhase = view.phase;
      burstUntil = view.phase === 'due' ? Date.now() + BURST_MS : 0;
      // 跃迁当拍立即设标题（报警零延迟，不等下一秒）
      document.title = titleFor(view.phase, Date.now() < burstUntil, true);
      if (view.phase === 'due') {
        deps.notify('预约到期', '宽限 5 分钟内立即触发 — CTDP·RSIP');
      } else if (view.phase === 'overdue') {
        deps.notify('预约失约', '打开页面完成下必为例裁决');
      }
      deps.rerender();
      return;
    }
    // 标题：due/overdue 期间按状态机幂等设置（突发期闪、其后静态；加载进 overdue 直接静态）
    if (view.phase === 'due' || view.phase === 'overdue') {
      flashOn = !flashOn;
      document.title = titleFor(view.phase, Date.now() < burstUntil, flashOn);
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
