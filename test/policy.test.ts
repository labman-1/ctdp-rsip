import { describe, expect, it } from 'vitest';
import { policyView, collapseList, canJoin, isLeaf } from '../src/logic/policy';
import type { AppState, ChainEvent } from '../src/types';

let t = 1_700_000_000_000;
const tick = () => (t += 60_000);
const ev = (type: ChainEvent['type'], policyId: string, extra: Partial<ChainEvent> = {}): ChainEvent => ({
  ts: tick(), type, policyId, ...extra,
});

function state(events: ChainEvent[]): AppState {
  return {
    version: 1,
    chains: {},
    policies: {
      P1: { name: '评分', kind: 'semi', requirement: '睡前评分', level: 1, createdAt: t },
      P2: { name: '夜幕降临', kind: 'passive', requirement: '22:00 禁用', level: 2, createdAt: t },
      P3: { name: '周锻炼', kind: 'semi', requirement: '每周≥1 C2 节点', level: 1, createdAt: t },
    },
    events,
  };
}

describe('policyView 树与手牌', () => {
  it('无事件：全部在手牌，树上空', () => {
    const v = policyView(state([]));
    expect(v.hand).toEqual(['P1', 'P2', 'P3']);
    expect(v.roots).toEqual([]);
  });

  it('凭证制上树：join 前须有当日 done', () => {
    const v = policyView(state([
      ev('policy_done', 'P1'),
      ev('policy_join', 'P1', { parent: null }),
    ]), t);
    expect(v.roots).toEqual(['P1']);
    expect(v.hand).not.toContain('P1');
    expect(v.nodes.P1.doneToday).toBe(true);
  });

  it('父子结构：P2 挂 P1 下，children 正确', () => {
    const v = policyView(state([
      ev('policy_done', 'P1'), ev('policy_join', 'P1', { parent: null }),
      ev('policy_done', 'P2'), ev('policy_join', 'P2', { parent: 'P1' }),
    ]));
    expect(v.nodes.P1.children).toEqual(['P2']);
    expect(v.nodes.P2.parent).toBe('P1');
    expect(isLeaf(v, 'P1')).toBe(false);
    expect(isLeaf(v, 'P2')).toBe(true);
  });

  it('堆栈熄灭连坐：fail(P1) 连带 P2、P3 回手牌，父子解除', () => {
    const v = policyView(state([
      ev('policy_done', 'P1'), ev('policy_join', 'P1', { parent: null }),
      ev('policy_done', 'P2'), ev('policy_join', 'P2', { parent: 'P1' }),
      ev('policy_done', 'P3'), ev('policy_join', 'P3', { parent: 'P2' }),
      ev('policy_fail', 'P1', { note: '违例' }),
    ]));
    expect(v.roots).toEqual([]);
    expect(v.hand).toContain('P1');
    expect(v.hand).toContain('P2');
    expect(v.hand).toContain('P3');
    expect(v.nodes.P2.parent).toBeNull();
    expect(collapseList(v, 'P1')).toEqual(['P1']); // 已全灭，无活子孙
  });

  it('collapseList 在活树上给出连坐清单（含自身与子孙）', () => {
    const v = policyView(state([
      ev('policy_done', 'P1'), ev('policy_join', 'P1', { parent: null }),
      ev('policy_done', 'P2'), ev('policy_join', 'P2', { parent: 'P1' }),
      ev('policy_done', 'P3'), ev('policy_join', 'P3', { parent: 'P2' }),
    ]));
    expect(collapseList(v, 'P1')).toEqual(['P1', 'P2', 'P3']);
    expect(collapseList(v, 'P2')).toEqual(['P2', 'P3']);
    expect(collapseList(v, 'P3')).toEqual(['P3']);
  });

  it('部分熄灭：fail(P2) 只连坐 P2/P3，P1 存活', () => {
    const v = policyView(state([
      ev('policy_done', 'P1'), ev('policy_join', 'P1', { parent: null }),
      ev('policy_done', 'P2'), ev('policy_join', 'P2', { parent: 'P1' }),
      ev('policy_fail', 'P2'),
    ]));
    expect(v.roots).toEqual(['P1']);
    expect(v.nodes.P1.children).toEqual([]);
    expect(v.hand).toContain('P2');
  });

  it('内化进度条：天数按自然日去重，且 fail 不清零', () => {
    const day1 = t;
    const v = policyView(state([
      { ts: day1, type: 'policy_done', policyId: 'P1' },
      { ts: day1 + 60_000, type: 'policy_done', policyId: 'P1' }, // 同日重复结算只计 1 天
      { ts: day1 + 26 * 3600e3, type: 'policy_done', policyId: 'P1' }, // 次日
      ev('policy_fail', 'P1'),
    ]));
    expect(v.nodes.P1.daysTotal).toBe(2);
  });

  it('fail 后当日凭证作废，须重新结算才能再上树', () => {
    const v = policyView(state([
      ev('policy_done', 'P1'), ev('policy_fail', 'P1'),
    ]));
    expect(v.nodes.P1.doneToday).toBe(false);
  });
});

describe('canJoin 凭证与配额', () => {
  it('无凭证拒绝，理由明确', () => {
    const s = state([]);
    expect(canJoin(policyView(s), 'P1').reason).toContain('凭证');
  });

  it('有凭证可上；当日配额用尽后第二条被拒', () => {
    const s = state([
      ev('policy_done', 'P1'), ev('policy_join', 'P1', { parent: null }),
      ev('policy_done', 'P2'),
    ]);
    const v = policyView(s, t);
    expect(canJoin(v, 'P1').ok).toBe(false);       // 已在树上
    expect(canJoin(v, 'P2').reason).toContain('配额'); // 每天一个
  });

  it('跨天后配额恢复（派生按自然日计算）', () => {
    const s = state([
      { ts: t - 24 * 3600e3, type: 'policy_done', policyId: 'P1' },
      { ts: t - 24 * 3600e3 + 60_000, type: 'policy_join', policyId: 'P1', parent: null },
      { ts: t, type: 'policy_done', policyId: 'P2' },
    ]);
    const v = policyView(s, t + 60_000);
    expect(v.joinsToday).toBe(0);
    expect(canJoin(v, 'P2').ok).toBe(true);
  });
});

describe('被动国策：存续区间计数（免凭证 + 无日结算）', () => {
  it('免凭证上树：passive 无需当日 done', () => {
    const v = policyView(state([]), t);
    expect(canJoin(v, 'P2').ok).toBe(true);
    expect(v.nodes.P2.daysTotal).toBe(0); // 手牌无存续段
  });

  it('上树当天即第 1 天；3 天后 = 4（含上树日与今日，自动累计）', () => {
    const v = policyView(state([
      { ts: t, type: 'policy_join', policyId: 'P2', parent: null },
    ]), t + 3 * 86400e3);
    expect(v.nodes.P2.daysTotal).toBe(4);
  });

  it('熄灭清算存续段：[join, fail) 含头不含尾，熄灭日不计', () => {
    const v = policyView(state([
      { ts: t, type: 'policy_join', policyId: 'P2', parent: null },
      { ts: t + 3 * 86400e3, type: 'policy_fail', policyId: 'P2' },
    ]), t + 5 * 86400e3);
    expect(v.nodes.P2.daysTotal).toBe(3);
    expect(v.nodes.P2.alive).toBe(false);
  });

  it('多段求和：熄灭后重上，历史存续不清零（revive 不重复清算）', () => {
    const v = policyView(state([
      { ts: t, type: 'policy_join', policyId: 'P2', parent: null },
      { ts: t + 2 * 86400e3, type: 'policy_fail', policyId: 'P2' },    // 段1 = 2 天
      { ts: t + 3 * 86400e3, type: 'policy_revive', policyId: 'P2', parent: null },
    ]), t + 5 * 86400e3);                                               // 段2 = 3 天
    expect(v.nodes.P2.daysTotal).toBe(5);
  });

  it('连坐熄灭时被动子孙同样清算自己的段（以 fail 时刻封盘）', () => {
    const v = policyView(state([
      { ts: t, type: 'policy_done', policyId: 'P1' },
      { ts: t, type: 'policy_join', policyId: 'P1', parent: null },
      { ts: t, type: 'policy_join', policyId: 'P2', parent: 'P1' },
      { ts: t + 2 * 86400e3, type: 'policy_fail', policyId: 'P1' },
    ]), t + 5 * 86400e3);
    expect(v.nodes.P1.alive).toBe(false);
    expect(v.nodes.P2.daysTotal).toBe(2); // 连坐清算 [t, t+2d)
  });

  it('手动结算的 done 对 passive 无效：不被计数、不产生凭证', () => {
    const v = policyView(state([
      { ts: t, type: 'policy_done', policyId: 'P2' },
      { ts: t, type: 'policy_done', policyId: 'P2' },
    ]), t);
    expect(v.nodes.P2.daysTotal).toBe(0);
    expect(v.nodes.P2.doneToday).toBe(false);
  });

  it('日界 4:00：22:00 上树，次日 3:00 仍是第 1 天；4:00 后为第 2 天', () => {
    const join = new Date(2026, 8, 29, 22, 0).getTime();
    const s = state([{ ts: join, type: 'policy_join', policyId: 'P2', parent: null }]);
    expect(policyView(s, new Date(2026, 8, 30, 3, 0).getTime()).nodes.P2.daysTotal).toBe(1);
    expect(policyView(s, new Date(2026, 8, 30, 4, 0).getTime()).nodes.P2.daysTotal).toBe(2);
  });

  it('semi/active 计数模型不变：仍按 done 事件日去重（回归保护）', () => {
    const v = policyView(state([
      { ts: t, type: 'policy_done', policyId: 'P1' },
      { ts: t + 26 * 3600e3, type: 'policy_done', policyId: 'P1' },
    ]), t + 30 * 3600e3);
    expect(v.nodes.P1.daysTotal).toBe(2);
  });
});
