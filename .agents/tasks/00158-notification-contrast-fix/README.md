---
schema: nbook.task/v1
taskId: 00158-notification-contrast-fix
actionIssueId: 177
worktreeId: null
branchId: null
status: completed
createdAt: 2026-08-25T17:23:13+08:00
updatedAt: 2026-08-25T17:23:13+08:00
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: bug
  routes:
    - code-review-and-quality
    - test-driven-development
    - incremental-implementation
  verification:
    required:
      - focused-test
      - regression-test
      - typecheck
      - diff-check
    notRun:
      - check: browser
        reason: 未获开发者授权启动真实页面验收；frontend.md 的 UI 变化页面证据要求按基线风险记录，见最终报告与 evidences/verification-summary.json
---

# 00158 通知卡片主题对比度修复

## 背景

Issue #177 报告通知卡片使用硬编码 Tailwind 状态色导致主题下对比度不足且对齐不一致。fork 作者提交了 PR #178（读 `themeVarsSnapshot` + `color-mix(..., #000000)` 压黑 + 固定白字），审查判定其核心验收不成立：8 套内置主题静态计算中 Dracula/warning 白字对比度仅约 1.70:1；同时该 PR 无说明地移除玻璃拟态并引入违反主题变量合同的固定黑色。

## 关联规范 / Spec

- [主题系统参考](../../../docs/specs/theme/system.md)：主题变量、内置主题、自定义主题与通知视口消费边界。

## 实现摘要

- 新增 `app/utils/theme/notification-tone.ts`：tone→状态变量三件套映射；背景为 `--status-*-bg` 与 `--bg-panel` 的 14% 合成色，前景取 `--text-main` 同源配对；`sanitizeNotificationVars` 对消费字段做语法校验，非法值逐字段回退当前明暗家族内置预设（light→sepia，dark→dark）。
- 重写 `NotificationViewport.vue`：消费净化后快照的具体色（视口在 `.novel-ide-theme` 宿主外，var() 只会命中 :root fallback）；卡片作用域发布净化后的 `--bg-hover/--text-muted/--text-main` 供嵌套 code 与关闭按钮消费；恢复 `backdrop-blur-sm`；关闭按钮补 `aria-label`/`title`。
- 新增 `notification-tone.test.ts`：8×4 WCAG AA 矩阵、tone 映射完整性、非法值回退、自定义主题补全、旧配方回归锁；扩展 `vitest.config.ts` include 收集 `app/utils/theme/**`。

## 相对已批准计划的显式偏差

1. 计划规定非法值一律回退 `themeTokens.sepia`；实现改为按 `activeThemeAppearance` 选同族预设——纯 sepia 逐字段回退在深色主题产生跨明暗混搭（catppuccin 前景 × sepia 底实测 1.28:1），无法满足计划自身的可读性目标。
2. 计划未限定自定义主题；实现后明确 AA 保证仅覆盖 8 套内置主题——自定义主题只经语法校验，病态核心色对与全 IDE 其他消费点同步退化，对比度强制属主题编辑器合同。

## 关联

- Issue：[#177](https://github.com/notnotype/neuro-book/issues/177)（本任务直接修改 master，未走 PR）
- PR：[#178](https://github.com/notnotype/neuro-book/pull/178)（fork 实现，被本任务功能上取代，处置待维护者决定）
- 提交：`47cc0f08`（fix 主提交，经 rebase 含远端 vitest 配置相邻变更自动合并）、`18ed2d55`（docs 范围声明）

## 证据

- [verification-summary.json](evidences/verification-summary.json)：命令、退出码、测试计数与残余风险。
