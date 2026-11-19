---
schema: nbook.task/v2
taskId: t18-windows-support
status: done
updated: 2026-10-24
---

# nb-story 支持 Windows

## 目标与范围

书库锁在 Windows 上用 LockFileEx，去掉 package.json 的 os 限制，在 Windows 开发机上实测命令行与 serve，发 0.1.1

合同：[`story.cli`](../../../../../docs/specs/story/cli-skill.md) 的非目标（平台）；[ADR 0031](../../../../../docs/adr/0031-nb-story-supports-windows.md) 部分取代 ADR 0029 的平台限制。

## 决定

开发者 2026-10-24 定：支持 Windows（不只是把报错说清楚）。

## 当前状态

- 起因：开发者在 Windows 上装 0.1.0 后没有 `nbstory`。Windows 开发机上 `package.json` 里有 nb-story，`node_modules` 里没有；本机 `bun add @notnotype/nb-story --os win32` 复现：Bun 打印“installed … with binaries: nbstory”，却静默跳过了 `os` 不匹配的包。t17 的“Windows 上装不上比装上后报错好”没有用 Bun 验证过。
- 实现（`6709a6b63`，合入 `Merge branch 'feat/w00024-t18-windows'`）：书库锁在 Windows 上用 `CreateFileW` 加 `LockFileEx`；`serve --open` 用 `cmd /c start`；`skill install` 的用户目录在 Windows 上取 `USERPROFILE`；去掉 `os`；nb-story 版本 0.1.1；README 写明三平台都能用。
- 验证：Linux 上 nb-story 单测 461 条、typecheck、`release:check` 通过；Windows 上的实测见 [windows-run.txt](evidences/windows-run.txt)（锁、安装、命令行、配置锁、`serve` 与服务独占都通过）。没有另做独立审查：改动集中在锁的 Windows 分支，已在真实 Windows 上逐项实测。
- 版本：只升 nb-story 到 0.1.1。发布后 master 上只有 nb-runtime 有代码改动（w00027 进行中），nb-story 没用到改动的接口，仍依赖 `^0.1.0`；是否发布 nb-runtime 的新版本由 w00027 定。

## 下一步

1. 开发者发布 0.1.1：`bun run release:publish`，确认后带 `--yes`（只会发 nb-story）；发布后在 Windows 上 `bun add -g @notnotype/nb-story` 确认 `nbstory` 在 PATH 上。
