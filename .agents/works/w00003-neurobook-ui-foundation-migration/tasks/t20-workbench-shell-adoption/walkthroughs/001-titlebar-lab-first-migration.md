---
schema: nbook.walkthrough/v1
taskId: t20-workbench-shell-adoption
sequence: 1
role: tasker
status: completed
createdAt: 2026-09-14T11:20:00Z
---

# 试迁移沉淀：自绘标题栏（Lab 先行 → 宿主拆分）

## 这份记录是什么

批次 1「标题栏与图标栏」里标题栏那半边的执行记录。它是 t13 路线第 3 步那种**真实界面协作迁移**的第二个样本，
但形态与 t15（Agent Profile 设置页）不同：t15 迁的是一个**领域视图**，这次迁的是一个**外壳部件**——
它的数据全是平台状态（桌面 bridge、Project 列表、菜单命令），所以真正的迁移动作不是换样式，
而是**把宿主依赖从渲染里拆出去**，让 chrome 变成一个能用内存数据完整表达的受控零件。

产出：

- 零件（Lab 可挂载）：`packages/neuro-book/app/components/common/DesktopTitleBarChrome.vue` + `DesktopTitleBarChrome.md`
- 宿主（平台边界）：`packages/neuro-book/app/components/common/DesktopTitleBar.vue`（名字不变，`app/pages/index.vue` 的 titlebar 叶接线一行未动）
- Lab 场景：`packages/neuro-book/app/component-lab/fixtures/DesktopTitleBarChromeFixture.vue`，登记在 `fixtures/index.ts`
- 浏览器实测脚本（一次性，未入库）：`.local/temp/titlebar-verify.mjs`、`.local/temp/titlebar-bridge.mjs`、`.local/temp/titlebar-interactions.mjs`

## 配方（照此顺序执行）

1. **先拆宿主依赖，再谈外观。** 判据是「哪些值只有真实宿主才有」：桌面 bridge 的状态、菜单命令的派发、
   外观上报、Project 切换、`window.neuroBookDesktop` 本身、以及**菜单在组件外被点掉时的收起**——全部上移宿主。
   零件只剩 props 入、emit 出；拆分后它一次全局对象都不读，Lab 用 `data` 就能摆出全部场景。
2. **受控状态要连「谁负责收」一起交出去。** `openMenu` 做成 `v-model:open-menu` 而不是零件内部状态：
   菜单的展开是交互，**收起**却依赖页面级判定（点组件外），两者放在同一层才不会出现「零件自己监听 document」。
   这是 t13 配方第 1 条（隐藏通道归宿主）在「状态」上的同一件事。
3. **角色变量优先于配色变量。** 同一处颜色有三种可选名（配色变量 / 角色 / 字面值），迁移时按
   `--control-surface` > `--bg-input`、`--overlay-item-active` > `--bg-hover`、`--divider` > `--border-color`
   的顺序取：**角色是主题的决策面**，玻璃主题把 `--overlay-item-active` 映射成半透明叠层、把 `--divider`
   映射成 9% 灰线，直连配色变量等于把主题的意见绕过。
4. **窗口几何不进主题。** 条高 36、窗口按钮 46 满高、断点上限与量测占位宽度留在组件里并写明理由
   （同源数字在 `app/utils/workbench/layout.ts`）；z-index 也不进主题（nb-ui 明文「z-index 不是主题语义」）。
   这条与「所有取值走 token」不冲突：**能换的那部分必须能换，不能换的那部分必须说清为什么不能换。**
5. **量测盒必须与真实控件同源。** 标题栏用实测宽度决定菜单是完整档还是紧凑档，量测盒的字号/内边距写死
   就等于给「换主题后密度」埋了一个不对齐的坑：本轮把量测盒的 `12px` / `8px` 换成 `--text-xs` / `--space-4`。
6. **形态一变就清账。** 零件与宿主拆分后，原组件里的四个 computed、八个键盘处理函数、两个量测 ref
   只保留一份且只在零件里；宿主里不留「旧实现的一部分」。

## 跨组合实测（2026-09-14）

Lab（`/lab` → `common / DesktopTitleBarChrome`），主题 × 配色四组合，39 项取值逐项等于同名变量：

| 组合 | 匹配 | 证据 |
|---|---|---|
| nbook / light | 39/39 | `.local/temp/titlebar-evidence/titlebar-verify.json` |
| nbook / dark | 39/39 | 同上 |
| macos / light | 39/39 | 同上 |
| macos / dark | 39/39 | 同上 |

比较的是解析值而不是字符串：颜色经探针元素解析（`color-mix()` 也落到 `rgb()` 比），阴影/圆角同理。
覆盖条底色 `--bg-panel`、底线色 `--divider`、底线宽 `--border-w`、品牌字号/字重、菜单与搜索框的
高/圆角/字号、搜索框面 `--control-surface` 与描边 `--control-outline`、下拉的面/描边/圆角/阴影、
菜单项圆角（`--nb-popover-inner-radius` = 外圈 − 描边 − 内边距 = 5px）。

主页面（1440×900 + 桌面 bridge 桩）：同 39 项 39/39；`setAppearance("light")` 在挂载时到达 bridge；
点最小化 → `bridge.window("minimize")`；点 File → Open → `bridge.menu("file.open")`；
点组件外 → 菜单收起；Project 下拉可开（真实 8 项）；窄屏 900：品牌名隐藏、Project 上限 132px、完整菜单；
窄屏 700：搜索整块隐藏、Project 上限 92px、自动切紧凑菜单；无 bridge 态（B/S）：`titleBarCount=0`、
主区 `top=0`、活动栏 `top=6`（叶显隐由页面 `setLeafVisible` 驱动，未变）。
三个上下文控制台 error 均为 0。

Lab fixture 六场景逐条：桌面（4 菜单 + 3 窗口按钮 + Agent 可用）· 书架态（标签「书架」+ Agent 禁用）·
系统菜单（0 菜单 + 0 窗口按钮）· 窄栏（紧凑菜单 1、完整菜单 0）· 无 Agent 能力（按钮不存在）·
File 菜单展开（下拉在场景里就是打开的）；事件 tab 收到 `invoke-command file.open`、`toggle-agent-panel`、
`window-command minimize`、`select-project novels/destiny-poem`。

## 本轮踩到的坑

| 坑 | 判据 / 处理 |
| --- | --- |
| 标题栏下拉被外壳叶裁掉：DOM 在、`aria-expanded=true`、命中区在，但看不见 | **既有缺陷**，不是本轮引入（`t20` 待办 ③.3 已登记）。实测祖先链 7 层 `overflow: hidden`（titlebar 叶 → Splitter panel → … → `desktop-page-shell`），下拉 `top=35` 必被 36px 的叶裁掉；本轮定位与 z-index 一行未改（取值差分：`.desktop-title-bar__dropdown` 的 `position/top/z-index` 无变化）。修法要 Teleport 或 `position: fixed` + `getBoundingClientRect()`，且必须在真桌面壳上验证，建议独立 Task |
| `onClickOutside(组件实例 ref, …)` 过不了 `vue-tsc` | `vueuse` 的 `MaybeElement` 要求 `$emit` 是 `(event: string, …)`，强类型组件实例不满足。改成把 `$el` 提成元素 ref（`computed(() => barRef.value?.$el ?? null)`）再交给 `onClickOutside`，运行时行为不变 |
| `menus` 写 `as const` 后模板里 `findIndex((candidate) => …)` 的形参退化成 `unknown` | `as const` 把表变成「元组联合」，`flatMap` 的结果不再是统一元素类型。改成显式标注 `readonly TitleBarMenuGroup[]`（命令 id 仍按契约联合类型校验） |
| 量测盒字号与真实控件不同源（`12px` 对 `--text-xs`） | 量出来的宽度和画出来的差一截，紧凑档会在该出现的时候不出现；已改为 `var(--text-xs)` / `var(--space-4)`，与控件同源 |
| 角色变量替换带来的取值落差（1px 级） | 品牌内边距 5→4、Project 间距 5→4 / 内边距 7→6、搜索间距 7→6、状态点 5→4 与偏移 3→2（都落到 `--space-*` 刻度）；其余 33 项声明里颜色/面/线/圆角/字号/字重为**角色替换**（`--bg-input`→`--control-surface`、`--bg-hover`→`--overlay-item-active`、`--border-color`→`--divider` 一类），条高与窗口按钮宽度不变 |
| Lab 画布比窗口窄时，元素截图会覆盖到检视栏 | 不是组件问题：fixture 的画布尺寸是可配的（`nb-lab:preferences:v1` 的 `canvasWidth/canvasZoom`），拍整条时把画布设成 1280×720 + 0.5 缩放即可 |

## 顺带发现（不属于本批，未修）

- 主页面当前承载的书架子树里有 3 处引用**已无声明**的变量：`--font-serif`（`ProjectPickerHeader.vue:63`，
  有 `serif` 兜底）、`--tw-gradient-stops`（`ProjectCard.vue:89`、`ProjectCreateCoverPreview.vue:77`，
  UnoCSS 生成的是 `--un-gradient-stops`、nb-ui 的 Tailwind 产物里也没有 `--tw-*` 渐变变量，两处封面兜底
  的径向渐变实际不生效）；nb-ui `Badge.vue` 里 `--space-1-5` / `--weight-semibold` 同样无声明（有兜底值）。
- 外壳自身（`WorkbenchShell` / `WorkbenchBranch` / 活动栏 / 三个占位块 / 标题栏叶）的变量引用 100% 落在
  有声明集合内，反例 0（脚本：`.local/temp/ui-shell-audit.mjs`，声明集合 293 个变量）。

## 后续批次怎么用

- 组件迁移一律照 t13 配方 + 本记录第 1、2 条先做**宿主依赖上移**，再做主题适配；外壳部件不需要 Lab 场景之外的新验收面。
- 外壳批次的验收仍以主页面实数为准（本记录的四组合表就是模板），Lab 只补「组件本身」的那一层证据。
- 下拉裁剪属于窗口 chrome 的独立问题，谁修谁按 ③.3 的条件做（真桌面壳 + Teleport 或 fixed 定位），
  不要顺手在本批里改。
