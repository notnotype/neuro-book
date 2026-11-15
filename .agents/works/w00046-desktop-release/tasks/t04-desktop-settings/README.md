---
schema: nbook.task/v2
taskId: t04-desktop-settings
status: done
updated: 2026-11-15
---

# 桌面端专属设置：机制、界面缩放、开机自启

## 目标与范围

只在桌面版出现的设置：一套只在桌面里显示、壳能读到的配置项（机制），界面缩放（开发者 2026-11-15 举的例子），开机自启（开发者 2026-11-13）。托盘与关窗去向拆到 t13，系统通知拆到 t14（2026-11-15）。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-15：计划 r1 写成；设计审查第 1 轮 omp 6 条、Sonnet 14 条，处理见 [disposition](evidences/design-review-r1-disposition.txt)，计划改为 r2（[plan.md](plan.md)）：设置改由页面经窗口能力推给壳，壳只缓存。不开第 2 轮。
- 实施（分支 `feat/w00046-t04-desktop-settings`）：
  - 切片 1（`e99182a17`）：`windowDesktopKey`、设置分区的 `host`、`nbook.desktop` 的配置项与分区；
  - 切片 2、3（`b974acfbe`，壳的同一文件里交织，合成一次提交）：缩放（命令、Ctrl 加减与 Ctrl+滚轮、防抖写回）、壳的缓存、开机自启。
- 与计划 r2 的出入：
  - `windowDesktopKey` 总是提供，用 `available` 表示在不在壳里，没有用 `null`：能力的值不便为空；
  - 插件目录没有写 README 的惯例，计划里的插件 README 不写；
  - 缩放命令只在命令面板，不进视图菜单。
- 验证：
  - 单测（`zoom.test.ts` 用真实的配置拥有者写文件，`desktop-settings.test.ts`）、设置窗口的单测与类型检查通过；
  - e2e `desktop-settings.e2e.ts` 3 条，现有 `settings`、`editor-code-settings` 共 21 条，`desktop-frame` 8 条，全过；
  - Windows 验收 [windows-settings-r1.txt](evidences/windows-settings-r1.txt) 通过；真实键盘下快捷键能不能拦住 WebView2 自带的缩放，未验证，等开发者。
- Spec：`runtime/desktop-shell.md`（输出 13、新输出 25 到 27、场景 16、已知限制）、`runtime/browser-host.md` 输出 11、`settings/settings-window.md`（`host`）、`settings/configuration.md` 输出 22 的暂行。
- 实现审查第 1 轮：omp 5 条、Sonnet 10 条（含阻断 1：缩放命令 id 不合内置命令的命名规则、登记时被拒），处理见 [disposition](evidences/impl-review-r1-disposition.txt)，修正 `5c69a9dab`；e2e `desktop-settings` 3 条、`desktop-frame`、`settings` 共 30 条通过；Windows 复验第 2 轮通过（证据同一文件末尾）。
- 2026-11-15 快进合入 master（`5c69a9dab`），worktree 与分支已删。

## 下一步

- 请开发者在 pc-notype 上用真实键盘按一次缩放快捷键与 Ctrl+滚轮（证据末尾有启动方法）；拦不住时去掉快捷键与 Ctrl+滚轮，只留设置项与命令。
- 待确认清单里 t04 的几行等开发者追认。
