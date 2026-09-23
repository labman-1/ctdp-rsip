import { afterEach, describe, expect, it } from 'vitest';
import { load, append, replaceWith } from '../src/state';
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
    const good: AppState = { version: 1, chains: {}, events: [{ ts: 1, type: 'score', score: 5 }] };
    expect(replaceWith(good)?.events).toHaveLength(1);
    expect(replaceWith({ junk: true })).toBeNull();
    expect(load().events).toHaveLength(1); // 替换成功后存档即新档
  });
});
