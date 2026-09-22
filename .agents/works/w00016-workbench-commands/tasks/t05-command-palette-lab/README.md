---
schema: nbook.task/v2
taskId: t05-command-palette-lab
role: tasker
---

# Lab 全局命令面板、查询与确认闭环

## 目标

在 LabShell 组装 S4 全局面板：`>` 命令搜索与 `:` 行号跳转、面板命令注册、命令调试 tab、agent 确认闭环。详细合同见计划 §6、§7（`local://workbench-command-foundation-plan.md`）。

## 范围

1. 新增 `app/components/workbench/WorkbenchCommandPalette.vue`（+组件文档）：受 host 状态驱动渲染 nb-ui QuickInput；不另建 registry、不碰 Storage。
2. 新增 `app/utils/workbench/command-query.ts`：`parseCommandQuery`（`>`/`:`/其余=命令）与 `matchCommandText`/`searchCommands`（子序列评分、UTF-16 range、MRU 次排序），合同见计划 §6。
3. LabShell：
   - 挂唯一全局面板实例（ViewportCanvas 外，portal body）。
   - 注册两条面板命令（open-commands/open-line）并释放；键位 mod+shift+p 走 dispatcher。
   - accept→closed→执行 的交接；`:N` 执行 go-to-line；失败在单一 `role=alert` 区域显示。
   - 会话 MRU（上限 30，去重前插）；`quick-open-visible`/编辑器能力 context 派生。
   - 确认宿主：AlertDialog 受控 + `pendingConfirmation` 闸门（window capture 首行检查，确认期间不派发面板键、不制造失败审计）。
4. 命令调试 tab：`tabItems` 加第五项、显式 `rightTab === 'commands'`/`'data'` 分支、只读展示 metadata/when 求值/expose/context/最近 200 条执行记录；`lab-preferences-store.ts` 白名单加 `commands`；`docs/specs/ui/component-lab.md` 四 tab→五 tab；`scripts/smoke/component-lab.ts` 标签断言同步。
5. ESC 叠层修复：`EditorWorkbenchCloseConfirm.vue` 与 `EditorTabBar.vue` 的 window keydown 捕获参数改为冒泡（成对改），尊重 defaultPrevented；同步两组件文档；既有 EditorTabBar 菜单测试保持。
6. `WorkbenchCommandPaletteFixture.vue` + `fixtures/index.ts` 登记（component-index 自动收录 .md+.vue）。

## 验证

```bash
bun run --cwd packages/neuro-book test -- app/utils/workbench app/component-lab app/components/editor-workbench
bun run --cwd packages/neuro-book typecheck
```

## 边界

- 不接主页面、不做文件搜索、不接真实模型/桥；不给纯组件加注册表 import。

## 依赖

t02、t03、t04。
