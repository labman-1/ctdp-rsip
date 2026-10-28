import { describe, expect, it } from 'vitest';
import { todayScore, averageLast7, dayKey, legacyTo10, backfillWindowOpen, canBackfillYesterday, backfillTs } from '../src/logic/score';
import type { AppState, ChainEvent } from '../src/types';

let t = 1_700_000_000_000;
const tick = () => (t += 60_000);
const ev = (score: number, extra: Partial<ChainEvent> = {}): ChainEvent => ({
  ts: tick(), type: 'score', score, ...extra,
});

function state(...events: ChainEvent[]): AppState {
  return { version: 1, policies: {}, chains: {}, events };
}

describe('legacyTo10 锚点语义映射（旧 5 分制 → 新 10 分制）', () => {
  it('旧锚点 1/3/5 分别映射到 2/5/8（后悔/平静/满足语义不变）', () => {
    expect(legacyTo10(1)).toBe(2);
    expect(legacyTo10(3)).toBe(5);
    expect(legacyTo10(5)).toBe(8);
  });

  it('中间值线性插值且对齐 0.5 步进', () => {
    expect(legacyTo10(2)).toBe(3.5);
    expect(legacyTo10(4)).toBe(6.5);
  });
});

describe('score 派生（0-10 分制视图）', () => {
  it('空历史：todayScore 与 average 均为 null', () => {
    expect(todayScore(state())).toBeNull();
    expect(averageLast7(state())).toBeNull();
  });

  it('新事件（scale:10）原样进入视图', () => {
    const s = state(ev(6.5, { scale: 10, note: '平静：下午打了一个节点' }));
    const today = todayScore(s, t);
    expect(today?.score).toBe(6.5);
    expect(today?.note).toBe('平静：下午打了一个节点');
  });

  it('旧事件（无 scale）按语义映射：旧 3 分显示为 5.0', () => {
    const s = state(ev(3));
    expect(todayScore(s, t)?.score).toBe(5);
  });

  it('同日多次评分取最后一次', () => {
    const s = state(ev(5, { scale: 10 }), ev(8.5, { scale: 10, note: '晚上补了个节点' }));
    expect(todayScore(s, t)?.score).toBe(8.5);
  });

  it('averageLast7 混合新旧分制：映射后统一计算', () => {
    const now = t;
    const s: AppState = {
      version: 1, policies: {}, chains: {},
      events: [
        { ts: now - 3 * 24 * 3600 * 1000, type: 'score', score: 3 },            // 旧 → 5
        { ts: now - 1 * 24 * 3600 * 1000, type: 'score', score: 7.5, scale: 10 }, // 新 7.5
        { ts: now - 20 * 24 * 3600 * 1000, type: 'score', score: 1 },           // 窗口外
      ],
    };
    expect(averageLast7(s, now)).toBeCloseTo(6.25);
  });

  it('averageLast7 同日修正：该日以最后一次为准（与 todayScore 同语义，旧分不计入均分）', () => {
    const now = t;
    const s: AppState = {
      version: 1, policies: {}, chains: {},
      events: [
        { ts: now - 2 * 24 * 3600 * 1000, type: 'score', score: 4, scale: 10 },
        { ts: now - 2 * 24 * 3600 * 1000 + 60000, type: 'score', score: 8, scale: 10 }, // 同日修正 4→8
        { ts: now - 1 * 24 * 3600 * 1000, type: 'score', score: 6, scale: 10 },
      ],
    };
    expect(averageLast7(s, now)).toBeCloseTo(7); // (8+6)/2，而非 (4+8+6)/3
  });

  it('dayKey 以凌晨 4:00 为日界（二游式刷新）', () => {
    expect(dayKey(new Date(2026, 8, 16, 23, 30).getTime())).toBe('2026-09-16'); // 深夜仍算当天
    expect(dayKey(new Date(2026, 8, 17, 0, 30).getTime())).toBe('2026-09-16');  // 过了午夜但未过 4 点 → 前一天
    expect(dayKey(new Date(2026, 8, 17, 3, 59).getTime())).toBe('2026-09-16');  // 4 点前最后一秒
    expect(dayKey(new Date(2026, 8, 17, 4, 0).getTime())).toBe('2026-09-17');   // 4 点整 → 新的一天
  });
});

describe('补昨晚（backfill）— 漏评补救的后半段', () => {
  // 10-21 是周三；窗口看的是本地时钟 4:00–12:00
  const at = (h: number, m = 0) => new Date(2026, 9, 21, h, m).getTime();

  it('窗口 = 今日 4:00–12:00：0:30 关、3:59 关、4:00 开、11:59 开、12:00 整关', () => {
    expect(backfillWindowOpen(at(0, 30))).toBe(false); // 凌晨未过日界，此刻该去睡或当场评，不属补录
    expect(backfillWindowOpen(at(3, 59))).toBe(false);
    expect(backfillWindowOpen(at(4, 0))).toBe(true);
    expect(backfillWindowOpen(at(11, 59))).toBe(true);
    expect(backfillWindowOpen(at(12, 0))).toBe(false); // 过午即关：窗口无限大 = 事后补写
  });

  it('可补 = 窗口开 且 昨日无评分（防重复）；任一不满足即不可补', () => {
    const morning = at(8);
    expect(canBackfillYesterday(state(), morning)).toBe(true);            // 窗口内 + 昨晚漏评
    const yScore: ChainEvent = { ts: new Date(2026, 9, 20, 23, 40).getTime(), type: 'score', score: 7, scale: 10 };
    expect(canBackfillYesterday(state(yScore), morning)).toBe(false);     // 昨晚已评
    expect(canBackfillYesterday(state(), at(14))).toBe(false);            // 窗口外
  });

  it('补录时间戳落昨日 23:30（4:00 日界内，dayKey=昨日）', () => {
    const ts = backfillTs(at(8));
    expect(dayKey(ts)).toBe('2026-10-20');
    const d = new Date(ts);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(30);
  });

  it('补录事件参与派生：不算今日评分，但计入近 7 天均分', () => {
    const s = state({ ts: backfillTs(at(8)), type: 'score', score: 4, scale: 10, backfill: true });
    expect(todayScore(s, at(8))).toBeNull();          // 补的是昨晚，今天的评分位仍空着
    expect(averageLast7(s, at(8))).toBeCloseTo(4);    // 均分计入
  });

  it('4:00 边界下的"昨晚"目标：04:30 补录指向的仍是同一昨日', () => {
    const earlyMorning = at(4, 30);
    expect(canBackfillYesterday(state(), earlyMorning)).toBe(true);
    expect(dayKey(backfillTs(earlyMorning))).toBe('2026-10-20');
  });
});
