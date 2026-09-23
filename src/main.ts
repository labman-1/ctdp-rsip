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

function commit(e: ChainEvent): void {
  S = append(S, e);
  render(root, S, handlers);
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
        if (next) { S = next; render(root, S, handlers); }
        else alert('数据校验失败，未替换');
      }
    } catch {
      alert('无法解析该文件');
    }
  };
  input.click();
}

const handlers = {
  onTrigger: () => commit({ ts: Date.now(), type: 'trigger', chain: 'C1' }),
  onDone: () => commit({ ts: Date.now(), type: 'done', chain: 'C1' }),
  onFail: async () => {
    const e = await openVerdictDialog();
    if (e) commit(e);
  },
  onScore: async () => {
    const e = await openScoreDialog();
    if (e) commit(e);
  },
  onExport: exportJson,
  onImport: importJson,
};

render(root, S, handlers);
setupPwa();
