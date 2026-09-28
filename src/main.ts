// 入口（组合根）：加载状态 → 绑定事件 → 全量渲染 → 启动驱动器与 PWA。
// commit() 是唯一的状态变更路径（append 事件 → 落盘 → 重渲染）。

import { load, append, replaceWith, loadUiChain, saveUiChain } from './state';
import { bookingState } from './logic/chain';
import { render } from './ui/render';
import { openVerdictDialog, openScoreDialog, openImportConfirm } from './ui/dialogs';
import { startClock } from './ui/clock';
import { setupPwa } from './pwa';
import type { ChainEvent } from './types';
import './style.css';

const root = document.getElementById('app') as HTMLElement;
let S = load();
let currentId = loadUiChain('C1');
if (!S.chains[currentId]) currentId = Object.keys(S.chains)[0] ?? 'C1';

function commit(e: ChainEvent): void {
  S = append(S, e);
  rerender();
}

function rerender(): void {
  render(root, S, handlers, currentId);
}

function notify(title: string, body: string): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'ctdp-booking' });
    }
  } catch { /* 无授权或环境不支持时静默 */ }
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
    saveUiChain(currentId);
    rerender();
  },
  onTrigger: () => {
    // 预约兑现：窗口内触发主链时，同批提交预约链的 done（原子化双事件）
    const booking = bookingState(S, currentId);
    if (booking.phase === 'booked' || booking.phase === 'due') {
      S = append(
        S,
        { ts: Date.now(), type: 'trigger', chain: currentId },
        { ts: Date.now(), type: 'done', chain: currentId + '预约' },
      );
      rerender();
    } else {
      commit({ ts: Date.now(), type: 'trigger', chain: currentId });
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
startClock({
  getState: () => S,
  getCurrentId: () => currentId,
  rerender,
  notify,
});
