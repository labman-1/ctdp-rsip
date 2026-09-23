// 全量重渲染：DOM 永远从 AppState 重算，无双向绑定、无增量同步。
// 事件量级（每天几条）下 innerHTML 重建完全够用。

import type { AppState } from '../types';
import { computeChain, verdictList } from '../logic/chain';
import { todayScore, averageLast7 } from '../logic/score';

export interface Handlers {
  onTrigger(): void;
  onDone(): void;
  onFail(): void;
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

export function render(root: HTMLElement, s: AppState, h: Handlers): void {
  const chain = computeChain(s, 'C1');
  if (!chain) { root.innerHTML = '<p>状态损坏</p>'; return; }

  const active = chain.activeSince !== null;
  const mins = active ? Math.max(0, Math.round((Date.now() - (chain.activeSince as number)) / 60000)) : 0;
  const statusHtml = active
    ? `<div class="status active">专注中 · 已 ${mins} 分 — 手机离手</div>`
    : `<div class="status">未触发${chain.lastFailAt ? ` · 链于 ${fmtTime(chain.lastFailAt)} 清零重来` : ''}</div>`;

  const today = todayScore(s);
  const avg = averageLast7(s);
  const verdicts = verdictList(s);
  const recent = [...s.events].reverse().slice(0, 60);

  root.innerHTML = `
    <div class="topbar">
      <span>${esc(chain.name)}</span>
      <span>总节点 ${chain.totalDone}</span>
    </div>

    <div class="hero">
      <div class="num">${chain.length}</div>
      ${statusHtml}
    </div>

    <div class="actions">
      <button id="btn-trigger" ${active ? 'disabled' : ''}>触发</button>
      <button id="btn-done" ${active ? '' : 'disabled'}>完成</button>
      <button id="btn-fail" class="danger" ${active ? '' : 'disabled'}>失败</button>
    </div>

    <div class="toolrow">
      <span>${
        today
          ? `今日评分 ${today.score} · ${esc(today.note ?? '')}`
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
          return `<div class="row"><span class="t">${fmtTime(e.ts)}</span><span>${EVENT_LABEL[e.type] ?? e.type}${esc(extra)}</span></div>`;
        }).join('')
      }</div>
    </details>

    <div class="footer">
      <span class="weekavg">${avg !== null ? `近 7 天均分 ${avg.toFixed(1)}` : ''}</span>
      <div>
        <button id="btn-export">导出</button>
        <button id="btn-import">导入</button>
      </div>
    </div>
  `;

  root.querySelector('#btn-trigger')?.addEventListener('click', h.onTrigger);
  root.querySelector('#btn-done')?.addEventListener('click', h.onDone);
  root.querySelector('#btn-fail')?.addEventListener('click', h.onFail);
  root.querySelector('#btn-score')?.addEventListener('click', h.onScore);
  root.querySelector('#btn-export')?.addEventListener('click', h.onExport);
  root.querySelector('#btn-import')?.addEventListener('click', h.onImport);
}

export { fmtTime };
