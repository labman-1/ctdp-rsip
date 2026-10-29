// 顶栏链下拉：锚定原位的轻量选择器（v0.2.3，替代模态弹窗——高频导航不配打断式弹窗）。
// 滚轮/滚动条 = 容器 max-height + overflow 的浏览器原生行为；点行即选、点外部/Esc 关闭。

import type { AppState } from '../types';
import { computeChain, bookingState } from '../logic/chain';

let drop: HTMLDivElement | null = null;
let anchorEl: HTMLElement | null = null;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function onDocPointer(e: PointerEvent): void {
  const t = e.target as Node;
  if (drop && !drop.contains(t) && !(anchorEl && anchorEl.contains(t))) close();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}

export function close(): void {
  drop?.remove();
  drop = null;
  anchorEl = null;
  document.removeEventListener('pointerdown', onDocPointer, true);
  document.removeEventListener('keydown', onKey, true);
}

/** 点顶栏链名切换开/关。onPick：选中非当前链时的回调（此时下拉已关） */
export function toggle(anchor: HTMLElement, s: AppState, currentId: string, onPick: (id: string) => void): void {
  if (drop) { close(); return; }
  const ids = Object.keys(s.chains).filter((id) => !id.endsWith('预约'));
  const rows = ids.map((id) => {
    const v = computeChain(s, id);
    const st = v?.activeSince ? '<span class="pick-st" title="专注中">●</span>'
      : (['booked', 'due'].includes(bookingState(s, id).phase) ? '<span class="pick-st" title="预约中">◔</span>' : '');
    return `<button class="pick-row${id === currentId ? ' pick-cur' : ''}" data-id="${id}">
      <span class="pick-id">${id}</span>
      <span class="pick-name">${esc(s.chains[id]?.name ?? id)}</span>
      <span class="pick-len">${v?.length ?? 0}</span>${st}</button>`;
  }).join('');

  drop = document.createElement('div');
  drop.className = 'chain-drop';
  drop.innerHTML = rows;
  const rect = anchor.getBoundingClientRect();
  drop.style.left = `${rect.left}px`;
  drop.style.top = `${rect.bottom + 6}px`;
  drop.querySelectorAll<HTMLButtonElement>('.pick-row').forEach((b) =>
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = b.dataset.id ?? '';
      close();
      onPick(id);
    }));
  document.body.appendChild(drop);
  anchorEl = anchor;
  document.addEventListener('pointerdown', onDocPointer, true);
  document.addEventListener('keydown', onKey, true);
}
