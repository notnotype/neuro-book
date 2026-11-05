---
schema: nbook.task/v2
taskId: t20-panel-review-close-and-reading-width
status: active
updated: 2026-11-05
---

# 评审默认选答、面板关闭评审、撞号收敛、阅读加宽、左栏折叠 Task

## 目标与范围

开发者 2026-11-05 提的四条：

1. 评审板默认都是选答，开发者能自己关闭评审。
2. 处理首页的撞号 `w00007` 与 `w00003-neurobook-ui-foundation-migration/t05`。
3. Task 与文档页的 Markdown 预览太窄。
4. 左栏工作列表里 Task 太多的 Work 默认折叠一部分。

分支 `feat/w00022-t20-review-close-reading`，worktree `.worktree/w00022-t20-review-close-reading`。开发者 11-02 定本 session 不做审查。

合同：[文件格式](../../../../../packages/dev-panel/docs/file-formats.md)（提问标记、待答口径）、[命令行](../../../../../packages/dev-panel/docs/cli.md)（`ask --required`、`answers --wait`、`waiting` 字段）、[面板](../../../../../packages/dev-panel/docs/panel.md)（`POST /api/artifact-close`）。

## 决定

- **题缺省选答**：页面标记改成 `data-nbdev-required` 标必答，`ask` 改成 `--required`（`--optional` 与 `data-nbdev-optional` 还收，不起作用）。已发布的题不变，下次发布时按新标记。
- **收件箱也收选答题（我定的，开发者可改）**：原来只收必答题，默认选答之后评审板会从收件箱消失。现在的口径：必答题答了才离开；选答题在它出现之后交过一次答复就离开（看过这块板，没答的是不想答）；一次也没答的板要开发者关掉才离开。字段 `openRequired` 随之改名 `waiting`。改回只收必答的代价：改 `waitingStates` 一处，但默认选答的板就只能靠会话自己提醒。
- **关闭评审**：产物页右上角一个按钮加确认框，没答的题撤回、已答的留着。挂着的 `answers --wait` 会以退出码 0 醒来（`state: closed`），不然会话一直超时重挂。Task 的提问集不能关闭（关了就不能再 `ask`），按钮换成“撤回没答的题”。面板不提供重新打开，会话重新发布就会打开。
- **撞号不改号**：两组都已处理过，只剩旧副本：`w00007-workflow-message-only-invoke` 已改成 `w00023`（`8001b3f5a`），留在 16 处旧副本里（3 个 worktree、13 个 ref）；`w00007-desktop-supervisor-portable-fix` 只在没合入的远端分支 `origin/fix/windows-supervisor-bun`（8 月 30 日）上；`t05-preview-retirement` 已改成 `t06`，留在 10 处旧副本里。改不动那些分支的历史，所以修的是显示：只在旧副本里的撞号（`live: false`）不进收件箱、不给 `status` 警告、不列进普通输出，`--json` 的 `conflicts` 仍有完整列表。真正同时在用的撞号照旧报。
- **阅读宽度**：主题的 `--reading-measure` 是给小说正文的 34em（约 580px），面板读的是 Task 记录与文档，改用面板自己的 56em，窄时仍收到 100%。Task 页右边还有一栏，1440 宽时卡片约 710px，文档页约 790px。
- **左栏折叠**：Task 超过 8 个时，当前 Task、有题待答、有会话在动、进行中的总留着，再按编号从新到旧补到 6 个，其余收进“其余 N 个 Task”。展开状态只在本页有效。
- **收件箱计数按行**：一块 30 道题的评审算一件事，左栏与首页的数字不再是 31。

## 验证

- 类型检查、前端构建通过；dev-panel 全量结果见“当前状态”。
- 用临时副本（`/dev/shm`，含真实的 w00022、w00032 记录）起隔离的面板截图走了一遍：左栏折叠、Task 页与文档页加宽、关闭评审的确认框与关闭之后（题撤回、离开收件箱）都符合预期，页面没有报错。

未验证：真实面板（4400 还没重启）；手机宽度下的阅读页与折叠行没有截图。

## 当前状态

实现完成，待全量测试后合入。

## 下一步

合入 `master`，开发者授权后重启 4400，一起核对 t19 留下的两条未验证。
