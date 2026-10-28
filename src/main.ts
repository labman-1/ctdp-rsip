// 入口（组合根）：加载状态 → 绑定事件 → 全量渲染 → 启动驱动器与 PWA。
// commit() 是唯一的状态变更路径（append 事件 → 落盘 → 重渲染）。

import { load, append, replaceWith, loadUiChain, saveUiChain, addPolicy, updatePolicy, addChain } from './state';
import { bookingState } from './logic/chain';
import { policyView, canJoin, canFreeze, canUnfreeze, baseRequirement } from './logic/policy';
import { canBackfillYesterday, backfillTs } from './logic/score';
import { dayKey } from './logic/day';
import { render } from './ui/render';
import { renderPolicy } from './ui/renderPolicy';
import { openVerdictDialog, openScoreDialog, openScoreLogDialog, openImportConfirm, openNewChainDialog } from './ui/dialogs';
import {
  openNewPolicyDialog, openSettleDialog, openJoinDialog,
  openCollapseConfirm, openPolicyDetail, openUpgradeDialog, openAmendDialog, openEditPolicyDialog,
  openFreezeDialog, openUnfreezeConfirm,
} from './ui/policyDialogs';
import { startClock } from './ui/clock';
import { setupPwa } from './pwa';
import type { ChainEvent } from './types';
import './style.css';

const root = document.getElementById('app') as HTMLElement;
let S = load();
let currentId = loadUiChain('C1');
if (!S.chains[currentId]) currentId = Object.keys(S.chains)[0] ?? 'C1';
let tab: 'chain' | 'policy' = 'chain';

function commit(e: ChainEvent): void {
  S = append(S, e);
  rerender();
}

function rerender(): void {
  if (tab === 'policy') renderPolicy(root, S, policyHandlers, tab);
  else render(root, S, handlers, currentId);
}

function notify(title: string, body: string): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'ctdp-booking' });
    }
  } catch { /* 无授权或环境不支持时静默 */ }
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
    const ids = Object.keys(S.chains).filter((id) => !id.endsWith('预约'));
    if (ids.length < 2) return;
    currentId = ids[(ids.indexOf(currentId) + 1) % ids.length];
    saveUiChain(currentId);
    rerender();
  },
  onNewChain: async () => {
    const name = await openNewChainDialog();
    if (!name) return;
    const r = addChain(S, name);
    S = r.state;
    currentId = r.id; // 建完即切换到新链
    saveUiChain(currentId);
    rerender();
  },
  onTrigger: () => {
    // 预约兑现：窗口内触发主链时，同批提交预约链的 done（原子化双事件）
    const booking = bookingState(S, currentId);
    if (booking.phase === 'booked' || booking.phase === 'due') {
      S = append(
        S,
        { ts: Date.now(), type: 'trigger', chain: currentId },
        { ts: Date.now(), type: 'done', chain: currentId + '预约' },
      );
      rerender();
    } else {
      commit({ ts: Date.now(), type: 'trigger', chain: currentId });
    }
  },
  onBooking: () => {
    // 有上下文的授权时机：用户刚表达"我要预约"（默认态才询问，拒绝过不再骚扰）
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    commit({ ts: Date.now(), type: 'booking', chain: currentId + '预约' });
  },
  onBookingVerdict: async () => {
    const e = await openVerdictDialog(currentId + '预约');
    if (e) commit(e);
  },
  onDone: () => commit({ ts: Date.now(), type: 'done', chain: currentId }),
  onFail: async () => {
    const e = await openVerdictDialog(currentId);
    if (e) commit(e);
  },
  onScout: () => commit({ ts: Date.now(), type: 'scout', chain: currentId }),
  onAmend: async (chainId: string) => {
    if (!chainId) return;
    const e = await openVerdictDialog(chainId, 'amend');
    if (e) commit(e);
  },
  onScore: async () => {
    const e = await openScoreDialog({ canBackfill: canBackfillYesterday(S) });
    if (e) commit(e);
    if (!e) return;
    if (e.backfill) {
      // 补录路径：同步补记评分国策的昨日结算（按名匹配"评分/回响"的唯一非被动国策才询问，不做静默猜测；
      // 只看名不看要求全文——避免"赢麻了"等锚定评分的国策因要求文本含"评分"而误中）
      const target = Object.entries(S.policies).filter(([, d]) =>
        d.kind !== 'passive' && (d.name.includes('评分') || d.name.includes('回响')));
      if (target.length === 1) {
        const yk = dayKey(e.ts);
        const already = S.events.some((x) => x.type === 'policy_done' && x.policyId === target[0][0] && dayKey(x.ts) === yk);
        if (!already && confirm('一并补记昨晚的「睡前评分」国策结算（时间记为昨晚）？')) {
          commit({ ts: e.ts, type: 'policy_done', policyId: target[0][0] });
        }
      }
      return; // 现在是早上，今日结算软引导不适用
    }
    // 评分后的软引导：国策结算了吗（两个睡前仪式合一；passive 免结算，不数）
    if (Object.keys(S.policies).length > 0) {
      const v = policyView(S);
      const unsettled = Object.values(v.nodes).filter((n) => n.alive && !n.doneToday && n.kind !== 'passive' && n.frozenSince == null).length;
      if (unsettled > 0) {
        setTimeout(() => {
          if (confirm(`还有 ${unsettled} 条在树国策今日未结算，现在结算吗？`)) {
            void policyHandlers.onSettle();
          }
        }, 200);
      }
    }
  },
  onExport: exportJson,
  onImport: importJson,
  onScoreLog: () => { void openScoreLogDialog(S); },
  onSwitchTab: (t: 'chain' | 'policy') => { tab = t; rerender(); },
};

const policyHandlers = {
  onSwitchTab: (t: 'chain' | 'policy') => { tab = t; rerender(); },
  onNewPolicy: async () => {
    const def = await openNewPolicyDialog();
    if (def) { S = addPolicy(S, def); rerender(); }
  },
  onSettle: async () => {
    const r = await openSettleDialog(S);
    if (!r) return;
    // 与当前 doneToday 对比：补记新增的 done（不支持撤销当日 done——如实记录）；
    // 补昨晚部分打昨日 23:30（日界归属正确，今日结算位不受影响）；
    // 舱内执行照记 done（计天，与手牌期执行计入原则一致，兼作启封门槛）
    const v = policyView(S);
    const news = [
      ...r.today.filter((id) => !v.nodes[id]?.doneToday),
      ...r.frozen.filter((id) => !v.nodes[id]?.doneToday),
    ];
    const evs = [
      ...news.map((id) => ({ ts: Date.now(), type: 'policy_done' as const, policyId: id })),
      ...r.yesterday.map((id) => ({ ts: backfillTs(Date.now()), type: 'policy_done' as const, policyId: id })),
    ];
    if (evs.length > 0) {
      S = append(S, ...evs);
      rerender();
    }
  },
  onJoin: async (id: string) => {
    if (!id) return;
    const v = policyView(S);
    // 凭证/配额前置：不满足时点按钮直接说明原因（移动端无 hover，disabled 的 title 看不见）
    const joinable = canJoin(v, id);
    if (!joinable.ok) { alert(joinable.reason ?? '当前不可上树'); return; }
    const parent = await openJoinDialog(S, v, id);
    if (parent === undefined) return; // 取消
    const isRevive = v.nodes[id]?.onTreeSince != null; // 曾上过树 → 复活（末梢原则同适用）
    S = append(S, {
      ts: Date.now(),
      type: isRevive ? 'policy_revive' : 'policy_join',
      policyId: id,
      parent,
    });
    rerender();
  },
  onCollapse: async (id: string) => {
    if (!id) return;
    const v = policyView(S);
    const r = await openCollapseConfirm(S, v, id);
    if (!r) return;
    const def = S.policies[id];
    if (!def) return;
    // v1.11 清级：定义恢复 lv.1 文本（有事件记录才自动恢复；无记录提示手动——宁可手动，不可错还原）
    const clearLevel = (): void => {
      const base = baseRequirement(S, id);
      S = append(S, {
        ts: Date.now(), type: 'policy_upgrade', policyId: id, newLevel: 1,
        note: r.kind === 'fail' ? 'v1.11 失败清级回原始版' : 'v1.11 主动熄灭清级',
        requirement: base ?? undefined, prevReq: S.policies[id]?.requirement,
      });
      S = base ? updatePolicy(S, id, { level: 1, requirement: base })
               : updatePolicy(S, id, { level: 1 });
      if (!base) alert('该国策的 lv.1 文本无事件记录（存量数据），等级已清回 lv.1，请在编辑定义中手动调整要求文本。');
    };
    if (r.kind === 'fail' && def.level > 1) {
      clearLevel(); // v1.11：失败确定性清级 · 留在树上
    } else {
      if (def.level > 1) clearLevel(); // 结构性下树（或原始版失败前的清级）+ 熄灭
      S = append(S, { ts: Date.now(), type: 'policy_fail', policyId: id });
    }
    rerender();
  },
  onFreeze: async () => {
    const v = policyView(S);
    const gate = canFreeze(v);
    if (!gate.ok) { alert(gate.reason ?? '当前不可封舱'); return; }
    const r = await openFreezeDialog(S, v);
    if (!r) return;
    const ts = Date.now();
    S = append(S, ...r.ids.map((pid) => ({
      ts, type: 'policy_freeze' as const, policyId: pid, note: r.reason, expectedUntil: r.expectedUntil,
    })));
    rerender();
  },
  onUnfreeze: async (id: string) => {
    const v = policyView(S);
    const gate = canUnfreeze(v, id);
    if (!gate.ok) { alert(gate.reason ?? '当前不可启封'); return; }
    if (await openUnfreezeConfirm(S, v, id)) {
      commit({ ts: Date.now(), type: 'policy_unfreeze', policyId: id });
    }
  },
  onDetail: async (id: string) => {
    if (!id) return;
    const action = await openPolicyDetail(S, id);
    if (action === 'edit') {
      const patch = await openEditPolicyDialog(S, id);
      if (patch) { S = updatePolicy(S, id, patch); rerender(); }
    } else if (action === 'upgrade') {
      const def = S.policies[id];
      if (!def) return;
      const up = await openUpgradeDialog(def.level, def.requirement);
      if (up) {
        // 双快照入事件（等级→条款台账）；定义与等级原子更新
        S = append(S, {
          ts: Date.now(), type: 'policy_upgrade', policyId: id,
          newLevel: def.level + 1, note: up.note, requirement: up.requirement, prevReq: def.requirement,
        });
        S = updatePolicy(S, id, { level: def.level + 1, requirement: up.requirement });
        rerender();
      }
    } else if (action === 'amend') {
      const text = await openAmendDialog();
      if (text) {
        const def = S.policies[id];
        const amendments = [...(def.amendments ?? []), { text, date: Date.now() }];
        S = updatePolicy(S, id, { amendments });
        rerender();
      }
    }
  },
};

rerender();
setupPwa();
startClock({
  getState: () => S,
  getCurrentId: () => currentId,
  rerender,
  notify,
});
