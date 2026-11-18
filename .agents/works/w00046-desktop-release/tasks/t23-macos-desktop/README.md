---
schema: nbook.task/v2
taskId: t23-macos-desktop
status: active
updated: 2026-11-18
---

# macOS 桌面版：GitHub Actions 构建并发布到 Release

## 目标与范围

用 GitHub Actions 在 Apple Silicon runner 上构建 macOS 桌面版（Electrobun，未签名），把 DMG 与更新文件补传到对应的 GitHub Release；测试由开发者在另一台机器上做

来源：开发者 2026-11-18（“发完 windows 版后，也用 github action 把 mac 的桌面也做一下 + 发版，尽力而为，自己先决定；不用你测试，有人在另一台机器上测试”）。

合同：行为合同没有改：[`runtime.desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 的“目标与非目标”写着第一版只有 Windows；macOS 版是尽力而为的预览，真机试过、有了反馈再把 macOS 写进 Spec。

## 做法（2026-11-18，自己定的，记在待确认清单）

- 新工作流 `.github/workflows/desktop-macos.yml`，手动触发，输入版本标签与那次 Release 流水线的运行编号：
  - `inputs`（ubuntu）：取那次运行的 `npm-packages` 产物（与 Windows 版同一份应用包），按 darwin-arm64 组装载荷、打壳；
  - `build`（macos-15，Apple Silicon）：用触发提交上的桌面工程（标签之后才加的 macOS 图标与产物核对）跑 Hutch 构建，安装包改名为 `NeuroBook-macos-arm64.dmg`，另写 `SHA256SUMS-macos`；
  - `release`：把资产补传到同一个 Release，只补缺的，同名而内容不同就失败。
- 桌面工程：`electrobun.config.ts` 加 `build.mac.icons`（iconset 从 `brand/logo/06-production/desktop/macos/` 复制）；`build-variant.ts` 按平台核对产物名。
- 只做 Apple Silicon；不签名、不公证：第一次打开要在“隐私与安全性”里允许，或 `xattr -dr com.apple.quarantine /Applications/NeuroBook.app`。
- 没有 macOS 冒烟；壳里 Windows 专有的部分（自画标题栏、最小尺寸、磨砂、开机自启、桌面快捷方式）在 macOS 上都不走，窗口用系统标题栏、WKWebView。

## 当前状态

工作流合入并推送（3f90ffc11、0788a61c4）。v0.14.1 的 Release 上已有 macOS 资产（运行 44385399270），发版经过见 [release-v0.14.1](evidences/release-v0.14.1.md)。没有冒烟、没在真机试过。

## 下一步

等开发者在 Apple Silicon 真机上试的反馈（安装、第一次打开的放行、书架与工作台、关窗、更新）。
