import { describe, expect, it } from 'vitest';
import { computeChain, bookingState, BOOKING_WINDOW_MS, BOOKING_GRACE_MS } from '../src/logic/chain';
import type { AppState, ChainEvent } from '../src/types';

let t = 1_700_000_000_000;
const tick = () => (t += 60_000);
const ev = (type: ChainEvent['type'], chain: string, extra: Partial<ChainEvent> = {}): ChainEvent => ({
  ts: tick(), type, chain, ...extra,
});

function state(...events: ChainEvent[]): AppState {
  return {
    version: 1,
    chains: {
      C1: { name: '主链', createdAt: t },
      C1预约: { name: '主链 · 预约链', createdAt: t },
    },
    events,
  };
}

describe('预约链归一化（booking 视同 trigger）', () => {
  it('booking 后预约链进入进行态', () => {
    const v = computeChain(state(ev('booking', 'C1预约')), 'C1预约');
    expect(v?.activeSince).not.toBeNull();
    expect(v?.length).toBe(0);
  });

  it('一次完整预约（booking → 兑现 done）计一个节点', () => {
    const v = computeChain(state(
      ev('booking', 'C1预约'), ev('done', 'C1预约'),
    ), 'C1预约');
    expect(v?.length).toBe(1);
  });

  it('预约链判失败清零，与主链互不影响', () => {
    const s = state(
      ev('booking', 'C1预约'), ev('done', 'C1预约'), ev('done', 'C1预约'),
      ev('fail', 'C1预约', { note: '失约' }),
      ev('trigger', 'C1'), ev('done', 'C1'),
    );
    expect(computeChain(s, 'C1预约')?.length).toBe(0);
    expect(computeChain(s, 'C1预约')?.totalDone).toBe(2); // 内化进度保留
    expect(computeChain(s, 'C1')?.length).toBe(1); // 主链不受连坐
  });
});

describe('bookingState 预约状态机', () => {
  it('无预约 → none', () => {
    expect(bookingState(state(), 'C1', t).phase).toBe('none');
  });

  it('预约后窗口内 → booked；到期宽限 → due；宽限过后 → overdue', () => {
    const s = state(ev('booking', 'C1预约'));
    const bookingTs = s.events[0].ts;
    expect(bookingState(s, 'C1', bookingTs + 60_000).phase).toBe('booked');
    expect(bookingState(s, 'C1', bookingTs + BOOKING_WINDOW_MS + 60_000).phase).toBe('due');
    expect(bookingState(s, 'C1', bookingTs + BOOKING_WINDOW_MS + BOOKING_GRACE_MS + 60_000).phase).toBe('overdue');
  });

  it('窗口内触发主链 = 预约兑现 → none（由 UI 双事件补 done）', () => {
    const s = state(ev('booking', 'C1预约'), ev('trigger', 'C1'));
    // trigger 事件在窗口内 → settled；预约链的 done 由 main.ts 追加，状态机只负责"已结算"
    expect(bookingState(s, 'C1', t).phase).toBe('none');
  });

  it('窗口外触发主链不算兑现（宽限后触发前已 overdue，须裁决）', () => {
    const s = state(ev('booking', 'C1预约'), ev('trigger', 'C1'));
    const lateTs = s.events[0].ts + BOOKING_WINDOW_MS + BOOKING_GRACE_MS + 60_000;
    const patched: AppState = { ...s, events: [s.events[0], { ...s.events[1], ts: lateTs }] };
    expect(bookingState(patched, 'C1', lateTs + 1000).phase).toBe('overdue');
  });

  it('裁决（判失败或判允许）后 → none', () => {
    const failed = state(ev('booking', 'C1预约'), ev('fail', 'C1预约', { note: '失约' }));
    expect(bookingState(failed, 'C1', t).phase).toBe('none');
    const allowed = state(ev('booking', 'C1预约'), ev('verdict', 'C1预约', { verdictText: '被老师叫走' }));
    expect(bookingState(allowed, 'C1', t).phase).toBe('none');
  });

  it('刷新语义：状态从事件派生，booked 状态在任意时刻可重算', () => {
    const s = state(ev('booking', 'C1预约'));
    // 模拟"杀掉 App 重开"：同一事件流在任何 now 下派生出一致的 phase
    expect(bookingState(s, 'C1', s.events[0].ts + 1000).phase).toBe('booked');
  });
});
