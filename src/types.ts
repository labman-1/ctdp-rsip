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
  | 'booking'; // 预约信号（辅助链，MVP 仅记账）

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
}

export interface AppState {
  readonly version: 1;
  /** chain id → 元信息（当前链长等全部从 events 派生，不在此存储） */
  readonly chains: Record<string, { name: string; createdAt: number }>;
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

