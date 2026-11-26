---
schema: nbook.task/v2
taskId: t23-macos-desktop
status: active
updated: 2026-11-25
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

## 第二轮：macOS 的窗口外框与应用菜单（2026-11-25，开发者说“mac 的自绘桌面标题菜单也做好”）

范围与做法（分支 `w00046-t23-macos-frame`，Spec 见 desktop-shell 输出 35 与 browser-host 输出 12）：

- **标题栏**：壳在 macOS 上用 `hiddenInset` + `trafficLightOffset {x: 8, y: 4}`，保留红绿灯；能力标记 `__nbookDesktopFrame` 的值分两种：1 页面画窗口按钮（Windows），2 红绿灯留着（macOS，`<html data-desktop-frame="native-controls">`）。页面不画按钮、不问窗口状态，标题栏左栏开头与后备标题栏左端让出 80px（`--nb-window-controls-start`）；启动页只画顶上的拖动条。工作台标题栏的逐级让位把这 80px 算进 `chrome`，搜索仍在窗口正中。
- **应用菜单**：`ApplicationMenu.setApplicationMenu` 设应用、编辑、窗口三组系统角色，补上复制粘贴等快捷键。
- **后台**：没有托盘图标；设置“留在系统托盘”在 macOS 上等于留在 Dock，`reopen` 事件（点 Dock 图标）在没有窗口时开回窗口。
- **没做**：磨砂背景、桌面快捷方式、登录项、窗口最小尺寸（需要 `NSWindow` 的 `setContentMinSize`，bun:ffi 传不了 `CGSize` 之外的结构体按值参数的保证，没真机不冒险）。

runner 取证（2026-11-25，演练 45541025302 的 macOS 作业，证据 `evidences/macos-frame-runner-1125.webp`）：新壳日志 `customFrame=2`；窗口没有系统标题栏，红绿灯在窗口左上角，垂直落在 36px 标题栏正中（窗口顶 59、灯心约 77）；菜单栏出现“NeuroBook、编辑、窗口”；书架页的内容左缘（约 40px）在红绿灯（左缘 15px、右缘约 67px）右侧，没有压住。runner 屏幕 1024×768，窗口按九成工作区取 921×612。拖动、Cmd 快捷键、Dock 重新打开、点击红绿灯仍没验过。

验证：dom 测试与 e2e 在 Linux 上用能力标记代替壳（值 2 的两条用例）；壳一侧（`desktop/src/bun/`）没有任何 macOS 上的运行证据，红绿灯的位置、留位宽度、拖动区域经 Electrobun 注入的预加载是否生效都未验证。

## 当前状态

工作流合入并推送（3f90ffc11、0788a61c4）。v0.14.1 的 Release 上已有 macOS 资产（运行 44385399270），发版经过见 [release-v0.14.1](evidences/release-v0.14.1.md)。没有冒烟、没在真机试过。

## 下一步

等开发者在 Apple Silicon 真机上试的反馈（安装、第一次打开的放行、书架与工作台、关窗、更新）。
