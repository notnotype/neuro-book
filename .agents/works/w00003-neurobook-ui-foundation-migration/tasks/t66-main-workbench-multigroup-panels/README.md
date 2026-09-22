---
schema: nbook.task/v2
taskId: t66-main-workbench-multigroup-panels
---

# 主页面多组编辑、底部面板、状态栏与工具移动

**状态：实现完成；主页面验收部分通过、部分未验**（2026-09-19）。计划见 `local://main-workbench-multigroup-panels-plan.md`；实现与验收证据见 [walkthroughs/implementation.md](walkthroughs/implementation.md)。

验收已通过项：三栏+底部+状态栏叶集合、多组拓扑与 sash、组会话记录写入与恢复、三处真实工具宿主、状态栏真实事实、跨工作面、三档视口无溢出。
验收中发现并已修复：分屏模式被忽略、内部拖动把路径插进正文（t65）、**恢复后的组永不绑定编辑器**（解析缓存不响应式）、**存活实例停在旧正文导致兄弟组首次输入冲突**（宿主在解析缺失时提前返回）。后两个修复带"回退即失败"的回归用例。
未验证项（不得当作通过）见 walkthrough §5：本轮修复的浏览器端复验受隔离服务环境态阻塞、工具跨面板移动与底部手势的浏览器实测、无 opener 新页刷新恢复、存储冲突三出口、四主题对照。

## 目标

开发者要求：主界面支持**多组编辑**，同时接入**底部面板**与**状态栏**，并以「工具 View 能在不同面板之间移动」验证集成。最终验收必须发生在真实主页面，Lab 只作组件对照。

## 交付面

| 切片 | 结果 |
|---|---|
| 甲 文档权威收敛 | 正文只剩一份按路径的缓冲（含单调 `contentRevision`）；活动文件、dirty、标签都是投影；保存按 `EditorDocumentTarget` 执行、同一文档合并在途保存 |
| 乙 组与标签事务 | 新增 `editor-session.ts` 纯事务（组集合 = 布局树叶、组内路径唯一、最后一个空组保留）；Store 是唯一 authority；split/transfer 载荷显式带来源/目标/模式 |
| 丙 真实视图实例 | `EditorViewHost` 每次实例唯一 token、`commitChange` 有回执（accepted/conflict/stale）、`flushPendingChange` 返回 settled/conflict、Monaco 模型归实例所有、外部回灌不入撤销栈 |
| 丁 编辑会话恢复 | `workbench.editor/session`（project/local）与 `user-assets-session`（user/local）一条记录原子恢复；冲突三出口；dirty 缓冲不因采用远端布局丢失 |
| 戊 外壳底部与高度 | root 增 `panel`/`statusbar` 两叶，底部跨全宽可调/可收起（32px 标签头，叶不删）；`panel-size`/`surface-panel-size` 只记主动高度意图 |
| 己 工具位置与实例 | `view-placements.ts` 纯模块 + 会话；`nbook.panel` 容器与 `canMoveView`；`WorkbenchViewInstances` 保证每视图唯一实例（Teleport 跨三处搬 DOM） |
| 庚 主页面集成 | 逐组真实 `EditorViewHost`、三处工具宿主、状态栏真实事实、工具拖放与菜单同一命令、冲突与记录提示条 |
| 辛 验收 | 聚焦 53 文件 / 531 用例、主应用 typecheck 通过、docs:check 与 governance:check 通过；隔离主页面浏览器验收部分通过（已通过/未验项见文首状态与 walkthrough §2、§5） |

## 关键设计决定

- **一份正文权威**：`workspaceBuffers[path]` 是唯一可写正文；视图只提交 `baseRevision + content` 并拿回执，冲突时权威正文不动、候选留在实例里。
- **会话 = 分组拓扑 + 逐组标签 + 活动组**：一条记录原子保存；尺寸测量与正文输入**不**产生会话提交（`editorSessionRevision` 是唯一信号）。
- **工具实例活在叶子外**：左/右叶显隐与底部尺寸变化都可能重挂容器宿主，实例层因此放在外壳之上，用 Teleport 搬 DOM 而不是重建组件。
- **移动只有一条命令**：菜单与拖动都调 `moveView(viewId, targetContainerId)`；越界来源、默认指纹不符、未知视图在命令边界拒绝。
- **未解决输入是硬门禁**：保存、关闭、切工作面、拓扑调整都先 flush，conflict 时停手并要求用户显式裁决。

## 范围与排除

不做：文档停靠工具面板、移动整个 Part、跨窗口浮动、容器内拖动换序、正文跨浏览器重开备份、共享撤销历史、真实 Provider 调用。不改写 t64/t65 的已完成事实。

## 验证与证据

见 [walkthroughs/implementation.md](walkthroughs/implementation.md)：命令原文与结果（聚焦套件、typecheck、docs:check、governance:check）、主页面已通过场景、验收中发现的两个真实缺陷（解析缓存不响应式、宿主在解析缺失时提前返回）的根因/修复/回归用例与"回退即失败"证据，以及 §5 未验证项清单。
