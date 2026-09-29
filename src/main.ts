// 入口（组合根）：加载状态 → 绑定事件 → 全量渲染 → 启动驱动器与 PWA。
// commit() 是唯一的状态变更路径（append 事件 → 落盘 → 重渲染）。

import { load, append, replaceWith, loadUiChain, saveUiChain, addPolicy, updatePolicy } from './state';
import { bookingState } from './logic/chain';
import { policyView, canJoin } from './logic/policy';
import { render } from './ui/render';
import { renderPolicy } from './ui/renderPolicy';
import { openVerdictDialog, openScoreDialog, openScoreLogDialog, openImportConfirm } from './ui/dialogs';
import {
  openNewPolicyDialog, openSettleDialog, openJoinDialog,
  openCollapseConfirm, openPolicyDetail, openUpgradeDialog, openAmendDialog, openEditPolicyDialog,
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
  onAmend: async (chainId: string) => {
    if (!chainId) return;
    const e = await openVerdictDialog(chainId, 'amend');
    if (e) commit(e);
  },
  onScore: async () => {
    const e = await openScoreDialog();
    if (e) commit(e);
    // 评分后的软引导：国策结算了吗（两个睡前仪式合一）
    if (e && Object.keys(S.policies).length > 0) {
      const v = policyView(S);
      const unsettled = Object.values(v.nodes).filter((n) => n.alive && !n.doneToday).length;
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
    const ids = await openSettleDialog(S);
    if (!ids) return;
    // 与当前 doneToday 对比：补记新增的 done（不支持撤销当日 done——如实记录）
    const v = policyView(S);
    const news = ids.filter((id) => !v.nodes[id]?.doneToday);
    if (news.length > 0) {
      const doneEvents: ChainEvent[] = news.map((id) => ({ ts: Date.now(), type: 'policy_done' as const, policyId: id }));
      S = append(S, ...doneEvents);
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
    if (await openCollapseConfirm(S, v, id)) {
      S = append(S, { ts: Date.now(), type: 'policy_fail', policyId: id });
      rerender();
    }
  },
  onDetail: async (id: string) => {
    if (!id) return;
    const action = await openPolicyDetail(S, id);
    if (action === 'edit') {
      const patch = await openEditPolicyDialog(S, id);
      if (patch) { S = updatePolicy(S, id, patch); rerender(); }
    } else if (action === 'upgrade') {
      const cur = S.policies[id]?.level ?? 1;
      const up = await openUpgradeDialog(cur);
      if (up) {
        S = append(S, { ts: Date.now(), type: 'policy_upgrade', policyId: id, newLevel: up.level, note: up.note });
        S = updatePolicy(S, id, { level: up.level });
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
