// 全量重渲染：DOM 永远从 AppState 重算，无双向绑定、无增量同步。
// 事件量级（每天几条）下 innerHTML 重建完全够用。

import type { AppState } from '../types';
import { computeChain, verdictList, bookingState } from '../logic/chain';
import { todayScore, averageLast7 } from '../logic/score';

export interface Handlers {
  onSwitchChain(): void;
  onTrigger(): void;
  onBooking(): void;
  onBookingVerdict(): void;
  onDone(): void;
  onFail(): void;
  onAmend(chainId: string): void;
  onScore(): void;
  onExport(): void;
  onImport(): void;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const EVENT_LABEL: Record<string, string> = {
  trigger: '触发', done: '完成 +1', fail: '判失败 · 清零', verdict: '判例登记',
  score: '评分', booking: '预约',
};

export function render(root: HTMLElement, s: AppState, h: Handlers, currentId: string): void {
  // UI 状态外置：记录展开中的 details 位置，重建后恢复（全量重渲染不携带 UI 状态）
  const openIndexes = Array.from(root.querySelectorAll('details'))
    .map((d, i) => (d as HTMLDetailsElement).open ? i : -1)
    .filter((i) => i >= 0);
  const chain = computeChain(s, currentId);
  if (!chain) { root.innerHTML = '<p>状态损坏</p>'; return; }
  const multi = Object.keys(s.chains).length > 1;
  const booking = bookingState(s, currentId);
  const bookingChain = computeChain(s, currentId + '预约');
  const active = chain.activeSince !== null;
  const mins = active ? Math.max(0, Math.round((Date.now() - (chain.activeSince as number)) / 60000)) : 0;

  const statusHtml = active
    ? `<div class="status active">专注中 · 已 <span id="elapsed">${mins}</span> 分 — 手机离手</div>`
      : booking.phase === 'booked'
        ? `<div class="status active">预约中 · 剩余 <span id="countdown">--:--</span></div>
           <div class="status" style="font-size:12px; margin-top:4px">锁屏场景请顺手设一个 15 分钟系统倒计时（页面后台时提醒不可靠）</div>`
      : booking.phase === 'due'
        ? `<div class="status active">预约到期 · 宽限中 — 立即触发</div>`
        : booking.phase === 'overdue'
          ? `<div class="status" style="color:var(--danger)">预约失约 · 待裁决</div>`
          : `<div class="status">未触发${bookingChain && bookingChain.length > 0 ? ` · 预约链 #${bookingChain.length}` : ''}${chain.lastFailAt ? ` · 链于 ${fmtTime(chain.lastFailAt)} 清零重来` : ''}</div>`;

  // 按钮组：active 优先；其次预约状态机；最后 idle
  const actionsHtml = active
    ? `<button id="btn-trigger" disabled>触发</button>
       <button id="btn-done">完成</button>
       <button id="btn-fail" class="danger">失败</button>`
    : booking.phase === 'overdue'
      ? `<button id="btn-booking-verdict" class="danger" style="grid-column: 1 / -1">失约裁决（下必为例）</button>`
      : booking.phase === 'booked' || booking.phase === 'due'
        ? `<button id="btn-trigger" class="primary" style="grid-column: span 2; font-weight:600">立即触发</button>
           <button id="btn-booking-verdict" class="danger">失约裁决</button>`
        : `<button id="btn-trigger">触发</button>
           <button id="btn-booking" ${booking.phase === 'none' ? '' : 'disabled'}>预约</button>
           <button id="btn-fail" class="danger" disabled>失败</button>`;

  const today = todayScore(s);
  const avg = averageLast7(s);
  const verdicts = verdictList(s);
  const recent = [...s.events].reverse().slice(0, 60);

  root.innerHTML = `
    <div class="topbar">
      <button id="btn-chain" class="chain-switch" title="点击切换链">${multi ? '‹ ' : ''}${esc(chain.name)}${multi ? ' ›' : ''}</button>
      <span>总节点 ${chain.totalDone}</span>
    </div>

    <div class="hero">
      <div class="num">${chain.length}</div>
      ${statusHtml}
    </div>

    <div class="actions">${actionsHtml}</div>

    <div class="toolrow">
      <span>${
        today
          ? `今日评分 ${today.score.toFixed(1)} · ${esc(today.note ?? '')}`
          : '今日未评分'
      }</span>
      <button id="btn-score">评分</button>
    </div>

    <details class="section">
      <summary><span>判例库</span><span>${verdicts.length} 条</span></summary>
      <div class="itemlist">${
        verdicts.length === 0
          ? '<div class="row">（尚无判例 — 疑似违规时当场裁决登记）</div>'
          : verdicts.map((v) => `<div class="row"><span class="t">${fmtTime(v.ts)}</span><span>${esc(v.text)}</span></div>`).join('')
      }</div>
    </details>

    <details class="section">
      <summary><span>事件历史</span><span>${s.events.length} 条</span></summary>
      <div class="itemlist">${
        recent.map((e) => {
          const extra = e.type === 'verdict' && e.verdictText ? `：${e.verdictText}`
            : e.type === 'score' ? ` ${e.score}${e.note ? ` · ${e.note}` : ''}`
            : e.note ? `：${e.note}` : '';
          const amend = e.type === 'done' && e.chain
            ? `<span class="amend" data-chain="${esc(e.chain)}">补判</span>` : '';
          return `<div class="row"><span class="t">${fmtTime(e.ts)}</span><span>${EVENT_LABEL[e.type] ?? e.type}${esc(extra)}</span>${amend}</div>`;
        }).join('')
      }</div>
    </details>

    <div class="footer">
      <span class="weekavg">${avg !== null ? `近 7 天均分 ${avg.toFixed(1)}` : ''} <span class="ver">v${__APP_VERSION__}</span></span>
      <div>
        <button id="btn-export">导出</button>
        <button id="btn-import">导入</button>
      </div>
    </div>
  `;

  root.querySelector('#btn-chain')?.addEventListener('click', h.onSwitchChain);
  root.querySelector('#btn-trigger')?.addEventListener('click', h.onTrigger);
  root.querySelector('#btn-booking')?.addEventListener('click', h.onBooking);
  root.querySelector('#btn-booking-verdict')?.addEventListener('click', h.onBookingVerdict);
  root.querySelectorAll<HTMLElement>('.amend').forEach((a) =>
    a.addEventListener('click', () => h.onAmend(a.dataset.chain ?? '')));
  root.querySelector('#btn-done')?.addEventListener('click', h.onDone);
  root.querySelector('#btn-fail')?.addEventListener('click', h.onFail);
  root.querySelector('#btn-score')?.addEventListener('click', h.onScore);
  root.querySelector('#btn-export')?.addEventListener('click', h.onExport);
  root.querySelector('#btn-import')?.addEventListener('click', h.onImport);

  // 恢复展开状态（details 顺序固定，按索引对应）
  root.querySelectorAll('details').forEach((d, i) => {
    if (openIndexes.includes(i)) (d as HTMLDetailsElement).open = true;
  });
}

export { fmtTime };
