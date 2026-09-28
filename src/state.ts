// ─────────────────────────────────────────────────────────────
// state.ts — 状态与持久化（手写层：架构宪法的执行者）
// 程序模型 = 全局 struct S + 每次变更整体覆写 + 从状态重渲染
// （对 C++ 思维：S 是全局对象，save() 相当于变更后 autosave 序列化）
// ─────────────────────────────────────────────────────────────

import type { AppState, ChainEvent, PolicyDef } from './types';

// 带版本号的 key：schema 演进时换 key 重开新档，不做迁移
const STORAGE_KEY = 'ctdp_v1';

let policySeq = 0;

/** 新建国策 id：P1、P2……（进程内自增，持久化后以 state.policies 现有 id 为准） */
export function nextPolicyId(s: AppState): string {
  const nums = Object.keys(s.policies).map((id) => Number(id.slice(1)) || 0);
  return `P${Math.max(policySeq, ...nums) + 1}`;
}

/** 新建国策定义（入手牌库：定义存在即手牌，无需事件） */
export function addPolicy(s: AppState, def: Omit<PolicyDef, 'createdAt'>): AppState {
  const id = nextPolicyId(s);
  const next: AppState = {
    ...s,
    policies: { ...s.policies, [id]: { ...def, createdAt: Date.now() } },
  };
  save(next);
  return next;
}

/** 修正国策定义（改名/改要求/lv/装饰/追加修正条款）——定义在 state，直接改并落盘 */
export function updatePolicy(
  s: AppState,
  id: string,
  patch: Partial<Omit<PolicyDef, 'createdAt'>>,
): AppState {
  if (!s.policies[id]) return s;
  const next: AppState = {
    ...s,
    policies: { ...s.policies, [id]: { ...s.policies[id], ...patch } },
  };
  save(next);
  return next;
}

function defaultState(): AppState {
  return ensureDerivedChains({
    version: 1,
    chains: {
      C1: { name: '算法题（本业）', createdAt: Date.now() },
      C2: { name: '锻炼：校园跑/健身房 40min-1h', createdAt: Date.now() },
    },
    policies: {},
    events: [],
  });
}

/** 为每条主链补齐预约链元信息（computeChain 需要链定义存在）；早期存档注入 C2。 */
function ensureDerivedChains(s: AppState): AppState {
  const patched: Record<string, { name: string; createdAt: number }> = { ...s.chains };
  if (patched.C2 === undefined) {
    patched.C2 = { name: '锻炼：校园跑/健身房 40min-1h', createdAt: Date.now() };
  }
  for (const [id, meta] of Object.entries(patched)) {
    if (id.endsWith('预约')) continue;
    const bId = id + '预约';
    if (patched[bId] === undefined) patched[bId] = { name: `${meta.name} · 预约链`, createdAt: Date.now() };
  }
  return { ...s, chains: patched };
}
/** 防御式加载：损坏/缺失一律回退到默认档（与 Hamon 的 `|| 'null'` 兜底同理）。
 *  部署补丁（只补元信息，不动事件流）：早期存档注入 C2；为每条主链补齐预约链定义；
 *  v0.4 前存档补空的 policies 容器。 */
export function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultState();
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.version !== 1 || !Array.isArray(parsed.events) || typeof parsed.chains !== 'object') {
      return defaultState();
    }
    if (typeof parsed.policies !== 'object' || parsed.policies === null) {
      return ensureDerivedChains({ ...parsed, policies: {} });
    }
    return ensureDerivedChains(parsed);
  } catch {
    return defaultState();
  }
}

/** 每次变更全量覆写（localStorage 只有字符串，约 5MB 上限） */
export function save(s: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

/** 唯一的写路径：批量追加事件 → 一次落盘（多事件提交原子化）→ 返回新状态 */
export function append(s: AppState, ...es: ChainEvent[]): AppState {
  const next: AppState = { ...s, events: [...s.events, ...es] };
  save(next);
  return next;
}

// ── UI 偏好存储（所有 localStorage 访问收敛在本文件，main/ui 不直接摸存储）──
const UI_KEY = 'ctdp_ui_chain';

export function loadUiChain(fallback: string): string {
  const v = localStorage.getItem(UI_KEY) ?? fallback;
  return v.endsWith('预约') ? v.replace('预约', '') : v;
}

export function saveUiChain(id: string): void {
  localStorage.setItem(UI_KEY, id);
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
