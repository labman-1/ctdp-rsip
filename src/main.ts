// 入口：加载状态 → 绑定事件 → 全量渲染。
// commit() 是唯一的状态变更路径（append 事件 → 落盘 → 重渲染）。

import { load, append, replaceWith } from './state';
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
    const ids = Object.keys(S.chains);
    if (ids.length < 2) return;
    currentId = ids[(ids.indexOf(currentId) + 1) % ids.length];
    localStorage.setItem(UI_KEY, currentId);
    rerender();
  },
  onTrigger: () => commit({ ts: Date.now(), type: 'trigger', chain: currentId }),
  onDone: () => commit({ ts: Date.now(), type: 'done', chain: currentId }),
  onFail: async () => {
    const e = await openVerdictDialog(currentId);
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
