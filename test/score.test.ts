import { describe, expect, it } from 'vitest';
import { scoreHistory, todayScore, averageLast7, dayKey } from '../src/logic/score';
import type { AppState, ChainEvent } from '../src/types';

let t = 1_700_000_000_000;
const tick = () => (t += 60_000);
const ev = (score: 1 | 2 | 3 | 4 | 5, extra: Partial<ChainEvent> = {}): ChainEvent => ({
  ts: tick(), type: 'score', score, ...extra,
});

function state(...events: ChainEvent[]): AppState {
  return { version: 1, chains: {}, events };
}

describe('score 派生', () => {
  it('空历史：todayScore 与 average 均为 null', () => {
    expect(todayScore(state())).toBeNull();
    expect(averageLast7(state())).toBeNull();
  });

  it('今日评分可查，含附言', () => {
    const s = state(ev(3, { note: '平静：下午打了一个节点' }));
    const today = todayScore(s, t);
    expect(today?.score).toBe(3);
    expect(today?.note).toBe('平静：下午打了一个节点');
  });

  it('昨日评分不算今日', () => {
    const yesterday = t - 24 * 3600 * 1000;
    const s: AppState = { version: 1, chains: {}, events: [{ ts: yesterday, type: 'score', score: 4 }] };
    expect(todayScore(s, t)).toBeNull();
  });

  it('同日多次评分取最后一次', () => {
    const s = state(ev(3), ev(5, { note: '晚上补了个节点' }));
    expect(todayScore(s, t)?.score).toBe(5);
  });

  it('averageLast7 只统计 7 天窗口内，且每日权重独立（不做日均去重）', () => {
    const now = t;
    const s: AppState = {
      version: 1, chains: {},
      events: [
        { ts: now - 3 * 24 * 3600 * 1000, type: 'score', score: 3 },
        { ts: now - 1 * 24 * 3600 * 1000, type: 'score', score: 5 },
        { ts: now - 20 * 24 * 3600 * 1000, type: 'score', score: 1 }, // 窗口外
      ],
    };
    expect(averageLast7(s, now)).toBeCloseTo(4);
  });

  it('dayKey 输出当地时区 YYYY-MM-DD', () => {
    const d = new Date(2026, 8, 16, 23, 30); // 2026-09-16 本地时间
    expect(dayKey(d.getTime())).toBe('2026-09-16');
  });

  it('scoreHistory 正序且只含评分事件', () => {
    const s = state(ev(1), { ts: tick(), type: 'trigger' } as ChainEvent);
    expect(scoreHistory(s)).toHaveLength(1);
  });
});
