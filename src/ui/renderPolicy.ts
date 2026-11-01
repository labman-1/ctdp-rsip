// 国策视图：森林分区（每个独立根一节）+ 嵌套容器树线（父子=连线，兄弟=并列）+ 手牌库 + 底部 tab。

import type { AppState } from '../types';
import { policyView, canJoin, canUnfreeze, unitLabel, type PolicyView } from '../logic/policy';

export interface PolicyHandlers {
  onSwitchTab(tab: 'chain' | 'policy'): void;
  onNewPolicy(): void;
  onSettle(): void;
  onJoin(id: string): void;
  onCollapse(id: string): void;
  onFreeze(): void;
  onUnfreeze(id: string): void;
  onDetail(id: string): void;
}

const KIND_LABEL: Record<string, string> = { passive: '被动', semi: '半被动', active: '主动' };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cardRow(s: AppState, v: PolicyView, id: string): string {
  const def = s.policies[id];
  const n = v.nodes[id];
  if (!def || !n) return '';
  const joinable = canJoin(v, id);
  return `
    <div class="policy-card${n.alive ? '' : ' inhand'}">
      <div class="policy-main">
        <span class="policy-name">${esc(def.name)}</span>
        <span class="policy-tags">
          <span class="tag kind-${def.kind}">${KIND_LABEL[def.kind]}</span>
          <span class="tag">lv.${def.level}</span>
          <span class="tag">${n.daysTotal}${unitLabel(def)}</span>
          ${n.frozenSince !== null
            ? '<span class="tag">舱内</span>'
            : n.alive
              ? (def.kind === 'passive'
                  ? '<span class="tag kind-passive">在岗</span>'
                  : n.doneToday ? '<span class="tag done">今日✓</span>' : '<span class="tag todo">今日未结算</span>')
              : ''}
        </span>
      </div>
      ${def.brief ? `<div class="policy-brief">${esc(def.brief)}</div>` : ''}
      <div class="policy-ops">
        <button class="mini" data-detail="${id}">详情</button>
        ${n.frozenSince === null
          ? (n.alive
              ? `<button class="mini danger" data-collapse="${id}">熄灭</button>`
              : `<button class="mini${joinable.ok ? '' : ' dim'}" data-join="${id}">上树</button>`)
          : ''}
      </div>
    </div>`;
}

/** 子树：节点卡片 + 子树容器（嵌套容器树线——连线随子树连续） */
function subtreeOf(s: AppState, v: PolicyView, id: string): string {
  const kids = v.nodes[id]?.children ?? [];
  const inner = kids.map((c) => subtreeOf(s, v, c)).join('');
  return cardRow(s, v, id) + (kids.length ? `<div class="tree-branch">${inner}</div>` : '');
}

/** 森林：每个独立根一节 */
function treeOf(s: AppState, v: PolicyView): string {
  return v.roots.map((r) => `<div class="tree-root">${subtreeOf(s, v, r)}</div>`).join('');
}

export function renderPolicy(root: HTMLElement, s: AppState, h: PolicyHandlers, tab: 'chain' | 'policy'): void {
  if (tab !== 'policy') return; // main 负责分发，此处只渲染国策 tab
  const v = policyView(s);

  // 舱（水密隔舱）作为整体展示：封舱是事件不是单卡属性——统一入口进入，逐条启封退出
  const fzBlock = v.frozen.length > 0 ? (() => {
    const newest = [...v.frozen].sort((a, b) => (v.nodes[b].frozenSince ?? 0) - (v.nodes[a].frozenSince ?? 0))[0];
    const head = v.nodes[newest];
    const until = head.frozenExpectedUntil;
    const rows = v.frozen.map((id) => {
      const n = v.nodes[id];
      const ok = canUnfreeze(v, id).ok;
      const state = n.kind === 'passive' ? '启封即在岗' : (n.doneToday ? '今日凭证✓' : '需当日凭证');
      return `<div class="fz-row">
        <span>${esc(s.policies[id]?.name ?? id)} · ${state}</span>
        <button class="mini${ok ? '' : ' dim'}" data-unfreeze="${id}">启封</button>
      </div>`;
    }).join('');
    return `
    <div class="fz-block">
      <div class="section-title">舱 · 水密隔舱（${v.frozen.length}）</div>
      <div class="policy-brief">理由：${esc(head.frozenReason ?? '（未填）')} · 预期：${until ? new Date(until).toLocaleDateString() : '未设'}${v.freezeOverdue.length > 0 ? '（<b>已逾期</b>——逾期不强制，恢复为准）' : ''}</div>
      ${rows}
    </div>`;
  })() : '';

  root.innerHTML = `
    <div class="topbar">
      <span>国策树 · RSIP</span>
      <span>今日配额 ${v.joinsToday >= 1 ? '已用' : '可用'}${v.frozen.length > 0 ? ` · 舱内 ${v.frozen.length}` : ''}</span>
    </div>

    <div class="actions" style="margin-top:14px">
      <button id="btn-settle">今日结算</button>
      <button id="btn-freeze">封舱</button>
      <button id="btn-new-policy">新建国策</button>
    </div>

    ${fzBlock}

    <div class="policy-section">
      <div class="section-title">在树（${countAlive(v)} 节点 · ${v.roots.length} 根）</div>
      ${v.roots.length ? treeOf(s, v) : '<div class="empty">（树为空 — 国策先入手牌，当日执行成功后方可上树）</div>'}
    </div>

    <div class="policy-section">
      <div class="section-title">手牌（${v.hand.length}）</div>
      ${v.hand.length ? v.hand.map((id) => cardRow(s, v, id)).join('') : '<div class="empty">（无手牌）</div>'}
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
  root.querySelector('#btn-settle')?.addEventListener('click', () => h.onSettle());
  root.querySelector('#btn-freeze')?.addEventListener('click', () => h.onFreeze());
  root.querySelector('#btn-new-policy')?.addEventListener('click', () => h.onNewPolicy());
  root.querySelectorAll<HTMLButtonElement>('[data-join]').forEach((b) =>
    b.addEventListener('click', () => h.onJoin(b.dataset.join ?? '')));
  root.querySelectorAll<HTMLButtonElement>('[data-collapse]').forEach((b) =>
    b.addEventListener('click', () => h.onCollapse(b.dataset.collapse ?? '')));
  root.querySelectorAll<HTMLButtonElement>('[data-unfreeze]').forEach((b) =>
    b.addEventListener('click', () => h.onUnfreeze(b.dataset.unfreeze ?? '')));
  root.querySelectorAll<HTMLButtonElement>('[data-detail]').forEach((b) =>
    b.addEventListener('click', () => h.onDetail(b.dataset.detail ?? '')));
}

function countAlive(v: PolicyView): number {
  return Object.values(v.nodes).filter((n) => n.alive).length;
}
