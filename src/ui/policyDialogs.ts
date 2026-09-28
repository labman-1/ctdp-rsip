// 国策相关弹窗族：新建/结算/上树选父/熄灭确认/详情/升级/修正。
// 统一走 wireLifecycle（Esc 兜底，见 dialogs.ts）。

import type { AppState, PolicyDef, PolicyKind } from '../types';
import { policyView, collapseList, isLeaf, type PolicyView } from '../logic/policy';
import { wireLifecycle } from './lifecycle';

function el(html: string): HTMLDialogElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as HTMLDialogElement;
}

function show(dlg: HTMLDialogElement): void {
  document.body.appendChild(dlg);
  dlg.showModal();
}

/** 新建国策（入手牌）。resolve：定义草稿或 null */
export function openNewPolicyDialog(): Promise<Omit<PolicyDef, 'createdAt'> | null> {
  return new Promise((resolve) => {
    const dlg = el(`
      <dialog>
        <h3>新建国策（入手牌）</h3>
        <div class="hint">三道筛自查：是被动/半被动吗？最摆烂的一天能活吗？判定标准一句话说得清吗？</div>
        <div class="form">
          <input id="np-name" placeholder="名称（如：夜幕降临）" maxlength="30" />
          <select id="np-kind">
            <option value="passive">被动型（系统/环境自动执行，想失败都难）</option>
            <option value="semi" selected>半被动型（锚定必然事件，如"躺上床后…"）</option>
            <option value="active">主动型（to-do 式，慎用）</option>
          </select>
          <textarea id="np-req" placeholder="要求全文（判定标准一句话说清）"></textarea>
          <input id="np-brief" placeholder="卡片要点（可选，列表显示）" maxlength="60" />
          <textarea id="np-detail" placeholder="详情装饰（可选：注脚/emoji/图片URL——只存 URL 不存图片本体）"></textarea>
        </div>
        <div class="dlg-actions">
          <button data-act="ok">入手牌</button>
          <button class="cancel" data-act="cancel">取消</button>
        </div>
      </dialog>`);

    const finish = wireLifecycle<Omit<PolicyDef, 'createdAt'> | null>(dlg, resolve);
    const val = (sel: string) => (dlg.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;

    dlg.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const name = val('#np-name').trim();
      const requirement = val('#np-req').trim();
      if (!name || !requirement) return;
      finish({
        name,
        kind: val('#np-kind') as PolicyKind,
        requirement,
        level: 1,
        brief: val('#np-brief').trim() || undefined,
        detail: val('#np-detail').trim() || undefined,
      });
    });
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(null));
    show(dlg);
  });
}

/** 今日结算：列出全部国策勾选"今天做到了"。resolve：要记 done 的 id 数组 */
export function openSettleDialog(s: AppState): Promise<string[] | null> {
  return new Promise((resolve) => {
    const v = policyView(s);
    const ids = Object.keys(s.policies);
    const rows = ids.map((id) => {
      const def = s.policies[id];
      const n = v.nodes[id];
      return `<label class="settle-row">
        <input type="checkbox" data-id="${id}" ${n?.doneToday ? 'checked' : ''} />
        <span>${esc2(def.name)}${n?.alive ? '' : '（手牌）'} · ${n?.daysTotal ?? 0}天</span>
      </label>`;
    }).join('');
    const dlg = el(`
      <dialog>
        <h3>今日结算（睡前巡逻）</h3>
        <div class="hint">勾选今天做到了的国策。手牌期的执行同样计入内化天数。</div>
        <div class="settle-list">${rows || '<div class="empty">（还没有国策）</div>'}</div>
        <div class="dlg-actions">
          <button data-act="ok">记下</button>
          <button class="cancel" data-act="cancel">取消</button>
        </div>
      </dialog>`);

    const finish = wireLifecycle<string[] | null>(dlg, resolve);
    dlg.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const checked = Array.from(dlg.querySelectorAll<HTMLInputElement>('input[data-id]:checked'))
        .map((c) => c.dataset.id as string);
      finish(checked);
    });
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(null));
    show(dlg);
  });
}

/** 上树选父：只能挂当前叶子（末梢原则）或独立根。resolve：parent id 或 null（独立根） */
export function openJoinDialog(s: AppState, v: PolicyView, id: string): Promise<string | null | undefined> {
  return new Promise((resolve) => {
    // 候选父 = 全部活树叶子 + "独立根"。注意 id 自身不在树上（canJoin 已保证）
    const leaves = Object.values(v.nodes).filter((n) => n.alive && n.id !== id && isLeaf(v, n.id));
    const options = [
      `<label class="settle-row"><input type="radio" name="parent" value="" checked /><span>独立根</span></label>`,
      ...leaves.map((n) =>
        `<label class="settle-row"><input type="radio" name="parent" value="${n.id}" /><span>挂在 ${esc2(s.policies[n.id]?.name ?? n.id)} 之下（末梢）</span></label>`),
    ].join('');
    const dlg = el(`
      <dialog>
        <h3>上树 · ${esc2(s.policies[id]?.name ?? id)}</h3>
        <div class="hint">末梢原则：只能挂当前叶子之下或独立根（重上不从原位，从底层重来）。</div>
        <div class="settle-list">${options}</div>
        <div class="dlg-actions">
          <button data-act="ok">上树</button>
          <button class="cancel" data-act="cancel">取消</button>
        </div>
      </dialog>`);

    const finish = wireLifecycle<string | null | undefined>(dlg, resolve);
    dlg.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const sel = dlg.querySelector<HTMLInputElement>('input[name="parent"]:checked');
      finish(sel?.value === '' ? null : sel?.value);
    });
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(undefined));
    show(dlg);
  });
}

/** 熄灭确认：显示连坐清单（威慑可视化）。resolve：true=确认熄灭 */
export function openCollapseConfirm(s: AppState, v: PolicyView, id: string): Promise<boolean> {
  return new Promise((resolve) => {
    const list = collapseList(v, id);
    const names = list.map((pid) => `【${s.policies[pid]?.name ?? pid}】`).join('、');
    const dlg = el(`
      <dialog>
        <h3>堆栈熄灭 · 确认</h3>
        <div class="hint">将同时熄灭：${esc2(names)}${list.length > 1 ? '<br><b>子孙连坐，瞬间损失多日积累。</b>' : ''}<br>
        熄灭 = 回手牌（内化天数保留），重新上树只能从末梢。也可先裁决：这次违例是否其实"判允许"（记判例，不熄灭）？</div>
        <div class="dlg-actions">
          <button class="danger" data-act="ok">确认熄灭（${list.length} 个节点）</button>
          <button class="cancel" data-act="cancel">再想想</button>
        </div>
      </dialog>`);

    const finish = wireLifecycle<boolean>(dlg, resolve);
    dlg.querySelector('[data-act="ok"]')?.addEventListener('click', () => finish(true));
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(false));
    show(dlg);
  });
}

/** 详情弹窗。resolve：用户请求的后续动作（升级/加修正），由 main 继续开对应弹窗 */
export function openPolicyDetail(s: AppState, id: string): Promise<'upgrade' | 'amend' | null> {
  return new Promise((resolve) => {
    const def = s.policies[id];
    if (!def) return resolve(null);
    const v = policyView(s);
    const n = v.nodes[id];
    const upgrades = s.events
      .filter((e) => e.type === 'policy_upgrade' && e.policyId === id)
      .map((e) => `<div class="row"><span class="t">${new Date(e.ts).toLocaleDateString()}</span><span>→ lv.${e.newLevel}${e.note ? ` · ${esc2(e.note)}` : ''}</span></div>`)
      .join('');
    const amends = (def.amendments ?? [])
      .map((a) => `<div class="row"><span class="t">${new Date(a.date).toLocaleDateString()}</span><span>${esc2(a.text)}</span></div>`)
      .join('');
    const kindLabel: Record<string, string> = { passive: '被动型', semi: '半被动型', active: '主动型' };

    const dlg = el(`
      <dialog>
        <h3>${esc2(def.name)} · lv.${def.level}</h3>
        <div class="hint">${kindLabel[def.kind]} · ${n?.daysTotal ?? 0} 天 · ${n?.alive ? (n.parent ? '树上（有父）' : '树上（独立根）') : '手牌'} · 建于 ${new Date(def.createdAt).toLocaleDateString()}</div>
        <div class="detail-block"><b>要求</b><br>${esc2(def.requirement)}</div>
        ${def.detail ? `<div class="detail-block detail-deco">${renderDetail(def.detail)}</div>` : ''}
        ${amends ? `<div class="detail-block"><b>修正条款</b>（判例提炼，仅显示修正）<br>${amends}</div>` : ''}
        ${upgrades ? `<div class="detail-block"><b>升级史</b><br>${upgrades}</div>` : ''}
        <div class="dlg-actions">
          <button data-act="upgrade">升级 lv</button>
          <button data-act="amend">追加修正条款</button>
          <button class="cancel" data-act="cancel">关闭</button>
        </div>
      </dialog>`);

    const finish = wireLifecycle<'upgrade' | 'amend' | null>(dlg, resolve);
    dlg.querySelector('[data-act="upgrade"]')?.addEventListener('click', () => finish('upgrade'));
    dlg.querySelector('[data-act="amend"]')?.addEventListener('click', () => finish('amend'));
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(null));
    show(dlg);
  });
}

/** 升级。resolve：{level, note} 或 null */
export function openUpgradeDialog(curLevel: number): Promise<{ level: number; note?: string } | null> {
  return new Promise((resolve) => {
    const dlg = el(`
      <dialog>
        <h3>升级（lv.${curLevel} → ?）</h3>
        <div class="hint">可升级国策：升级凭证据不凭雄心（如"数日实践成功"）。支持降级（失败回退，不算熄灭）。</div>
        <div class="form">
          <input id="up-level" type="number" min="1" max="9" value="${curLevel + 1}" />
          <textarea id="up-note" placeholder="依据（可选）：如 lv.1 连续 7 天无违例"></textarea>
        </div>
        <div class="dlg-actions">
          <button data-act="ok">记下</button>
          <button class="cancel" data-act="cancel">取消</button>
        </div>
      </dialog>`);

    const finish = wireLifecycle<{ level: number; note?: string } | null>(dlg, resolve);
    dlg.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const level = Number((dlg.querySelector('#up-level') as HTMLInputElement).value);
      if (!Number.isFinite(level) || level < 1) return;
      const note = (dlg.querySelector('#up-note') as HTMLTextAreaElement).value.trim();
      finish({ level, note: note || undefined });
    });
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(null));
    show(dlg);
  });
}

/** 追加修正条款。resolve：条款文本或 null */
export function openAmendDialog(): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = el(`
      <dialog>
        <h3>追加修正条款</h3>
        <div class="hint">判例的成文法化：只写修正后的规则，不写判例原文——但每条修正背后必须对应一个真实裁决。</div>
        <textarea id="am-text" placeholder="如：23:00 后接工作电话属允许（永久）"></textarea>
        <div class="dlg-actions">
          <button data-act="ok">记下</button>
          <button class="cancel" data-act="cancel">取消</button>
        </div>
      </dialog>`);

    const finish = wireLifecycle<string | null>(dlg, resolve);
    dlg.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      const text = (dlg.querySelector('#am-text') as HTMLTextAreaElement).value.trim();
      if (text) finish(text);
    });
    dlg.querySelector('[data-act="cancel"]')?.addEventListener('click', () => finish(null));
    show(dlg);
  });
}

// ── 工具 ──
function esc2(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 装饰字段的安全渲染：图片 URL 转 <img>，其余转义后保留换行 */
function renderDetail(text: string): string {
  return esc2(text)
    .replace(/(https?:\/\/\S+\.(png|jpe?g|gif|webp))/gi, '<img src="$1" alt="" loading="lazy" />')
    .replace(/\n/g, '<br>');
}
