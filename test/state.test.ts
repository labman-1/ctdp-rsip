import { afterEach, describe, expect, it } from 'vitest';
import { load, append, replaceWith, addChain, nextChainId, updateChainName } from '../src/state';
import type { AppState } from '../src/types';

// node 环境没有 localStorage，用 Map 内存桩替代（接口与 Storage 兼容）
const store = new Map<string, string>();
const storageStub: Storage = {
  length: 0,
  clear: () => store.clear(),
  getItem: (k) => store.get(k) ?? null,
  key: () => null,
  setItem: (k, v) => { store.set(k, v); },
  removeItem: (k) => { store.delete(k); },
};
Object.defineProperty(globalThis, 'localStorage', { value: storageStub, configurable: true });

afterEach(() => store.clear());

describe('state 持久化', () => {
  it('无存档时返回默认档（含 C1 链）', () => {
    const s = load();
    expect(s.version).toBe(1);
    expect(s.chains.C1).toBeDefined();
    expect(s.events).toHaveLength(0);
  });

  it('损坏的存档回退默认档而非崩溃', () => {
    store.set('ctdp_v1', '{broken json');
    expect(load().events).toHaveLength(0);
    store.set('ctdp_v1', JSON.stringify({ version: 99 }));
    expect(load().events).toHaveLength(0);
  });

  it('append 追加事件并落盘；原状态不被修改（不可变事件流）', () => {
    let s = load();
    const before = s.events.length;
    s = append(s, { ts: Date.now(), type: 'trigger', chain: 'C1' });
    expect(s.events).toHaveLength(before + 1);
    expect(load().events).toHaveLength(before + 1); // 确实写进去了
  });

  it('replaceWith 仅接受结构合法的整体替换', () => {
    const good: AppState = { version: 1, policies: {}, chains: {}, events: [{ ts: 1, type: 'score', score: 5 }] };
    expect(replaceWith(good)?.events).toHaveLength(1);
    expect(replaceWith({ junk: true })).toBeNull();
    expect(load().events).toHaveLength(1); // 替换成功后存档即新档
  });
});

describe('addChain 新建链', () => {
  it('id 顺延（排除预约链），并自动补齐预约链定义', () => {
    const s = load(); // 默认档 C1/C2（+各自预约链）
    expect(nextChainId(s)).toBe('C3');
    const r = addChain(s, '课程工程作业');
    expect(r.id).toBe('C3');
    expect(r.state.chains.C3.name).toBe('课程工程作业');
    expect(r.state.chains['C3预约'].name).toContain('预约');
    expect(load().chains.C3).toBeDefined(); // 已落盘
    // 再建一条 → C4
    expect(nextChainId(r.state)).toBe('C4');
  });
});

describe('updateChainName 链改名', () => {
  it('改显示名；预约链名恰为派生式时联动同步', () => {
    const r = addChain(load(), '备考刷题');
    const s2 = updateChainName(r.state, 'C3', '备考刷题（期末）');
    expect(s2.chains.C3.name).toBe('备考刷题（期末）');
    expect(s2.chains['C3预约'].name).toBe('备考刷题（期末） · 预约链'); // 派生式 → 跟随
    expect(s2.events).toBe(r.state.events); // 事件流零影响
  });

  it('预约链名被手动改过（非派生式）则不联动', () => {
    const r = addChain(load(), '备考刷题');
    const handRenamed: AppState = { ...r.state, chains: { ...r.state.chains, ['C3预约']: { ...r.state.chains['C3预约'], name: '我的预约' } } };
    const s2 = updateChainName(handRenamed, 'C3', '新名字');
    expect(s2.chains['C3预约'].name).toBe('我的预约'); // 不动
  });

  it('空名或同名返回原状态（不落盘无效变更）', () => {
    const s = load();
    expect(updateChainName(s, 'C1', '')).toBe(s);
    expect(updateChainName(s, 'C1', s.chains.C1.name)).toBe(s);
  });
});
