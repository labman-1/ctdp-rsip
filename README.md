# 链 · CTDP

基于 CTDP（链式时延协议）的单文件 PWA 自控工具。无账号、无云同步、无积分、无宠物——数据只存在你设备的 localStorage 里。

## 理论来源

知乎用户 edmond《如何提高自制力？》回答（CTDP / RSIP 方法论，原作者以类 MIT 许可完全开源）：
<https://www.zhihu.com/question/19888447/answer/1930799480401293785>

本工具是该理论的最小忠实实现，同生态参考实现：[momentum](https://github.com/KenXiao1/momentum)、[Hamon](https://github.com/Chemit797/Hamon)、[ctdp-pomodoro](https://github.com/Ygria/ctdp-pomodoro)。

## 协议 → 功能映射

| 协议条款 | 实现 |
|---|---|
| 神圣座位：触发 → 满状态专注 60 分钟 → 节点 +1 | 链操作台：触发 / 完成 / 失败 + 超大链长数字 |
| 失败清零，从 #1 重来；内化进度不丢失 | 清零只重置当前链长，`总节点` 永远累计 |
| 下必为例：判失败（清零）或判允许（永久判例） | 失败时强制弹窗二选一，判例库可查 |
| G1 睡前评分 | 1/3/5 锚点评分 + 一句话 + 近 7 天均分 |
| 备份责任在人 | 一键导出 / 导入 JSON |
| 移动端 = 对抗主战场 | PWA：浏览器打开 → 添加到主屏幕（建议 Chrome/Edge） |

## 架构宪法（数据流四句话）

1. 所有数据存于单个 localStorage key `ctdp_v1`；
2. 每次操作 = 向 `events` 追加一条不可变事件（append-only，永不删除——这是判例法的证据链）；
3. 一切视图（链长 / 活跃态 / 评分 / 判例）从事件纯函数重算，状态里不存派生值；
4. 清零 = fail 事件；历史事件永在。

技术栈：Vite 5 + TypeScript（严格模式）+ vite-plugin-singlefile，构建产物为单个 HTML（约 14 kB）。逻辑层（`src/logic/`）为纯函数，Vitest 全覆盖；UI 无框架，全局状态 + 全量重渲染（Hamon 验证的模式，对 C++ 思维友好）。

## 使用

```bash
npm install
npm run dev        # 开发
npm test           # 23 个单测
npm run build      # 产出 dist/index.html 单文件
```

- 本地直接用：双击 `dist/index.html`
- 手机安装：部署到任意静态托管（如 GitHub Pages），用 Chrome/Edge 打开 → 添加到主屏幕
- **每周日导出一次 JSON**——清浏览器数据 = 清链，这是你的备份责任

## 非目标（防玩具化声明）

不做账号与云同步（同步丢数据会摧毁判例法信任）；不做积分押注（外部动机理论中属控制性事件）；不做宠物与成就装饰（"远端加正值"增益极低）。本工具的 KPI 是**减少你在它上面的停留时间**：打开 → 操作 → 30 秒内关闭。

## 许可

GPL-3.0-only。致谢理论原作者 edmond 的开源声明，以及 momentum / Hamon 的先例验证。
