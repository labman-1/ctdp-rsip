// 原生 <dialog> 模态：判例裁决（下必为例）与睡前评分（G1）。
// 零依赖、移动端友好、showModal 自带焦点陷阱。
// 所有弹窗统一生命周期：按钮路径与 Esc/外部关闭路径都经 settled 防重入收口。

import type { AppState, ChainEvent } from '../types';
import { SCORE_ANCHORS, scoreHistory, backfillTs } from '../logic/score';
import { computeChain, bookingState } from '../logic/chain';
import { wireLifecycle } from './lifecycle';
import { fmtTime } from './render';

function el(html: string): HTMLDialogElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as HTMLDialogElement;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 裁决弹窗 — 协议核心：疑似违规只允许二选一，不允许"这次算了"。
 *  mode='amend' 为补判（结算后追加裁决），其余为当庭裁决。
 *  resolve：fail 事件 / verdict 事件 / null（用户关闭，稍后再裁决） */
export function openVerdictDialog(chainId: string, mode: 'now' | 'amend' = 'now'): Promise<ChainEvent | null> {
  return new Promise((resolve) => {
    const amend = mode === 'amend';
    const dlg = el(`
      <dialog>
        <h3>下必为例 · ${amend ? '补判' : '裁决'}</h3>
        <div class="hint">${amend ? '结算后发现问题，向该链<b>追加</b>一条裁决事件，链状态自动更正，历史不变。<br>' : ''}描述本次疑似违规，然后二选一。<br>
        判失败：链条清零，从 #1 重来。<br>
        判允许：写入判例，同类情况从此永久适用。<br>
        <b>不允许"这次先算了"。</b></div>
        <textarea placeholder="发生了什么？例如：专注中刷了约 10 分钟手机"></textarea>
        <div class="dlg-actions">
          <button class="danger" data-act="fail">判失败（链清零）</button>
          <button data-act="verdict">判允许（登记判例，链不断）</button>
          <button class="cancel" data-act="cancel">${amend ? '不改了' : '稍后再裁决'}</button>
        </div>
      </dialog>`);

    const finish = wireLifecycle(dlg, resolve);
    const text = () => (dlg.querySelector('textarea') as HTMLTextAreaElement).value.trim();
    const base = () => ({ ts: Date.now(), chain: chainId });

    dlg.querySelector('[data-act="fail"]')?.addEventListener('click', () =>
      finish({ ...base(), type: 'fail', note: text() || undefined }));
    dlg.querySelector('[data-act="verdict"]')?.addEventListener('click', () => {
      const t = text();
      if (!t) { (dlg.querySelector('textarea') as HTMLTextAreaElement).focus(); return; }
      finish({ ...base(), type: 'verdict', verdictText: t });
    });
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(null));

    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/** 睡前评分弹窗 — G1 根国策。0-10 分制，0.5 步进（滑块）。
 *  canBackfill：补录窗口开且昨晚未评时，提供"补昨晚"开关（时间记为昨晚 23:30，带补录标记）。
 *  showWin：存在"赢麻了"国策时显示喜报区（定级即由调用方自动记该国策执行——supplyBy:'score' 落地）。
 *  resolve：score 事件或 null */
export function openScoreDialog(opts: { canBackfill?: boolean; showWin?: boolean } = {}): Promise<ChainEvent | null> {
  const bf = opts.canBackfill === true;
  const win = opts.showWin === true;
  return new Promise((resolve) => {
    const dlg = el(`
      <dialog>
        <h3>睡前评分${bf ? ' · 可补昨晚' : ''}</h3>
        <div class="hint">躺上床后回想今天。0–10 分，0.5 步进：${Object.entries(SCORE_ANCHORS).map(([k, v]) => `${k} ${v}`).join(' / ')}。评分本身就是一次复盘。</div>
        ${bf ? `<label class="bf-check"><input type="checkbox" id="bf-check" /><span>补昨晚（昨晚忘评：按昨晚的草稿打分，时间记为昨晚 23:30）</span></label>` : ''}
        <div class="score-slider">
          <div class="score-value" id="score-value">5.0</div>
          <input type="range" id="score-input" min="0" max="10" step="0.5" value="5" />
          <div class="score-marks"><span>0</span><span>2</span><span>5</span><span>8</span><span>10</span></div>
        </div>
        <textarea placeholder="一句话（建议引用一个事实而非评判）：今天下午打了一个节点"></textarea>
        ${win ? `
        <div class="settle-bf">
          <div class="bf-hint">赢麻了 · 今日最大喜报（定级即自动记执行，无喜报选"平"）</div>
          <input id="win-name" placeholder="喜报名（可选，如：搞定高数第三章）" maxlength="40" />
          <select id="win-tier">
            <option value="">— 跳过（漏=漏，不算失败）—</option>
            <option value="平">平（无喜报）</option>
            <option value="小赢">小赢</option>
            <option value="中赢">中赢</option>
            <option value="大赢">大赢</option>
          </select>
        </div>` : ''}
        <div class="dlg-actions">
          <button data-act="ok">记下</button>
          <button class="cancel" data-act="cancel">取消</button>
        </div>
      </dialog>`);

    const finish = wireLifecycle(dlg, resolve);
    const slider = () => dlg.querySelector('#score-input') as HTMLInputElement;
    const valueEl = () => dlg.querySelector('#score-value') as HTMLElement;
    let picked = 5;

    dlg.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const note = (dlg.querySelector('textarea') as HTMLTextAreaElement).value.trim();
      const isBf = bf && (dlg.querySelector('#bf-check') as HTMLInputElement | null)?.checked === true;
      const winName = win ? (dlg.querySelector('#win-name') as HTMLInputElement).value.trim() : '';
      const winTier = win ? (dlg.querySelector('#win-tier') as HTMLSelectElement).value : '';
      const winFields = { winName: winName || undefined, winTier: winTier || undefined };
      finish(isBf
        ? { ts: backfillTs(Date.now()), type: 'score', score: picked, scale: 10, note: note || undefined, backfill: true, ...winFields }
        : { ts: Date.now(), type: 'score', score: picked, scale: 10, note: note || undefined, ...winFields });
    });
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(null));

    document.body.appendChild(dlg);
    dlg.showModal();
    requestAnimationFrame(() => {
      slider().addEventListener('input', () => {
        picked = Number(slider().value);
        valueEl().textContent = picked.toFixed(1);
      });
    });
  });
}

/** 评分日志（只读回看）：日期时间 + 分数 + 一句话。旧 5 分制已按语义映射显示 */
export function openScoreLogDialog(s: AppState): Promise<void> {
  return new Promise((resolve) => {
    const hist = [...scoreHistory(s)].reverse(); // 最新在上
    const rows = hist.length === 0
      ? '<div class="empty">（还没有评分记录）</div>'
      : hist.map((e) =>
          `<div class="row"><span class="t">${fmtTime(e.ts)}</span><span>${e.backfill ? '<span class="bfmark" title="次日补录（回忆分）">补</span> ' : ''}<b>${e.score.toFixed(1)}</b>${e.note ? ` · ${esc(e.note)}` : ''}${e.winTier ? ` · 赢麻了${e.winName ? `「${esc(e.winName)}」` : ''}（${esc(e.winTier)}）` : ''}</span></div>`).join('');
    const dlg = el(`
      <dialog>
        <h3>评分日志</h3>
        <div class="hint">${Object.entries(SCORE_ANCHORS).map(([k, v]) => `${k} ${v}`).join(' / ')}<br>同日多次取最后一次；凌晨 4:00 前的评分算前一天。</div>
        <div class="itemlist">${rows}</div>
        <div class="dlg-actions">
          <button class="cancel" data-act="cancel">关闭</button>
        </div>
      </dialog>`);

    const finish = wireLifecycle<void>(dlg, resolve);
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish());
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/** 链选择器：点顶栏链名弹出（替代盲轮转——4 条链起恒定两击到达 + 全局可见）。
 *  行 = C 编号 + 链名 + 链长徽标 + 状态（● 专注中 / ◔ 预约中）；当前链高亮；预约链不进列表。
 *  resolve：选中的链 id，或 undefined（取消） */
export function openChainPicker(s: AppState, currentId: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const ids = Object.keys(s.chains).filter((id) => !id.endsWith('预约'));
    const rows = ids.map((id) => {
      const v = computeChain(s, id);
      const name = s.chains[id]?.name ?? id;
      const st = v?.activeSince ? '<span class="pick-st">● 专注中</span>'
        : (['booked', 'due'].includes(bookingState(s, id).phase) ? '<span class="pick-st">◔ 预约中</span>' : '');
      const cur = id === currentId;
      return `<button class="pick-row${cur ? ' pick-cur' : ''}" data-id="${id}">
        <span class="pick-id">${id}</span>
        <span class="pick-name">${esc(name)}</span>
        <span class="pick-len">${v?.length ?? 0}</span>
        ${st}
      </button>`;
    }).join('');
    const dlg = el(`
      <dialog>
        <h3>切换链</h3>
        <div class="hint">链按行为类型分，各自计数互不连坐。</div>
        <div class="pick-list">${rows}</div>
        <div class="dlg-actions">
          <button class="cancel" data-act="cancel">取消</button>
        </div>
      </dialog>`);

    const finish = wireLifecycle<string | undefined>(dlg, resolve);
    dlg.querySelectorAll<HTMLButtonElement>('.pick-row').forEach((b) =>
      b.addEventListener('click', () => finish(b.dataset.id)));
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(undefined));
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/** 新建链（命名弹窗）。resolve：链名或 null */export function openNewChainDialog(): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = el(`
      <dialog>
        <h3>新建链</h3>
        <div class="hint">链按行为类型分（如：算法输出 / 课程工程 / 锻炼）。链 id 自动分配，各自计数互不连坐。</div>
        <div class="form">
          <input id="nc-name" placeholder="链名（如：课程工程作业）" maxlength="30" />
        </div>
        <div class="dlg-actions">
          <button data-act="ok">建立</button>
          <button class="cancel" data-act="cancel">取消</button>
        </div>
      </dialog>`);

    const finish = wireLifecycle<string | null>(dlg, resolve);
    dlg.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const name = (dlg.querySelector('#nc-name') as HTMLInputElement).value.trim();
      if (name) finish(name);
    });
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(null));
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/** 导入二次确认（覆盖是破坏性操作）。resolve：true=替换 / false=取消（含 Esc） */
export function openImportConfirm(count: number): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = el(`
      <dialog>
        <h3>导入备份</h3>
        <div class="hint">将用备份文件（${count} 条事件）<b>整体替换</b>当前全部数据，此操作不可撤销。继续？</div>
        <div class="dlg-actions">
          <button data-act="ok">替换</button>
          <button class="cancel" data-act="cancel">取消</button>
        </div>
      </dialog>`);
    let settled = false;
    const done = (v: boolean) => { if (settled) return; settled = true; dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('close', () => done(false));
    dlg.querySelector('[data-act="ok"]')?.addEventListener('click', () => done(true));
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => done(false));
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}
