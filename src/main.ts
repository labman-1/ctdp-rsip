// 入口：加载状态 → 绑定事件 → 全量渲染。
// commit() 是唯一的状态变更路径（append 事件 → 落盘 → 重渲染）。

import { load, append, replaceWith } from './state';
import { bookingState } from './logic/chain';
import { render } from './ui/render';
import { openVerdictDialog, openScoreDialog, openImportConfirm } from './ui/dialogs';
import { setupPwa } from './pwa';
import type { ChainEvent } from './types';
import './style.css';

const root = document.getElementById('app') as HTMLElement;
let S = load();
// UI 偏好（当前选中链）独立于核心数据，单独存一个 key
const UI_KEY = 'ctdp_ui_chain';
let currentId = localStorage.getItem(UI_KEY) ?? 'C1';
if (currentId.endsWith('预约')) currentId = currentId.replace('预约', '');
if (!S.chains[currentId]) currentId = Object.keys(S.chains)[0] ?? 'C1';

function commit(e: ChainEvent): void {
  S = append(S, e);
  render(root, S, handlers, currentId);
}

function rerender(): void {
  render(root, S, handlers, currentId);
}

function exportJson(): void {
  const day = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const name = `ctdp_${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}.json`;
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJson(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data?.events)) { alert('文件结构不符'); return; }
      if (await openImportConfirm(data.events.length)) {
        const next = replaceWith(data);
        if (next) {
          S = next;
          if (!S.chains[currentId]) currentId = Object.keys(S.chains)[0] ?? 'C1';
          rerender();
        }
        else alert('数据校验失败，未替换');
      }
    } catch {
      alert('无法解析该文件');
    }
  };
  input.click();
}

const handlers = {
  onSwitchChain: () => {
    const ids = Object.keys(S.chains).filter((id) => !id.endsWith('预约'));
    if (ids.length < 2) return;
    currentId = ids[(ids.indexOf(currentId) + 1) % ids.length];
    localStorage.setItem(UI_KEY, currentId);
    rerender();
  },
  onTrigger: () => {
    // 预约兑现：窗口内触发主链时，同步为预约链记一个 done（双事件提交）
    const booking = bookingState(S, currentId);
    commit({ ts: Date.now(), type: 'trigger', chain: currentId });
    if (booking.phase === 'booked' || booking.phase === 'due') {
      S = append(S, { ts: Date.now(), type: 'done', chain: currentId + '预约' });
      rerender();
    }
  },
  onBooking: () => {
    // 有上下文的授权时机：用户刚表达"我要预约"（默认态才询问，拒绝过不再骚扰）
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    commit({ ts: Date.now(), type: 'booking', chain: currentId + '预约' });
  },
  onBookingVerdict: async () => {
    const e = await openVerdictDialog(currentId + '预约');
    if (e) commit(e);
  },
  onDone: () => commit({ ts: Date.now(), type: 'done', chain: currentId }),
  onFail: async () => {
    const e = await openVerdictDialog(currentId);
    if (e) commit(e);
  },
  onAmend: async (chainId: string) => {
    if (!chainId) return;
    const e = await openVerdictDialog(chainId, 'amend');
    if (e) commit(e);
  },
  onScore: async () => {
    const e = await openScoreDialog();
    if (e) commit(e);
  },
  onExport: exportJson,
  onImport: importJson,
};

rerender();
setupPwa();

// ── 倒计时驱动器：每秒局部更新倒计时文本；预约状态机相位变化时整页重渲染。
//    到期/失约时：系统通知（已授权且环境允许）+ 标签页标题闪烁（后台标签的次级信号）。──
const BASE_TITLE = document.title;
let lastPhase = bookingState(S, currentId).phase;
let flashOn = false;

function notify(title: string, body: string): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'ctdp-booking' });
    }
  } catch { /* 无授权或环境不支持时静默 */ }
}

setInterval(() => {
  const view = bookingState(S, currentId);
  if (view.phase !== lastPhase) {
    lastPhase = view.phase;
    rerender();
    if (view.phase === 'due') {
      notify('预约到期', '宽限 5 分钟内立即触发 — 链 · CTDP');
    } else if (view.phase === 'overdue') {
      notify('预约失约', '打开页面完成下必为例裁决');
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
  const el = document.getElementById('countdown');
  if (el && view.deadline !== null) {
    const remain = Math.max(0, Math.ceil((view.deadline - Date.now()) / 1000));
    const m = Math.floor(remain / 60);
    const sec = String(remain % 60).padStart(2, '0');
    el.textContent = `${m}:${sec}`;
  }
}, 1000);
