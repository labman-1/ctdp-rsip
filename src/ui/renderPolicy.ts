// 国策视图：缩进树 + 手牌库 + 底部 tab。
// 树的力学（父子/连坐/末梢）用缩进与左边线表达，不做画布。

import type { AppState } from '../types';
import { policyView, canJoin, type PolicyView } from '../logic/policy';

export interface PolicyHandlers {
  onSwitchTab(tab: 'chain' | 'policy'): void;
  onNewPolicy(): void;
  onSettle(): void;
  onJoin(id: string): void;
  onCollapse(id: string): void;
  onDetail(id: string): void;
}

const KIND_LABEL: Record<string, string> = { passive: '被动', semi: '半被动', active: '主动' };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cardRow(s: AppState, v: PolicyView, id: string, depth: number): string {
  const def = s.policies[id];
  const n = v.nodes[id];
  if (!def || !n) return '';
  const joinable = canJoin(v, id);
  return `
    <div class="policy-card${n.alive ? '' : ' inhand'}" style="margin-left:${depth * 18}px">
      <div class="policy-main">
        <span class="policy-name">${esc(def.name)}</span>
        <span class="policy-tags">
          <span class="tag kind-${def.kind}">${KIND_LABEL[def.kind]}</span>
          <span class="tag">lv.${def.level}</span>
          <span class="tag">${n.daysTotal}天</span>
          ${n.alive ? (n.doneToday ? '<span class="tag done">今日✓</span>' : '<span class="tag todo">今日未结算</span>') : ''}
        </span>
      </div>
      ${def.brief ? `<div class="policy-brief">${esc(def.brief)}</div>` : ''}
      <div class="policy-ops">
        <button class="mini" data-detail="${id}">详情</button>
        ${!n.alive
          ? `<button class="mini${joinable.ok ? '' : ' dim'}" data-join="${id}">上树</button>`
          : `<button class="mini danger" data-collapse="${id}">熄灭</button>`}
      </div>
    </div>`;
}

function treeOf(s: AppState, v: PolicyView): string {
  const out: string[] = [];
  const walk = (id: string, depth: number) => {
    out.push(cardRow(s, v, id, depth));
    for (const c of v.nodes[id]?.children ?? []) walk(c, depth + 1);
  };
  for (const r of v.roots) walk(r, 0);
  return out.join('');
}

export function renderPolicy(root: HTMLElement, s: AppState, h: PolicyHandlers, tab: 'chain' | 'policy'): void {
  if (tab !== 'policy') return; // main 负责分发，此处只渲染国策 tab
  const v = policyView(s);

  root.innerHTML = `
    <div class="topbar">
      <span>国策树 · RSIP</span>
      <span>今日配额 ${v.joinsToday >= 1 ? '已用' : '可用'}</span>
    </div>

    <div class="actions" style="margin-top:14px">
      <button id="btn-settle">今日结算</button>
      <button id="btn-new-policy">新建国策</button>
    </div>

    <div class="policy-section">
      <div class="section-title">在树（${v.roots.length ? countAlive(v) : 0}）</div>
      ${v.roots.length ? treeOf(s, v) : '<div class="empty">（树为空 — 国策先入手牌，当日执行成功后方可上树）</div>'}
    </div>

    <div class="policy-section">
      <div class="section-title">手牌（${v.hand.length}）</div>
      ${v.hand.length ? v.hand.map((id) => cardRow(s, v, id, 0)).join('') : '<div class="empty">（无手牌）</div>'}
    </div>

    <div class="footer">
      <span class="weekavg"><span class="ver">v${__APP_VERSION__}</span></span>
      <span></span>
    </div>
    <nav class="tabbar">
      <button class="tab" id="tab-chain">链</button>
      <button class="tab active" id="tab-policy">国策</button>
    </nav>
  `;

  root.querySelector('#tab-chain')?.addEventListener('click', () => h.onSwitchTab('chain'));
  root.querySelector('#btn-settle')?.addEventListener('click', h.onSettle);
  root.querySelector('#btn-new-policy')?.addEventListener('click', h.onNewPolicy);
  root.querySelectorAll<HTMLButtonElement>('[data-join]').forEach((b) =>
    b.addEventListener('click', () => h.onJoin(b.dataset.join ?? '')));
  root.querySelectorAll<HTMLButtonElement>('[data-collapse]').forEach((b) =>
    b.addEventListener('click', () => h.onCollapse(b.dataset.collapse ?? '')));
  root.querySelectorAll<HTMLButtonElement>('[data-detail]').forEach((b) =>
    b.addEventListener('click', () => h.onDetail(b.dataset.detail ?? '')));
}

function countAlive(v: PolicyView): number {
  return Object.values(v.nodes).filter((n) => n.alive).length;
}
