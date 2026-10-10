import { describe, expect, it } from 'vitest';
import { computeChain, verdictList, canTrigger } from '../src/logic/chain';
import type { AppState, ChainEvent } from '../src/types';

// 时间基线：任意固定值，测试内相对递增
let t = 1_700_000_000_000;
const tick = () => (t += 60_000); // 每次调用 +1 分钟
const ev = (type: ChainEvent['type'], extra: Partial<ChainEvent> = {}): ChainEvent => ({
  ts: tick(), type, chain: 'C1', ...extra,
});

function state(...events: ChainEvent[]): AppState {
  return {
    version: 1,
    policies: {},
    chains: { C1: { name: '算法题（本业）', createdAt: t } },
    events,
  };
}

describe('computeChain 链规则', () => {
  it('空链：length 0，非进行中', () => {
    const v = computeChain(state(), 'C1');
    expect(v?.length).toBe(0);
    expect(v?.activeSince).toBeNull();
    expect(v?.totalDone).toBe(0);
  });

  it('触发后进入专注态（activeSince = 触发时刻）', () => {
    const v = computeChain(state(ev('trigger')), 'C1');
    expect(v?.activeSince).not.toBeNull();
    expect(v?.length).toBe(0); // 未结算不计
  });

  it('完成一个节点：length +1 并回到 idle', () => {
    const v = computeChain(state(ev('trigger'), ev('done')), 'C1');
    expect(v?.length).toBe(1);
    expect(v?.activeSince).toBeNull();
  });

  it('连续三个节点：length 3', () => {
    const v = computeChain(state(
      ev('trigger'), ev('done'),
      ev('trigger'), ev('done'),
      ev('trigger'), ev('done'),
    ), 'C1');
    expect(v?.length).toBe(3);
  });

  it('判失败：链清零，totalDone 保留（内化进度不丢失）', () => {
    const v = computeChain(state(
      ev('trigger'), ev('done'), ev('done'),
      ev('fail', { note: '中途刷手机' }),
      ev('trigger'), ev('done'),
    ), 'C1');
    expect(v?.length).toBe(1);          // fail 之后只有 1 个 done
    expect(v?.totalDone).toBe(3);       // 全历史 3 个节点都在
    expect(v?.lastFailAt).not.toBeNull();
  });

  it('侦查：不进链长，计数全量累计且 fail 不清零（低谷在场史）', () => {
    const v = computeChain(state(
      ev('trigger'), ev('done'),
      ev('scout'), ev('scout'),
      ev('fail', { note: '测试' }),
      ev('scout'),
    ), 'C1');
    expect(v?.length).toBe(0);          // fail 清零，侦查不顶节点
    expect(v?.scoutCount).toBe(3);      // 清零前后累计
  });

  it('侦查分链计数：只数当前链的', () => {
    const s: AppState = {
      version: 1, policies: {},
      chains: { C1: { name: '算法题（本业）', createdAt: t }, C2: { name: '锻炼', createdAt: t } },
      events: [ev('scout'), ev('scout', { chain: 'C2' })],
    };
    expect(computeChain(s, 'C1')?.scoutCount).toBe(1);
    expect(computeChain(s, 'C2')?.scoutCount).toBe(1);
  });

  it('fail 后尚未重来：length 0', () => {
    const v = computeChain(state(ev('trigger'), ev('done'), ev('fail')), 'C1');
    expect(v?.length).toBe(0);
    expect(v?.activeSince).toBeNull();
  });

  it('判例（verdict）不影响链状态', () => {
    const v = computeChain(state(
      ev('trigger'),
      ev('verdict', { verdictText: '查资料离开屏幕≤3分钟属允许' }),
      ev('done'),
    ), 'C1');
    expect(v?.length).toBe(1);
  });

  it('防御：重复触发以最后一次为准（UI 层负责拦截，数据层不崩溃）', () => {
    const v = computeChain(state(ev('trigger'), ev('trigger')), 'C1');
    expect(v?.activeSince).not.toBeNull();
  });

  it('booking（预约）仅记账，不改变链', () => {
    const v = computeChain(state(ev('booking'), ev('trigger'), ev('done')), 'C1');
    expect(v?.length).toBe(1);
  });

  it('补判语义：done 之后末尾追加 fail，当前链长自动归零，历史与总量保留', () => {
    const v = computeChain(state(
      ev('trigger'), ev('done'), ev('done'),
      ev('fail', { note: '补判：结算后才发现中途违规' }),
    ), 'C1');
    expect(v?.length).toBe(0);
    expect(v?.totalDone).toBe(2);
  });

  it('不存在的链返回 null；canTrigger 与活跃态联动', () => {
    const s = state(ev('trigger'));
    expect(computeChain(s, 'NOPE')).toBeNull();
    expect(canTrigger(s, 'C1')).toBe(false);        // 专注中不许再触发
    expect(canTrigger(state(), 'C1')).toBe(true);  // idle 可触发
  });
});

describe('verdictList 判例库', () => {
  it('正序返回全部判例文本', () => {
    const list = verdictList(state(
      ev('trigger'),
      ev('verdict', { verdictText: '判例#1：查资料≤3分钟属允许' }),
      ev('verdict', { verdictText: '判例#2：接电话属允许' }),
    ));
    expect(list.map((v) => v.text)).toEqual([
      '判例#1：查资料≤3分钟属允许',
      '判例#2：接电话属允许',
    ]);
  });

  it('无判例时空数组', () => {
    expect(verdictList(state())).toEqual([]);
  });
});
