# 切片 5 实施记录：浏览器标题栏与真实主页面

Work：`.agents/works/w00003-neurobook-ui-foundation-migration`；Task：`tasks/t50-browser-titlebar`。
工作区：`.worktree/w00003-neurobook-ui-foundation-migration`（分支 `refactor/w00003-nb-ui-adoption`）；命令 cwd 逐条标注。
本文件在 Leader 复核（R1–R4 + 类型门禁）后更新为收口版。

## 一、落地文件（实现要求 1–5 对应）

| 要求 | 文件 | 关键改动 |
|---|---|---|
| 1 可见性 | `app/pages/index.vue`（`workbenchShellRef` watcher）、`app/components/common/DesktopTitleBar.vue` | 标题栏叶**两种宿主都显示**（去掉 `Boolean(bridge)` 与 chrome 上的 `v-if="bridge"`）；浏览器应用动作走页面登记回调，桌面仍走 `bridge.menu()` |
| 2 能力映射 | `app/utils/workbench-chrome.ts`、`app/pages/index.vue`（`useActiveElement` + `executeEditCommand`）、`DesktopTitleBar.vue`（capabilities 投影） | 浏览器不画 `file.quit`、`view.zoom-*`、窗口控制；`file.open` 无工作面禁用；编辑动作按真实焦点（`editor`/`native`/`none`）决定 enabled 与执行去处 |
| 3 项目打开 | `DesktopTitleBarChrome.vue`（Project 行两列）、`app/composables/useWorkbenchChrome.ts`（登记 `projectUrl`）、`index.vue`（`router.resolve(buildProjectRoute(...)).href`） | 本标签＝menuitem 按钮 → `select-project` → 既有 `handleSwitchNovel`（领域守卫 + Storage 收口不变）；新标签＝`<a target="_blank" rel="noopener noreferrer">` 标准 Project URL，当前标签不动 |
| 4 菜单行为 | `DesktopTitleBarChrome.vue` | 三份下拉层 `<Teleport to="body">` + 自算 fixed 坐标（视口余量 ≤320，面板内滚动）；outside 按节点亲缘；document 级 Escape 归还焦点；方向键跳过禁用项、跨组换锚点；紧凑菜单保留 |
| 5 几何一致 | `DesktopTitleBarChrome.vue`、`app/components/workbench/WorkbenchShell.vue` | 高度只用 `SHELL_TITLEBAR_HEIGHT` 喂出的 `--workbench-titlebar-height`；窄屏叶包装由 `flex-1` 改为 `0 0 var(--workbench-titlebar-height)` |

配套：Lab fixture 与场景（新增「浏览器（无桌面能力）」「编辑动作（焦点不在可编辑处）」）、`DesktopTitleBarChrome.md` 契约更新、ADR 0013 第 6 条一行 superseding 说明（Leader 裁定 ①）、`vitest.config.ts` include 补 `app/utils/workbench-chrome.test.ts`。

## 二、门禁命令与结果（真实命令、cwd、退出码）

| # | 命令（cwd） | 结果 |
|---|---|---|
| 1 | `bun run typecheck`（worktree 内 `packages/neuro-book`） | **exit 0**（首次 exit 2，6 处类型错误已修，见 §五.7） |
| 2 | `bun run test app/utils/workbench-chrome.test.ts app/components/common/DesktopTitleBarChrome.test.ts app/components/common/DesktopTitleBar.test.ts app/composables/useWorkbenchChrome.test.ts`（worktree 根） | exit 0，`Test Files 4 passed`，`Tests 20 passed`（util 7 / chrome 9 / host 3 / registry 1） |
| 3 | 改动前基线：同命令只跑 `app/utils/workbench-chrome.test.ts` | exit 1，`No test files found`（该文件原本不在 include，从不运行；已修） |
| 4 | `bun run migrate`（`packages/neuro-book`，隔离根 env） | exit 0，4 个 migration applied |
| 5 | `bun run migrate:application-state -- --apply`（同上） | exit 0，`status: complete` |
| 6 | hub `start t50-source-dev`：`bun scripts/cli/source-dev.ts`（cwd `packages/neuro-book`，env 见 §三） | ready，pid 54724，10.2s，端口 3511 |

未运行：`smoke:component-lab`（Leader 负责）、桌面真实宿主的 OS 级回归（见 R4）。

## 三、隔离根与端口

- State Root：`C:\Users\notnotype\AppData\Local\Temp\nbook-t50-accept\state`；Cache Root：`...\nbook-t50-accept\cache`；截图：`...\nbook-t50-accept\shots\`。
- 端口 `NUXT_PORT=PORT=3511`、`HOST=127.0.0.1`（已核空闲）；浏览器 = omp 托管 headless Chromium（独立 profile 与 origin）。**未访问/未占用/未重启 3001。**

## 四、真实浏览器验收

### 4.0 基线（第一轮已完成，仍在）

无 bridge（`window.neuroBookDesktop` 不存在）时主页面显示可用标题栏：`.desktop-title-bar` `y=0/高36`、`--workbench-titlebar-height: 36px`、标题栏叶高 36；File/Edit/View/Help 四组按能力裁剪；焦点在文本框时编辑六条除粘贴外可用、点「撤销」把输入框 `新小长名字XYZ` 改回 `新小长名字XY`（原生撤销，不是 Studio 会话）；Project 行两条路径；点新标签链接后浏览器出现独立页面并自行打开同一 Project；Escape/方向键/焦点归还；面板 `parentElement === document.body` 且在视口内。

### 4.1 R1：四主题 × 两尺寸逐组合取证

每组读数来自真机（1440×900 与 390×844 各一次；`panel` 指展开的下拉层，390 宽下为紧凑档）。可读性以计算色值判断：浅色主题标题栏文字 `rgb(87,83,75)` 对底 `rgb(255,252,245)`、深色 `rgb(195,188,176)` 对 `rgb(45,41,37)`；菜单项文字用主题 `--text-main`（浅色近似黑、深色近白）叠在 14%–68% 透底的 `--bg-panel` 磨砂层上，四组都保持可读（截图逐组核对）。

| 组合 | 视口 | `bar.y / 高度 / CSS 变量` | 标题栏底 / 文字 | 菜单面板（kind / 宽 / 视口内 / 在 body / 项数） | 截图 |
|---|---|---|---|---|---|
| nbook 浅色 | 1440×900 | 0 / 36 / 36px | `rgb(255,252,245)` / `rgb(87,83,75)` | group / 168 / 是 / 是 / 2 | `shots/combo1-nbook-light-1440.png` |
| nbook 浅色 | 390×844 | 0 / 36 / 36px | 同上 | compact / 196 / 是 / 是 / 11 | 第一轮 390 截图（紧凑菜单 + Project 菜单两张） |
| nbook 深色 | 1440×900 | 0 / 36 / 36px | `rgb(45,41,37)` / `rgb(195,188,176)` | group / 168 / 是 / 是 / 2 | `shots/combo2-nbook-dark-1440.png` |
| nbook 深色 | 390×844 | 0 / 36 / 36px | 同上 | compact / 196 / 是 / 是 / 11 | `shots/combo2-nbook-dark-390.png` |
| macOS 浅色 | 1440×900 | 0 / 36 / 36px | `rgb(255,255,255)` / `rgb(75,85,99)` | group / 168 / 是 / 是 / 2 | `shots/combo3-macos-light-1440.png` |
| macOS 浅色 | 390×844 | 0 / 36 / 36px | 同上 | compact / 196 / 是 / 是 / 11 | `shots/combo3-macos-light-390.png` |
| macOS 深色 | 1440×900 | 0 / 36 / 36px | `rgb(44,44,46)` / `rgb(212,212,216)` | group / 168 / 是 / 是 / 2 | `shots/combo4-macos-dark-1440.png` |
| macOS 深色 | 390×844 | 0 / 36 / 36px | 同上 | compact / 196 / 是 / 是 / 11 | `shots/combo4-macos-dark-390.png` |

- 标题栏文字与底的对比度（浅色 7.47:1、深色 约 5.6:1 量级）与 Project 标题（浅色 16.57:1）都在 WCAG AA 之上；长项目名在 1440 与 390 都以省略号截断。
- 截图逐组人工核对：菜单浮层压在内容之上（不被外壳裁切）、分组标题（FILE/EDIT/VIEW/HELP）与禁用项灰化可见、390 宽下紧凑菜单在视口内。
- **运行痕迹说明（诚实性）**：`combo2`/`combo4` 两张截图里出现过一次「主题保存失败：Unexpected end of JSON input」提示——它来自 R2 那次请求拦截的窗口（拦截处理器仍挂在页面上，主题保存 POST 撞上被中断的请求）。随后重新加载并再切一次主题复验：无提示、无 console 错误、无 `requestfailed`，且此前设置的主题在重载后仍是 macOS dark（说明保存已落地）。故该提示是本轮验收自身的注入痕迹，不是产品缺陷；它同时说明保存失败是**可见的**（红点提示，不静默）。

### 4.2 R2：Storage 失败仍可理解

真实制造失败：`page.setRequestInterception(true)` 后 abort 全部 `/api/storage/**` 再重载页面（隔离根、真机）。

- 被 abort 的请求：`/api/storage/project/context`、`/api/storage/user/context`、`/api/storage/user/context`、`/api/storage/project/context`。
- 页面**不崩**：`crashed: false`，标题栏仍在且高 36px，外壳与四个叶照常渲染，console 只有 3 条 `net::ERR_FAILED`，无未捕获异常。
- 失败**不静默**且**可理解**：外壳提示条（`role="status"`、aria-live polite）文案 `历史布局迁移未完成：[POST] "/api/storage/user/context": <no response> Failed to fetch`，带**重试**按钮；外壳根 `data-layout-diagnostics` 同时给出两个 scope 的失败原因（user/project context 均 `Failed to fetch`）。截图见 §4.1 之前的失败态截图（1440×900）。
- 恢复：关掉拦截重载 → 提示与诊断均清空；真实拖拽分界线一次（左栏 340 → 400）→ 仍无提示、无诊断，**提交成功**（Storage 收口在恢复后照常工作）。

### 4.3 R3：长项目名在 390 宽的菜单取证

项目名：`新小长名字X雨与茶与很远很远的最后一班地铁以及那些没能说完的话`（25 个汉字）。390×844：

- 菜单面板：宽 **358**（= `min(360, 100vw − 32)`）、left 24 / right 382、**不溢出视口**（左右都未越界）、`parentElement === document.body`、两行（我的书架 + 当前项目）。
- Project 行 label：`clientWidth 336 = scrollWidth 336`（面板内放得下，不截断），`text-overflow: ellipsis` + `white-space: nowrap` 已就位（更长的名字会截断）。
- 标题栏触发器 label：`clientWidth 46 < scrollWidth 336` → 省略号截断，`title` 属性带全名（悬停可读全文）。
- 新标签链接在窄屏同样可用（`aria-label="在新标签打开：…"`，图标按钮）。

### 4.4 R4：桌面 bridge 回归（环境限制，按记录处理）

- **已尝试**：（a）在 vitest 里 stub `window.neuroBookDesktop` 后挂载宿主 —— 不可达，因为宿主 `bridge` 计算属性先判 `import.meta.client`，而 vitest 环境没有 Nuxt 的 `import.meta.client` define（值为 undefined），bridge 恒为 undefined；（b）不引入全局 `define` 改动（会波及全仓用例，越界）；（c）改为在组件层用 props 表达桌面能力（见下）。
- **不可达原因**：本机没有真实桌面 Envelope（Electron/Tauri）宿主；`import.meta.client` 在 vitest 下为假，桌面分支的 `bridge.*` 调用链无法在单测里走到。
- **影响面**：桌面专属行为（原生菜单转发、窗口控制、桌面缩放、退出应用）在本次改动里**没有真实宿主回归**；`DesktopTitleBar` 在桌面下的 chrome 行为只由「能力已给足」这一档的组件用例覆盖。
- **这次改动如何保证桌面分支不被破坏**：
  1. 桌面命令派发路径未改语义：`bridge.onMenuCommand` 仍调同一个派发函数（原 `handleDesktopMenuCommand` 改名 `dispatchMenuCommand`，函数体只把 `quit`/`zoom*` 改成「有 bridge 才执行」、编辑动作改成按焦点路由），`quit`/`zoom*` 在桌面下依旧走 `bridge.window()` / `bridge.settings()`。
  2. 渲染菜单点击在桌面下**照旧转发给 bridge**（`invoke` 先判 `desktop` 再 `bridge.menu(command)`），只有无 bridge 时才走页面登记回调。
  3. 菜单能力模型对 `desktop: true` 有专门用例：`DesktopTitleBarChrome.test.ts`「有桌面能力时同一组菜单补回桌面动作」（退出应用与三条缩放出现）；`workbench-chrome.test.ts` 的同名映射用例覆盖 `desktop:true` 下粘贴可用。
  4. `rendererMenus` / `customWindowControls` / `connection` 三个桌面投影逻辑与状态解析（`parseDesktopStatus`）本次未改；窗口按钮命令仍原样 emit。

## 五、偏差与决策（检查点 B 复核用）

1. **Teleport 目标是 `body`**，不是主题宿主 `.novel-ide-theme`：主题变量写在 `<html>`（`app/utils/theme/theme-session.ts` 顶注），body 平级浮层照样继承；主题宿主 class 由页面 `onMounted` 才补（`index.vue:2448`），子组件先挂会让 Teleport 永久找不到目标。
2. **不用 nb-ui 的 `useAnchoredPopup`**：`packages/nb-ui/src/composables/useAnchoredPopup.ts` 只在 `open` 变真时量一次（`:66 watch(open, …)`），此后仅 window `scroll`/`resize` 重量（`:58-59`），**无重锚 API**；组间切换（ArrowLeft/Right）换锚点时 `open` 恒真 → 浮层留在旧按钮下。
3. **其余 nb-ui portal / 浮层导出的逐项排除**：`Popover`（`feedback/Popover.vue:70` 显式 `preventDefault` 掉 `close-auto-focus`＝不归还焦点；`:68` 基座自带 `p-3` 与内联背景阴影，与本文件登记的 `.nb-ui-popover-surface` + `--nb-popover-pad` 同心半径口径冲突；无菜单语义）、`Dropdown`（`controls/Dropdown.vue:28` 的 `DropdownItem` 无分组标题 / 勾选列 / 外部链接；`:39-40` 尺寸写死）、`Menubar`（`controls/Menubar.vue:68-71` 画整条 menubar 容器，会变成「标题栏里再有一条菜单栏」）、`ContextMenu`/`Tooltip`/`HoverCard`/`Dialog*`/`Drawer`/`AlertDialog`/表单选择器（语义不对）。nb-ui **没有独立 portal 原语导出**（`components/index.ts` 无 Portal 组件），`reka-ui` 也不是 `packages/neuro-book` 的依赖，产品代码直接 import reka 原语会引入未声明依赖。
4. **`useFloatingPanelLayout` 曾用后撤**：其 `clippingBounds` 沿**锚点祖先**算空间（`app/composables/useFloatingPanelLayout.ts:35-52`），而面板已 Teleport 出那条链，真机 `max-height` 被算成 `minHeight`＝**96px**（`scrollHeight 384`、`overflowY visible`）。改为本地按视口余量算 `min(320, innerHeight − top − 8)` + 面板内滚动；390×360 实测 `max-height 315px` 仍完全在视口内。
5. **outside 从宿主搬进 chrome**：面板 Teleport 后不在标题栏子树，根节点判定会把「点菜单项」当点外面；且 VueUse v14 `onClickOutside` 不接受元素 ref 数组（实测 `unrefElement` 原样返回数组 → `hasMultipleRoots` 读 `$` 抛 `TypeError`）。改为 document `pointerdown` 按节点亲缘判断。
6. **Escape 提升为 document 级**：换组时旧面板连同焦点项卸载、焦点可能落在 body，面板内 keydown 收不到 Escape。
7. **类型门禁 6 处错误与修法**（Leader 门禁发现，已 exit 0）：`workbench-chrome.ts` 缺 `DesktopMenuCommandId` 导入 → 从 `@notnotype/neuro-book-contracts/desktop` 导入（不另声明一份）；`DesktopTitleBarChrome.vue` 的 `computed` 重载 → 显式 `ComputedRef<Record<string, string | undefined>>`（空样式分支不再与索引签名冲突）；模板两处把元素当 `Ref` 传给 `invoke` → 改为 `invoke(command, event, anchor: HTMLElement | null)`；`event.currentTarget as HTMLElement`、`document.activeElement as HTMLElement`、`(activeElement as HTMLElement).isContentEditable` 等断言 → 全部改成运行时守卫（`instanceof`）与 `findIndex` 比较。
8. **`vitest.config.ts` include 漏项修复**：`app/utils/workbench-chrome.test.ts` 原本从不运行（基线 exit 1 `No test files found`）。
9. **ADR 0013 第 6 条一行 superseding 说明**（Leader 裁定 ①，依据 ADR 0021 记录开发者「浏览器标题栏优先」）；判据纪律不变：不做 UA 探测，桌面专属能力仍只由 bridge 判定。

## 七、检查点 B 返工（R1–R4）与证据

| # | 修复 | 文件 | 证据 |
|---|---|---|---|
| R1 | 编辑目标会话：焦点在标题栏（含 Teleport 出去的下拉层）里时沿用**最近一次真实可编辑焦点**，离开标题栏立刻回到「按此刻焦点判」；菜单 enabled 与执行去处共用同一份判定，执行原生命令前把焦点还给记忆元素 | 新增 `app/composables/useTitleBarEditTarget.ts`；`app/utils/workbench-chrome.ts`（`resolveEffectiveTitleBarEditTarget` / `isTitleBarFocusOwner` / `TITLE_BAR_FOCUS_SELECTOR` / contenteditable 判据）；`index.vue`（`useTitleBarEditTarget` 接线 + 执行前还焦点） | `useTitleBarEditTarget.test.ts` 2 例（含 Tab 进标题栏、面板内焦点、离开标题栏回退、Studio 档记忆）；`DesktopTitleBar.test.ts`「键盘进标题栏后 Edit 六条仍可用…」（Tab → ArrowDown → 六条可用、粘贴禁用、焦点在「撤销」、激活发 `edit.undo`）；`workbench-chrome.test.ts` 的决策函数四分支 |
| R2 | 通知视口让位跟随**标题栏是否真的在场**（不再是 bridge 标志），让位量取 `SHELL_TITLEBAR_HEIGHT` | 新增 `app/composables/useTitleBarPresent.ts`（挂载事实登记）；`DesktopTitleBar.vue`（mount/unmount 登记）；`NotificationViewport.vue`（`titlebar` prop + 行内 `top`，删掉写死的 `--desktop` 36px）；`app.vue` | `NotificationViewport.test.ts` 2 例（在场 → `top: 36px`；不在场 → 不占位；「浏览器档无 bridge 但有标题栏」同样让位） |
| R3 | 宿主直接给 `openMenu`（Lab 受控用法）时按菜单名回查触发按钮做锚点回退 | `DesktopTitleBarChrome.vue`（`anchorForOpenMenu()` + `anchorRef.value ?? anchorForOpenMenu()`） | `DesktopTitleBarChrome.test.ts`「宿主直接给 openMenu（受控用法）时，下拉层照样贴在触发按钮下方」（`openMenu: "View"` → 面板存在、`position: fixed`、`top: 6px`、`left: 8px`） |
| R4 | 分类器真实用例 | `app/utils/workbench-chrome.test.ts`（改为 jsdom 环境） | input / textarea / select / contenteditable（含 `closest` 判据）/ button / body / null；Studio 活跃优先于 activeElement（`editorFocused=true` 时三类元素都归 `editor`）；`isTitleBarFocusOwner` 对标题栏、下拉层、页面控件、body、null 的判定 |

命令与结果（cwd=worktree 根 / `packages/neuro-book`）：

- `bun run --cwd packages/neuro-book test app/utils/workbench-chrome.test.ts app/composables/useTitleBarEditTarget.test.ts app/components/common/DesktopTitleBarChrome.test.ts app/components/common/DesktopTitleBar.test.ts app/components/common/NotificationViewport.test.ts app/composables/useWorkbenchChrome.test.ts` → **exit 0，6 文件 28 用例全过**（workbench-chrome 9 / useTitleBarEditTarget 2 / DesktopTitleBarChrome 10 / DesktopTitleBar 4 / NotificationViewport 2 / useWorkbenchChrome 1）。
- `bun run typecheck`（cwd=`packages/neuro-book`）→ 见本轮收口报告（R1–R4 落盘后复跑）。
- 顺带修：`NotificationViewport.vue` 用 `computed` 但只有 Nuxt 自动导入，缺显式 `import {computed} from "vue"`（组件测试挂载即暴露）；`resolveTitleBarEditTarget` 的 contenteditable 判据改成 `isContentEditable || closest('[contenteditable]')`（后者还兜住「焦点落在 contenteditable 子节点上」）。

### 7.1 R1 / R2 真机确认（Main 开放窗口后，隔离根 + 端口 3511，跑完即停）

- **R1 键盘路径（真机）**：新建项目对话框里真实键入（`#create-book-title` = `新小标题甲末尾`）→ 焦点移到标题栏 Edit 触发按钮（与 Tab 到标题栏同一焦点状态）→ **真实按键 ArrowDown** 打开菜单：`撤销/重做/剪切/复制/全选` **全部可用**、`粘贴` 禁用（浏览器档），焦点落在「撤销」；**真实 Enter 激活后输入框值 `新小标题甲末尾` → `新小标题甲末`** —— 原生命令作用在输入框上，没有跑到 Studio 会话。
- **R2 让位（真机）**：Help → 文档 触发真实通知，通知容器 `top` 计算值 = **36px**、卡片 `top` = 52 > 标题栏 `bottom` = 36 → **不再压住标题栏右侧控件**。
- R3 的受控路径（宿主直接给 `openMenu`）在产品 UI 里没有入口（`openMenu` 只由用户交互设置），真机确认需要 Lab 场景；由组件用例覆盖（§七表格）。
- 宿主已用宿主句柄停止；`netstat` 复核 **3511 与 3001 均无监听**。

## 八、给检查点 B 的核对清单

| 合同项 | 用例 | 真机证据 |
|---|---|---|
| 无 bridge 显示可用标题栏 | `DesktopTitleBar.test.ts`「没有桌面 bridge 也画标题栏…」 | §4.0、§4.1（四主题 × 两尺寸 `y=0/36`） |
| 浏览器隐藏桌面动作 | `workbench-chrome.test.ts`「浏览器不画退出应用与桌面缩放…」 | §4.0 |
| 编辑动作按真实焦点 | 同上「编辑动作按真实焦点判断…」「浏览器不冒充粘贴能力…」 | §4.0（原生撤销作用在输入框） |
| 两条项目打开路径 | `DesktopTitleBarChrome.test.ts`「Project 列表…」+ `DesktopTitleBar.test.ts`「Project 列表两条路径各走各的…」 | §4.0、§4.3 |
| portal / outside / Escape / 焦点 / 方向键 | `DesktopTitleBarChrome.test.ts` 五条 | §4.0 |
| 几何单一来源 | `DesktopTitleBarChrome.test.ts`「标题栏高度来自产品几何常量…」 | §4.1 |
| Storage 失败可理解 | （无单测；由真机覆盖） | §4.2（提示 + 重试 + 诊断 + 恢复后提交成功） |
| 长项目名 | （无单测；由真机覆盖） | §4.3 |
| 桌面回归 | 组件用例（`desktop: true` 档） | §4.4（环境限制，按记录处理） |
