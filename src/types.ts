// ─────────────────────────────────────────────────────────────
// 类型定义（架构宪法的物化）
//
// 数据流四句话：
// 1. 所有数据在单个 localStorage key `ctdp_v1`（本文件 STORAGE_KEY）
// 2. 用户每次操作 = 向 events 追加一条不可变事件（append-only，永不删除）
// 3. 一切视图（链长/活跃态/评分/判例库）从 events 纯函数重算，状态里不存派生值
// 4. 清零 = fail 事件；历史事件永在（判例法的证据链）
// ─────────────────────────────────────────────────────────────

export type EventType =
  | 'trigger'  // 触发神圣座位，开始一次专注
  | 'done'     // 完成一次专注，节点 +1
  | 'fail'     // 判失败，链清零（从 #1 重来）
  | 'verdict'  // 判允许：登记判例（永久生效，不影响链长）
  | 'score'    // 睡前评分（G1 国策）
  | 'booking'  // 预约信号（辅助链，MVP 仅记账）
  // ── 国策树（RSIP，v0.4）。定义存在 state.policies 即手牌，无需 hand 事件 ──
  | 'policy_join'    // 上树（须当日凭证；全局每日配额 1）
  | 'policy_done'    // 国策当日执行成功（凭证 + 内化天数计数）
  | 'policy_fail'    // 国策违例：堆栈熄灭（节点连同全部子孙回手牌）
  | 'policy_revive'  // 从手牌重上末梢（占用每日配额）
  | 'policy_upgrade'; // lv 变更历史（当前 lv 存 state）

export interface ChainEvent {
  readonly ts: number;
  readonly type: EventType;
  readonly chain?: string;
  /** verdict：判例正文 */
  readonly verdictText?: string;
  /** score：0-10 分制（0.5 步进）。旧事件无 scale 字段 = 1-5 分制，派生时按锚点语义映射 */
  readonly score?: number;
  /** 评分事件的分制标记；缺省视为旧 5 分制 */
  readonly scale?: 5 | 10;
  /** 附注（失败原因、复盘一句话等） */
  readonly note?: string;
  // ── 国策事件字段 ──
  /** 国策 id */
  readonly policyId?: string;
  /** join/revive：父国策 id（空=独立根） */
  readonly parent?: string | null;
  /** policy_upgrade：变更后的 lv */
  readonly newLevel?: number;
}

/** 国策类型（原文三分法：被动 > 半被动 > 主动，维护成本递增） */
export type PolicyKind = 'passive' | 'semi' | 'active';

/** 国策定义（state 顶层，可随时修正；动力学见事件族） */
export interface PolicyDef {
  name: string;
  kind: PolicyKind;
  /** 要求全文（判定标准须一句话说清） */
  requirement: string;
  /** 当前等级（升级历史见 policy_upgrade 事件） */
  level: number;
  createdAt: number;
  /** 卡片要点（简略版，列表显示） */
  brief?: string;
  /** 详情页装饰（自由文本 + emoji + 图片 URL；localStorage 只存 URL 不存图片本体） */
  detail?: string;
  /** 修正条款（判例提炼的成文法；verdictRef 可关联判例事件时间戳） */
  amendments?: Array<{ text: string; date: number; verdictRef?: number }>;
}

export interface AppState {
  readonly version: 1;
  /** chain id → 元信息（当前链长等全部从 events 派生，不在此存储） */
  readonly chains: Record<string, { name: string; createdAt: number }>;
  /** 国策 id → 定义（树结构/存活/天数从 events 派生） */
  readonly policies: Record<string, PolicyDef>;
  readonly events: readonly ChainEvent[];
}

/** 某条链的派生视图（纯函数 computeChain 的产物） */
export interface ChainView {
  id: string;
  name: string;
  /** 当前链长：最近一次 fail 之后的 done 计数 */
  length: number;
  /** 正在进行中的一次专注（触发未结算），值为触发时间戳 */
  activeSince: number | null;
  /** 全部历史节点数（含被清零的），用于确认"内化进度不丢失" */
  totalDone: number;
  /** 距今时间最近的 fail（若在近期，界面提示"链于 X 重来"） */
  lastFailAt: number | null;
}

