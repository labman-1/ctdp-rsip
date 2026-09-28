import { describe, expect, it } from 'vitest';
import { todayScore, averageLast7, dayKey, legacyTo10 } from '../src/logic/score';
import type { AppState, ChainEvent } from '../src/types';

let t = 1_700_000_000_000;
const tick = () => (t += 60_000);
const ev = (score: number, extra: Partial<ChainEvent> = {}): ChainEvent => ({
  ts: tick(), type: 'score', score, ...extra,
});

function state(...events: ChainEvent[]): AppState {
  return { version: 1, chains: {}, events };
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
      version: 1, chains: {},
      events: [
        { ts: now - 3 * 24 * 3600 * 1000, type: 'score', score: 3 },            // 旧 → 5
        { ts: now - 1 * 24 * 3600 * 1000, type: 'score', score: 7.5, scale: 10 }, // 新 7.5
        { ts: now - 20 * 24 * 3600 * 1000, type: 'score', score: 1 },           // 窗口外
      ],
    };
    expect(averageLast7(s, now)).toBeCloseTo(6.25);
  });

  it('dayKey 输出当地时区 YYYY-MM-DD', () => {
    const d = new Date(2026, 8, 16, 23, 30); // 2026-09-16 本地时间
    expect(dayKey(d.getTime())).toBe('2026-09-16');
  });
});
