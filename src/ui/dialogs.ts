// 原生 <dialog> 模态：判例裁决（下必为例）与睡前评分（G1）。
// 零依赖、移动端友好、showModal 自带焦点陷阱。

import type { ChainEvent } from '../types';
import { SCORE_ANCHORS } from '../types';

function el(html: string): HTMLDialogElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as HTMLDialogElement;
}

/** 失败裁决弹窗 — 协议核心：疑似违规只允许二选一，不允许"这次算了"。
 *  resolve：fail 事件 / verdict 事件 / null（用户关闭，稍后再裁决） */
export function openVerdictDialog(chainId: string): Promise<ChainEvent | null> {
  return new Promise((resolve) => {
    const dlg = el(`
      <dialog>
        <h3>下必为例 · 裁决</h3>
        <div class="hint">描述本次疑似违规，然后二选一。<br>
        判失败：链条清零，从 #1 重来。<br>
        判允许：写入判例，同类情况从此永久适用。<br>
        <b>不允许"这次先算了"。</b></div>
        <textarea placeholder="发生了什么？例如：专注中刷了约 10 分钟手机"></textarea>
        <div class="dlg-actions">
          <button class="danger" data-act="fail">判失败（链清零）</button>
          <button data-act="verdict">判允许（登记判例，链不断）</button>
          <button class="cancel" data-act="cancel">稍后再裁决</button>
        </div>
      </dialog>`);

    const close = (result: ChainEvent | null) => { dlg.close(); dlg.remove(); resolve(result); };
    const text = () => (dlg.querySelector('textarea') as HTMLTextAreaElement).value.trim();
    const base = () => ({ ts: Date.now(), chain: chainId });

    dlg.querySelector('[data-act="fail"]')?.addEventListener('click', () =>
      close({ ...base(), type: 'fail', note: text() || undefined }));
    dlg.querySelector('[data-act="verdict"]')?.addEventListener('click', () => {
      const t = text();
      if (!t) { (dlg.querySelector('textarea') as HTMLTextAreaElement).focus(); return; }
      close({ ...base(), type: 'verdict', verdictText: t });
    });
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close(null));

    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/** 睡前评分弹窗 — G1 根国策。resolve：score 事件或 null */
export function openScoreDialog(): Promise<ChainEvent | null> {
  return new Promise((resolve) => {
    const dlg = el(`
      <dialog>
        <h3>睡前评分</h3>
        <div class="hint">躺上床后回想今天，打个分。评分本身就是一次复盘。</div>
        <div class="score-grid">
          ${([1, 2, 3, 4, 5] as const).map((n) => `
            <button data-score="${n}">${n}<small>${n === 1 || n === 3 || n === 5 ? SCORE_ANCHORS[n] : ''}</small></button>
          `).join('')}
        </div>
        <textarea placeholder="一句话（建议引用一个事实而非评判）：今天下午打了一个节点"></textarea>
        <div class="dlg-actions">
          <button data-act="ok">记下</button>
          <button class="cancel" data-act="cancel">取消</button>
        </div>
      </dialog>`);

    let picked: 1 | 2 | 3 | 4 | 5 | null = null;
    const close = (result: ChainEvent | null) => { dlg.close(); dlg.remove(); resolve(result); };

    dlg.querySelectorAll<HTMLButtonElement>('[data-score]').forEach((b) => {
      b.addEventListener('click', () => {
        picked = Number(b.dataset.score) as 1 | 2 | 3 | 4 | 5;
        dlg.querySelectorAll('[data-score]').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
      });
    });
    dlg.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      if (picked === null) return;
      const note = (dlg.querySelector('textarea') as HTMLTextAreaElement).value.trim();
      close({ ts: Date.now(), type: 'score', score: picked, note: note || undefined });
    });
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => close(null));

    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/** 导入二次确认（覆盖是破坏性操作） */
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
    dlg.querySelector('[data-act="ok"]')?.addEventListener('click', () => { dlg.close(); dlg.remove(); resolve(true); });
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => { dlg.close(); dlg.remove(); resolve(false); });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}
