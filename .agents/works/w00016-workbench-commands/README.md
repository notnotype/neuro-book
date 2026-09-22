---
schema: nbook.work/v1
workId: w00016-workbench-commands
issueId: i192
---

# 命令底座与 Lab 闭环

把 `docs/proposals/workbench-commands.md`（draft）推进到可运行底座：命令注册表与描述符、`when` 上下文求值、执行管线与暴露策略、最小键位分发、真实 `CodeEditorView` 命令样板，以及 S4 全局命令面板（`Ctrl/Cmd+Shift+P`，`>` 命令与 `:` 行号）在 Component Lab 的闭环。主页面接入、文件综合搜索与外部 agent 通道另行立项。

## 背景与承接

- 上游依据：`docs/proposals/workbench-commands.md`（2026-09-14 起草；2026-09-18 需求讨论修订）；关联 accepted 提案 `workbench-view-host.md` 阶段 5「命令与只读描述快照桥接」。
- 底座依赖：Storage、外壳与 descriptor 模型（`app/utils/workbench/descriptors.ts`、`app/utils/workbench-chrome.ts` 等）由 w00003（i191）落位，目前位于 `refactor/w00003-nb-ui-adoption` 分支；本批实现直接在该 worktree 的现有基线上继续。
- 2026-09-18 讨论确认：定位升级为「外部通用 agent 的 Live 操作面底座」；纯组件不参与命令系统；对外暴露策略由本 Work 设计。随后的范围收敛把本轮限定为机制底座 + 真实编辑器样板 + Lab 全局面板；`@` 符号导航与 `Ctrl/Cmd+P` 文件搜索不交付。

## 交付边界

1. 规范原位收窄：`docs/specs/workbench/commands.md` 与 `quick-open.md` 改写到本轮实际交付（六条命令、两模式面板、会话 MRU、叠层键盘），保持 `planned` 直至闭环完成。
2. 命令底座：共享 context key 登记与求值、注册表（`nbook.<domain>.<action>`、幂等/冲突/别名/释放）、描述符（`argsSchema`、`effect`、`expose`/hints、结果合同）、执行管线（白名单、参数严格校验、when、agent 暴露与只读、确认快照、单次审计）。
3. 最小键位：`parseKeybinding` + `createKeymapDispatcher`（`Mod+Shift+P` 唯一绑定），宿主唯一 window capture listener。
4. 真实样板：`CodeEditorView` 暴露行导航；四条命令（focus/undo/redo/go-to-line）经注册表执行；Lab fixture 按钮与命令同入口。
5. S4 面板：nb-ui 纯受控 `QuickInput`（portal、modal 键盘、`closed` 交接）＋ 应用 `WorkbenchCommandPalette`（`>` 搜索、`:N` 行号、MRU、失败一次性可见）。
6. 配套：Lab 右侧 inspect 新增只读命令 tab；`docs/standards/code/components.md` 扩展宿主命令契约写法；nb-ui 规范与 playground 同步。

## 非目标

- 主页面/活动栏/标题栏/桌面桥具名入口迁移；`Ctrl/Cmd+P` 文件搜索；`@` 符号导航与 TypeScript worker；持久化 MRU（会话内即可）；真实外部 agent 通道（CLI / MCP / Skill）。
- 不改变数据 authority；不引入第三方命令框架；不做用户自定义快捷键 UI。
- 高频交互流（击键、滚动、拖拽中间态）不进入命令管线。

## 任务

- `tasks/t01-command-contracts/`（leader）：规范收窄、提案/标准/nb-ui 文档同步与任务重排。
- `tasks/t02-command-runtime/`（tasker）：共享上下文、注册表/执行、最小键位、host 骨架与 LabShell 最小接线。
- `tasks/t03-code-editor-commands/`（tasker）：Monaco 行导航、四条编辑命令、fixture 按钮统一与场景扩展。
- `tasks/t04-quick-input-surface/`（tasker）：nb-ui `QuickInput` 原语、`AlertDialog.closed`、双展示入口。
- `tasks/t05-command-palette-lab/`（tasker）：全局面板、查询/匹配、命令 tab、确认闭环、叠层 ESC 修复。
- `tasks/t06-command-acceptance/`（reviewer）：行为验收与独立审查。

## 2026-09-22 主线接手提交

治理文档提交为 `b048b226`；实现（命令运行时、`QuickInput`、命令面板与 Lab 夹具）位于 w00003 分支的 `39e50767` / `565f792d`，**尚未合并 master**——该分支主应用 typecheck 有 123 条错误（见 w00003 的 `merge-readiness-2026-09-22.md`），按红分支规则未合并。
