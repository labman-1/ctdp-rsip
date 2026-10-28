import { describe, expect, it } from 'vitest';
import { policyView, collapseList, canJoin, isLeaf, backfillCandidates, unitLabel, canFreeze, canUnfreeze, baseRequirement } from '../src/logic/policy';
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

describe('补昨晚结算候选（backfillCandidates）', () => {
  // 2026-10-21 08:00（窗口内）；昨日 = 10-20
  const morning = new Date(2026, 9, 21, 8, 0).getTime();
  const yDone = (h: number): ChainEvent =>
    ({ ts: new Date(2026, 9, 20, h, 0).getTime(), type: 'policy_done', policyId: 'P1' });

  it('窗口内：昨日无结算 → 全部非被动国策为候选（passive 永不）', () => {
    const ids = backfillCandidates(state([]), morning);
    expect(ids).toContain('P1');
    expect(ids).toContain('P3');
    expect(ids).not.toContain('P2');
  });

  it('昨日已有 done 的国策（含 23:30 补录时刻）不再列入', () => {
    expect(backfillCandidates(state([yDone(23)]), morning)).toEqual(['P3']);
    expect(backfillCandidates(state([yDone(12)]), morning)).toEqual(['P3']);
  });

  it('窗口外（午后/凌晨）不提供候选', () => {
    expect(backfillCandidates(state([]), new Date(2026, 9, 21, 14, 0).getTime())).toEqual([]);
    expect(backfillCandidates(state([]), new Date(2026, 9, 21, 0, 30).getTime())).toEqual([]);
  });

  it('今日的 done 不影响昨日判定（dayKey 隔离）', () => {
    const todayDone: ChainEvent =
      { ts: new Date(2026, 9, 21, 7, 0).getTime(), type: 'policy_done', policyId: 'P1' };
    expect(backfillCandidates(state([todayDone]), morning)).toContain('P1');
  });
});

describe('unitLabel 凭证计量单位（单位属于国策定义，渲染零特例）', () => {
  it('缺省按类型推导：passive/semi=天，active=次', () => {
    expect(unitLabel({ kind: 'passive' })).toBe('天');
    expect(unitLabel({ kind: 'semi' })).toBe('天');
    expect(unitLabel({ kind: 'active' })).toBe('次');
  });

  it('覆写优先：unit 字段胜过类型默认（G1 晚 / G3 节点 / G5 入座天）', () => {
    expect(unitLabel({ kind: 'semi', unit: '晚' })).toBe('晚');
    expect(unitLabel({ kind: 'semi', unit: '节点' })).toBe('节点');
    expect(unitLabel({ kind: 'passive', unit: '入座天' })).toBe('入座天');
  });

  it('空白 unit 视为未设置（编辑清空 = 回到类型默认）', () => {
    expect(unitLabel({ kind: 'active', unit: '   ' })).toBe('次');
  });
});

describe('封舱/启封（水密隔舱系统化）', () => {
  const d = (day: number, h = 10) => new Date(2026, 9, day, h).getTime();
  const mk = (kind: 'passive' | 'semi', events: ChainEvent[]): AppState => ({
    version: 1,
    chains: {},
    policies: { P9: { name: '试验舱', kind, requirement: 'r', level: 1, createdAt: 1 } },
    events,
  });

  it('passive 封舱期间存续停计，启封日重开新段（恢复当日即在岗）', () => {
    const s = mk('passive', [
      { ts: d(1), type: 'policy_join', policyId: 'P9', parent: null },
      { ts: d(4), type: 'policy_freeze', policyId: 'P9', note: '手术', expectedUntil: d(30) },
      { ts: d(14), type: 'policy_unfreeze', policyId: 'P9' },
    ]);
    const v = policyView(s, d(20));
    expect(v.nodes.P9.daysTotal).toBe(10); // [1,4) 含头不含尾=3 + [14,20] 含头含尾=7
    expect(v.nodes.P9.frozenSince).toBeNull();
    expect(v.nodes.P9.alive).toBe(true);
  });

  it('全局单舱：舱未清空前不可再封，全部启封后恢复可封', () => {
    // 视图从全部事件派生（事件恒为当下时间戳，无未来事件）——"舱中"与"已清舱"用两个状态分别构造
    const inFreeze = mk('semi', [
      { ts: d(1), type: 'policy_join', policyId: 'P9', parent: null },
      { ts: d(2), type: 'policy_freeze', policyId: 'P9', note: '病' },
      { ts: d(5, 21), type: 'policy_done', policyId: 'P9' },
    ]);
    expect(canFreeze(policyView(inFreeze, d(5, 22))).ok).toBe(false);
    const cleared = { ...inFreeze, events: [...inFreeze.events, { ts: d(6), type: 'policy_unfreeze', policyId: 'P9' } as ChainEvent] };
    expect(canFreeze(policyView(cleared, d(6, 22))).ok).toBe(true);
  });

  it('启封门槛逐条判定：semi 需当日执行凭证，passive 直接可启', () => {
    const s = mk('semi', [
      { ts: d(1), type: 'policy_join', policyId: 'P9', parent: null },
      { ts: d(2), type: 'policy_freeze', policyId: 'P9', note: '病' },
    ]);
    expect(canUnfreeze(policyView(s, d(5, 22)), 'P9').ok).toBe(false);
    const s2: AppState = { ...s, events: [...s.events, { ts: d(5, 21), type: 'policy_done', policyId: 'P9' }] };
    expect(canUnfreeze(policyView(s2, d(5, 22)), 'P9').ok).toBe(true);

    const sp = mk('passive', [
      { ts: d(1), type: 'policy_join', policyId: 'P9', parent: null },
      { ts: d(2), type: 'policy_freeze', policyId: 'P9', note: '病' },
    ]);
    expect(canUnfreeze(policyView(sp, d(5)), 'P9').ok).toBe(true);
  });

  it('舱内国策不入补昨晚候选；预期期限逾期进 freezeOverdue', () => {
    const s = mk('semi', [
      { ts: d(1), type: 'policy_join', policyId: 'P9', parent: null },
      { ts: d(19), type: 'policy_freeze', policyId: 'P9', note: '病', expectedUntil: d(20) },
    ]);
    const v = policyView(s, d(21, 8));
    expect(v.freezeOverdue).toContain('P9');
    expect(backfillCandidates(s, d(21, 8))).not.toContain('P9');
  });

  it('舱内执行照记 done 计天（启封凭证与内化天数一体）', () => {
    const s = mk('semi', [
      { ts: d(1), type: 'policy_join', policyId: 'P9', parent: null },
      { ts: d(2), type: 'policy_freeze', policyId: 'P9', note: '病' },
      { ts: d(5, 21), type: 'policy_done', policyId: 'P9' },
    ]);
    const v = policyView(s, d(5, 22));
    expect(v.nodes.P9.daysTotal).toBe(1);
    expect(v.nodes.P9.doneToday).toBe(true);
  });
});

describe('baseRequirement 原始版文本追溯（v1.11 清级恢复依据）', () => {
  const d = (day: number) => new Date(2026, 9, day, 10).getTime();
  const mk = (events: ChainEvent[]): AppState => ({
    version: 1,
    chains: {},
    policies: { P8: { name: '试验', kind: 'semi', requirement: 'r', level: 1, createdAt: 1 } },
    events,
  });

  it('首个升级事件（lv.1→lv.2）带改前快照 → 该快照即原始版文本', () => {
    const s = mk([
      { ts: d(1), type: 'policy_join', policyId: 'P8', parent: null },
      { ts: d(5), type: 'policy_upgrade', policyId: 'P8', newLevel: 2, note: '数日', requirement: '9h', prevReq: '10h' },
      { ts: d(10), type: 'policy_upgrade', policyId: 'P8', newLevel: 3, note: '在岗21天', requirement: '8h', prevReq: '9h' },
    ]);
    expect(baseRequirement(s, 'P8')).toBe('10h');
  });

  it('存量升级事件无快照 → null（首事件非 lv.1→lv.2 或缺 prevReq 均不可信，清级提示手动）', () => {
    const s = mk([
      { ts: d(1), type: 'policy_join', policyId: 'P8', parent: null },
      { ts: d(5), type: 'policy_upgrade', policyId: 'P8', newLevel: 2, note: '数日' },
      { ts: d(10), type: 'policy_upgrade', policyId: 'P8', newLevel: 3, note: '在岗', requirement: '8h', prevReq: '9h' },
    ]);
    expect(baseRequirement(s, 'P8')).toBeNull();
  });

  it('无升级历史 → null', () => {
    const s = mk([{ ts: d(1), type: 'policy_join', policyId: 'P8', parent: null }]);
    expect(baseRequirement(s, 'P8')).toBeNull();
  });
});
