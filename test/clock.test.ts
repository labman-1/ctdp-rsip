import { describe, expect, it } from 'vitest';
import { titleFor } from '../src/ui/clock';

const BASE = 'CTDP·RSIP';
const DUE = '⚠ 预约到期 · 立即触发';
const OVERDUE = '⚠ 预约失约 · 待裁决';

describe('titleFor 标题状态机（预约到期报警）', () => {
  it('due 突发期（30 秒内）：1Hz 闪，警示与基名交替', () => {
    expect(titleFor('due', true, true)).toBe(DUE);
    expect(titleFor('due', true, false)).toBe(BASE);
  });

  it('due 突发期后：静态警示，不再闪烁', () => {
    expect(titleFor('due', false, true)).toBe(DUE);
    expect(titleFor('due', false, false)).toBe(DUE);
  });

  it('overdue：常驻静态（无界状态不闪烁——警报疲劳与无动画原则）', () => {
    expect(titleFor('overdue', true, true)).toBe(OVERDUE);
    expect(titleFor('overdue', false, false)).toBe(OVERDUE);
  });

  it('none / booked：恢复基名', () => {
    expect(titleFor('none', false, false)).toBe(BASE);
    expect(titleFor('booked', true, true)).toBe(BASE);
  });
});
