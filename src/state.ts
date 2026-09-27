// ─────────────────────────────────────────────────────────────
// state.ts — 状态与持久化（手写层：架构宪法的执行者）
// 程序模型 = 全局 struct S + 每次变更整体覆写 + 从状态重渲染
// （对 C++ 思维：S 是全局对象，save() 相当于变更后 autosave 序列化）
// ─────────────────────────────────────────────────────────────

import type { AppState, ChainEvent } from './types';

// 带版本号的 key：schema 演进时换 key 重开新档，不做迁移
const STORAGE_KEY = 'ctdp_v1';

function defaultState(): AppState {
  return {
    version: 1,
    chains: {
      C1: { name: '算法题（本业）', createdAt: Date.now() },
      C2: { name: '锻炼：校园跑/健身房 40min-1h', createdAt: Date.now() },
    },
    events: [],
  };
}

/** 防御式加载：损坏/缺失一律回退到默认档（与 Hamon 的 `|| 'null'` 兜底同理）。
 *  v0.2 部署补丁：早期存档（只有 C1）注入 C2 锻炼链定义——只补元信息，不动事件流。 */
export function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultState();
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.version !== 1 || !Array.isArray(parsed.events) || typeof parsed.chains !== 'object') {
      return defaultState();
    }
    if (parsed.chains.C2 === undefined) {
      return {
        ...parsed,
        chains: { ...parsed.chains, C2: { name: '锻炼：校园跑/健身房 40min-1h', createdAt: Date.now() } },
      };
    }
    return parsed;
  } catch {
    return defaultState();
  }
}

/** 每次变更全量覆写（localStorage 只有字符串，约 5MB 上限） */
export function save(s: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/** 唯一的写路径：追加事件 → 落盘 → 返回（事件不可变，调用方不得复用同一对象再改） */
export function append(s: AppState, e: ChainEvent): AppState {
  const next: AppState = { ...s, events: [...s.events, e] };
  save(next);
  return next;
}

/** 导入 = 整体替换（调用方负责二次确认；仅做结构校验） */
export function replaceWith(data: unknown): AppState | null {
  if (
    typeof data === 'object' && data !== null &&
    (data as AppState).version === 1 &&
    Array.isArray((data as AppState).events) &&
    typeof (data as AppState).chains === 'object'
  ) {
    const next = data as AppState;
    save(next);
    return next;
  }
  return null;
}
