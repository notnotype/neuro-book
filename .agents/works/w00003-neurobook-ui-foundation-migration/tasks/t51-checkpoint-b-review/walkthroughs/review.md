# 检查点 B 独立审查：切片 5（浏览器标题栏与真实主页面）@ `a74c7fb8`

- 审查人：`CheckpointBReview`（独立复核，未照抄 t50 结论；先自行复现取证）
- 工作区：`.worktree/w00003-neurobook-ui-foundation-migration`（分支 `refactor/w00003-nb-ui-adoption`，HEAD `a74c7fb8`）
- 只读约束：未改产品代码/测试、未改 t50 目录、未 `git add`/提交/push、未碰 `packages/neuro-book/.nuxt`、未启动任何 dev server、未访问/占用/重启 3001；新增文件仅在 `tasks/t51-checkpoint-b-review/walkthroughs/`。
- 探针：`walkthroughs/probes/`（4 个，全部离线，复现命令与原始输出见 `probes/README.md`）。

## 一、结论先行

**裁定：需修复（3×P2 + 1×P3）；缺陷交回 t50 在原 Task 内闭合，修复后本 Task 追加「追加复核（修复后）」再给最终裁定。**

切片 5 的主干成立并已复核：能力映射只由宿主能力决定（无 UA 探测）、浏览器不画桌面动作、编辑动作按真实焦点分派、下拉层 Teleport 出祖先裁剪、Project 两条打开路径、标题栏高度单一来源、ADR 0013 superseding 准确、nb-ui portal 排除链成立。以下四项是本轮**独立复现**出的缺陷，均满足「改动引入 + 可复现 + 非设计取舍」：

| # | 缺陷 | 级别 | 证据 |
|---|---|---|---|
| F1 | 键盘打开 Edit 菜单时六条编辑动作**全部禁用**（可点项 0），键盘用户拿不到任何编辑动作 | P2 | 探针 P2/B：[P2/B] 键盘路径 `editTarget=none` → 撤销…全选=禁用、可点项=0；鼠标路径 5 项可用 |
| F2 | 浏览器里通知条与标题栏重叠（标题栏右侧控件被盖住且点击被吃） | P2 | 探针 P4：combo2-nbook-dark-1440 红块 y=16..83 vs 标题栏 y 0..34；代码侧 `NotificationViewport` 仅在 `desktop` 时 `top: 36px` |
| F3 | 宿主驱动展开态（Lab 场景预置 `openMenu`）面板**没有任何定位**，成为 body 下的 static 块 | P2 | 探针 P3/host：内联 `style=""`、父节点 BODY、样式表无 `position`；与 `DesktopTitleBarChrome.md` 的「自带 fixed 坐标」冲突 |
| F4 | 新增的 `resolveTitleBarEditTarget` 零测试覆盖（测试只喂手写的 `editTarget`） | P3 | `grep -rn resolveTitleBarEditTarget packages/neuro-book` 只命中定义与 `index.vue` 调用，无任何测试文件 |

明确**证伪失败**（对抗后判定声明成立，如实记录）：

| 声明 | 尝试的证伪 | 结果 |
|---|---|---|
| 编辑动作的原生去处真能撤销（实现要求 2） | 真机 Chromium 里比对 `execCommand("undo")` 与 `Ctrl+Z` | 未证伪：`queryCommandSupported("undo")=true`、`execCommand("undo")` 返回 `true` 且值回退（P1） |
| t50 §4.1 四主题底色/文字色读数 | 逐张重测截图像素 | 未证伪：四组底色全部 ±2 吻合，文字色在标题栏带内各有 26–55 匹配像素（P4） |
| ADR 0013 superseding 准确、范围只有一句 | 读 ADR 0021 `:5` 与 diff | 未证伪：ADR 0021 第 5 行的「决策来源」确实含「浏览器标题栏优先」，diff 只加一行引用 |
| nb-ui 无可用 portal 能力 | 核 `packages/nb-ui/src/components/index.ts` 全表 + 抽查 Popover/Menubar 行号 | 未证伪：无 Portal/Teleport 导出；`Popover.vue:70` 确实 `preventDefault` 掉 `close-auto-focus`、`:68` 确实自带 `p-3` 与内联背景阴影；`Menubar.vue:70` 确实画整条 menubar 容器（含自己的 border/bg/h-[36px]） |

## 二、被审文件 SHA256（`a74c7fb8`，worktree 内实测）

```
53a562f1f16bb82e8732ccf9cf7666d96fb715a632a075cfd45762688b2a1a34  app/utils/workbench-chrome.ts
fc7eb3496b1f1b6a09f5a743510bba7be2f6b760e429b6daf3dc000b3cebcbd4  app/utils/workbench-chrome.test.ts
25d1754c7791ca9a0ad21d716cf4a2bcc8557d86a9d8ec0d3c27bf9c54f07e4a  app/components/common/DesktopTitleBarChrome.vue
26b20e78e196120231d88abe1790d35ab28b8d42a4191ee6dc9772d6fe7e8b2e  app/components/common/DesktopTitleBarChrome.test.ts
cf2b3aedc5cdb0be80065abf3436d76e962d0f359a5938ff53bfda6ba345fa8a  app/components/common/DesktopTitleBarChrome.md
a6f6dbcd60b01648deb16463d07a04b6a9ea17fc0f13714131b5094261e2bd17  app/components/common/DesktopTitleBar.vue
bfc8f671b705fe2cd59ffef849a5577f75118dd5877d10546489c8876a9ff1db  app/components/common/DesktopTitleBar.test.ts
b36bf35ed7cfb04e598464eb6a67a2a872b3313daab0390ba0ca5286e3ccf300  app/composables/useWorkbenchChrome.ts
1e1f7a1ad88fb829d663ff3a96124ade8421bf1872aaeebb565a390b0a7d48f6  app/composables/useWorkbenchChrome.test.ts
259d3af938cc44e976999f016584eae16a33309c285716c6efc8ef9144044088  app/components/workbench/WorkbenchShell.vue
c55d9fa2568ca7b739683ea78b02833afa48b687d11d1b3198435bea78dad3e2  app/pages/index.vue
0aca3bfb608749fcdcb8fc3bd0e3413988c7958908b74221e3520226444aa8a6  app/component-lab/fixtures/DesktopTitleBarChromeFixture.vue
10dba5f7b4ab6d58e4065eea4291ff7f163919d4c2a2acb107ed4dd6ab31d02a  app/component-lab/fixtures/index.ts
a299d47893c244c0739ca034fcb135cd3c0357b81730ea095ece509084f77c2b  vitest.config.ts
4beba444e41b8326a76d0cf701a7a54ba3c1828ab6d1682780f3b67311e9d1c7  docs/adr/0013-desktop-envelope-distribution-and-interaction.md
bbdc9a4a41367dfadb5a72be6c12309e2d0300b4b6f20d8e235935976e80fc23  app/components/common/NotificationViewport.vue（未在补丁内，F2 的另一半）
2b15ede3454be63623cfd21413e48e0fb23c56777aea476f206cd65502c77758  app/app.vue（同上）
3e325609f84170afa188d6a52d7841e561faf46a4238dbd336d4757b6e1b5bac  app/utils/workbench/layout.ts（未在补丁内）
```

## 三、命令与退出码（本轮独立执行）

| # | 命令（cwd 均为 worktree 根） | 退出码 | 结果 |
|---|---|---|---|
| 1 | `node .agents/.../probes/p1-execCommand-undo.mjs` | **0** | 4.4s；`execCommand("undo")` 真机生效 |
| 2 | `bunx vitest run --reporter=verbose --silent false --config .agents/.../probes/vitest.probe.config.ts` | **0** | 2 files / 6 tests passed（P2 3 例 + P3 3 例） |
| 3 | `python .agents/.../probes/p4-screenshot-reading.py` | **0** | 7 张 t50 截图重测 |
| 4 | `git show a74c7fb8 --stat` / `git diff` 等只读命令 | 0 | 17 文件、+1405/−249 |

未运行（按约束）：任何 `bun run dev` / `nuxt prepare|generate|build` / `bun run typecheck`（会重建共享 `.nuxt`）、`smoke:component-lab`（需 dev server）、t50 的 4 个聚焦用例（Leader 已跑；本轮只跑自己的探针，避免与并发改动互相干扰）。

## 四、逐问题裁定（Q1–Q8）

### Q1 能力映射只由宿主能力决定 — **成立**
- 无 UA 探测：`grep -rn "userAgent|navigator.platform" app`（含 `.vue`）零命中；`desktop` 能力在页面与宿主两处都只由 `window.neuroBookDesktop` 是否存在决定（`index.vue:266`、`DesktopTitleBar.vue:23`、`app.vue:19`）。
- 浏览器隐藏桌面动作：`resolveTitleBarMenuGroups` 按 `desktopOnly` 过滤，`workbench-chrome.test.ts`「浏览器不画退出应用与桌面缩放」与 `DesktopTitleBarChrome.test.ts`「没有桌面能力时…」双向覆盖（浏览器 File=打开文件/设置、View=重新载入；桌面补回退出应用与三条缩放）。
- 未接入动作禁用且给原因：`file.open` 无工作面禁用+「请先打开一个 Project」；浏览器粘贴禁用+「改用 Ctrl+V」；搜索占位常驻 `disabled` 且带 title/aria-label；Agent 按钮 `surfaceActive` 为假时禁用+title。
- 窗口控制：`customWindowControls = status?.windowControls === "custom"`，浏览器 `status` 为 null → 不画（P3/截图 combo2 最右只有 Agent 图标，vision 复核一致）。

### Q2 编辑动作按真实焦点分派 — **部分成立（路由对，键盘路径坏，见 F1）**
- 路由判定正确：探针 P2/C 实测 Studio 持焦点时 `undo/redo→studio`、`cut/copy/select-all→native`、`paste→unavailable`；输入框持焦点时 `undo→native`（P2/B 鼠标路径）。反向冒充（把 studio undo 当所有输入框 undo）没有路径：`resolveTitleBarEditRoute` 先看 `editTarget`，`editTarget` 只来自 `resolveTitleBarEditTarget` + `studio.activeEditor`（`useMarkdownStudioController:85,237-264`，只在编辑器真持焦点时非 null）。
- 原生去处在 Chromium 真的能撤销：探针 P1 实测 `queryCommandSupported("undo")=true`、`execCommand("undo")` 返回 `true` 且值回退（t50 §4.0 的读数站得住）。
- **缺陷**：焦点只要落进标题栏（键盘打开菜单的必经之路），`editTarget` 变 `none`，Edit 六条全禁用 → 键盘用户没有编辑动作（F1）。

### Q3 菜单呈现与键盘 — **部分成立（点击路径成立；宿主驱动路径坏，见 F3）**
- Teleport 与逃裁剪成立：探针 P3/click 证明点击路径会写内联 `position: fixed` + 按锚点算的坐标；combo1 截图复核（vision）确认面板在标题栏之外压在左侧栏内容之上、没有被外壳裁切；`parentElement === document.body` 由 `DesktopTitleBarChrome.test.ts` 覆盖。
- outside 判定按节点亲缘（标题栏根或任一展开面板内算里面），Escape 提升到 document 并归还焦点给对应触发按钮：代码路径清楚，组件用例覆盖「焦点不在面板里也关」。
- 方向键：`focusableMenuItems` 跳过禁用项、跨组换锚点后 `focusPanelEdge` 重设焦点；`DesktopTitleBarChrome.test.ts` 两条键盘用例覆盖（含「不能停在禁用的粘贴上」）。
- **缺陷**：`openMenu` 由宿主直接给值时（Lab 三个场景：`openMenu: "File"|"View"|"Edit"`）没有锚点 → `panelStyle` 返回 `{}`，而 `.desktop-title-bar__dropdown` 已不再自带 `position/top/left` → 面板成为 body 下的 static 块（F3）。
- 滚动/缩放重算：只有代码证据（`window resize` + capture 阶段 `scroll` + `viewportVersion`），**没有真机复现**（列在「未验证项」）。

### Q4 项目打开两条路径 — **成立（新标签的独立 open/presence 未在本轮复现）**
- 本标签：`DesktopTitleBar` 的 `selectProject` 只发 `select-project`，页面侧仍是既有 `handleSwitchNovel`（领域守卫 + Storage 收口未改；`index.vue` 的 diff 未触及该函数），且对当前项目短路（`projectRoot !== currentProjectRoot` 才切）——`DesktopTitleBar.test.ts` 覆盖「当前 Project 不重复打开」。
- 新标签：`<a target="_blank" rel="noopener noreferrer">` + `router.resolve(buildProjectRoute(root)).href`（`/?project=…`），`buildProjectRoute` 是既有唯一构造器（`index.vue:428`），页面里已有同构先例（`openUserAssets` 同样 `router.resolve(...).href` 开新标签）。点击只 `open(null)` 收菜单，不触发任何切换（用例断言 `selected` 不变）。
- 与 Storage 的关系：新标签沿用「标准 Project URL」这条既有入口，没有用 Storage 释放替代领域守卫（本标签路径没被改动）。

### Q5 几何单一来源 — **成立（标题栏自身无第二份数值）**
- `SHELL_TITLEBAR_HEIGHT`（`layout.ts:45`）是唯一数值源：`DesktopTitleBarChrome.vue:70` 喂 `--workbench-titlebar-height`，`WorkbenchShell.vue:69` 喂同名变量给「垂直分配 + 窄屏叶包装」；CSS 里只剩 `height/flex/min-height/height(env fallback)` 引用变量（P3 抽出的 `.desktop-title-bar__dropdown` 规则也确认没有定位字面值）。
- 窄屏叶包装：`WorkbenchShell.vue:351-359`（class/style 在 `:356-357`）对 titlebar 叶单独 `flex: 0 0 var(--workbench-titlebar-height)`，其余叶 `flex-1`；`stackedLeafIds`（`WorkbenchShell.vue:283`）把 titlebar 放首位且受 `hidden` 控制。
- 全仓 `36px` 只剩两处：`layout.ts:44` 的说明注释（已过期，见非阻断观察）与 `NotificationViewport.vue:192` 的通知让位值——后者是与标题栏耦合的第二处硬编码，且只在 `desktop` 档生效（F2 的另一半）。

### Q6 断言强度 — **部分成立（存在一处真空洞 + 若干弱断言）**
- 能失败的断言：键盘遍历跳过禁用项、跨组换锚点内容与焦点、锚点父子关系、两条 Project 路径的差异（`selected` vs `href`）、能力裁剪（浏览器/桌面双向）都属「行为级」且可失败。
- 真空洞：**`resolveTitleBarEditTarget` 零覆盖**（F4）——测试只喂手写 `editTarget`，分类器写错（例如把 `contenteditable` 或 `<select>` 归错类）不会失败。
- 弱断言（非阻断，见第五节）：`DesktopTitleBarChrome.test.ts:239` 用例名声称「CSS 变量是唯一入口」，实际只断言根元素内联 style 含该变量（CSS 里再写一个 36px 也不会失败），且该用例后半段测的是 Agent 按钮禁用（与用例名无关）；`resolveTitleBarMenuPresentation` 只测 760/640 两点，没有阈值等值点（712/711）的边界例。

### Q7 证据诚实性 — **成立（色值表站得住；combo2/combo4 备注细节不准）**
- 色值表：探针 P4 逐张重测，四组「标题栏底」全部 ±2 吻合；声称的「文字色」在标题栏实带内各有 26–55 个匹配像素，与菜单标签的字量同量级 → 读数与截图一致，不是编造。
- 「combo2/combo4 提示条是拦截器残留」：**部分不准**——顶部高饱和红块只出现在 combo2 的两张（1440 与 390；外接框 y=16..83），combo4 两张都没有；报告写的是「combo2/combo4 两张截图」，文件名对不上（数量也是两处，但位置错）。同时该备注把用户引向「只是自己注入的痕迹」，而实测这条提示条**与标题栏重叠**（标题栏 y 0..35），这正是 F2 的产品侧缺口。
- 「保存失败可见不静默」：与截图一致（红点 + 文案 + × 关闭），成立。
- §4.4 桌面回归不可达的说明与代码一致（`DesktopTitleBar.test.ts` 注释、`import.meta.client` 在 vitest 为 undefined），属诚实的环境限制披露。

### Q8 ADR 与 nb-ui portal — **成立**
- ADR 0013 只加一行 superseding 说明（`docs/adr/0013-…:35`），引用 `[ADR 0021](0021-local-storage-persistence.md)`；ADR 0021 第 5 行「决策来源：…浏览器标题栏优先」确实支持该 superseding，范围只这一句，其余条目未动。
- nb-ui portal 证据链成立：`packages/nb-ui/src/components/index.ts` 无 Portal/Teleport 导出（全表核对）、`find src -iname "*portal*"` 无文件；`Popover.vue:70` `@close-auto-focus="(event) => event.preventDefault()"`、`:68` 自带 `p-3` 与内联背景/阴影（与 `.nb-ui-popover-surface` 登记冲突）、`Menubar.vue:70` 画整条 menubar 容器（自带 border/bg/`h-[36px]`/`p-1`）；`DesktopTitleBarChrome.vue` 自己的 `.desktop-title-bar__dropdown` 仍复用 `.nb-ui-popover-surface`+`.nb-ui-menu-surface` 基座（符合 nb-ui 的「新增浮层请消费此类」）。
- 未发现「存在但未使用」的可用 portal 能力；`useFloatingPanelLayout` 的撤用理由（clippingBounds 按锚点祖先算）已由 t50 记录，本轮未复测其数值。

## 五、未验证项（本轮没有证据，不能算成立）

1. 面板在**真机**滚动/缩放/换组时的坐标重算（只有代码路径证据；需要 dev server 才能复现）。
2. 新标签打开后**独立执行 open/presence**（需要真机；本轮只核到 URL 构造与「当前标签不变」的代码与用例）。
3. 桌面 bridge 真实宿主回归（本机无 Envelope；与 t50 §4.4 的限制相同）。
4. `storage.persistence` 的迁移门禁、`ui.nested-grid` 宿主行为本轮未复测（沿用 t47/t49/t44 结论，见第七节标注）。
5. 3001 上的开发者实例未被接触，故所有结论都以本 worktree 的代码与 t50 隔离根产物为准。

## 六、非阻断观察（不构成合并阻塞）

- `app/utils/workbench/layout.ts:44` 的注释仍写「`DesktopTitleBar.vue` 的 `.desktop-title-bar { height: 36px; flex: 0 0 36px }`」——补丁把该 CSS 改成变量后这句指针已过期（同一文件未在补丁内）。
- 组名用英文（File/Edit/View/Help）而项目新增的菜单项文案是中文（打开文件/设置/撤销…），且六条编辑项与禁用原因都硬编码在 `workbench-chrome.ts` 里、未走 i18n；与既有硬编码（「书架」「搜索」）同风格，但混排在同一个面板里。
- `DesktopTitleBarChrome.test.ts:239` 用例名与断言内容不符（见 Q6）。
- 菜单开着时跨断点缩放会让面板消失（`presentation` 变 compact）再变宽时又出现，且此时 `groupAnchorRef` 可能指向已卸载的旧按钮（`panelStyle` 会按全零 rect 定位）。需要「开着菜单改窗口宽度跨 720/960 档」才有影响，未复现。
- `resolveTitleBarMenuPresentation` 的边界（恰好等于所需宽度）无用例。

## 七、检查点 B：逐 capability 成熟度证据（不修改任何 Spec/ADR 状态）

| capability | 已覆盖的行为（证据） | 未覆盖的入口 | 是否仍依赖未接入路径 |
|---|---|---|---|
| `ui.workbench-shell` | 标题栏两种宿主都显示 + 高度单一来源（`SHELL_TITLEBAR_HEIGHT`，`WorkbenchShell.vue:69`、`DesktopTitleBarChrome.vue:70`、`layout.test.ts`）；能力映射（`workbench-chrome.test.ts` 7 例、`DesktopTitleBarChrome.test.ts` 9 例双向）；Project 两条打开路径（宿主 3 例 + chrome 1 例）；`DesktopTitleBar.test.ts` 3 例；t50 §4.0–§4.3 真机（四主题×两尺寸、390 长名、菜单不裁剪）；探针 P2/P3 独立复核 | 键盘编辑动作（F1 坏）；宿主驱动展开态定位（F3 坏）；真机滚动/缩放重算；窗口控制/退出应用的桌面真机回归 | 是：菜单命令最终执行依赖 `WorkbenchChromeRegistration.invokeMenuCommand` 这条页面登记（已接线，但只在浏览器路径走到）；`ui.workbench-shell` 的其余入口等价（命令 registry、Ctrl+P、搜索）明确未接入且**未伪装可用** |
| `storage.persistence` | t48 已把外壳几何接到 Storage 会话（`layout-session.ts`），t50 真机 §4.2 复核到「Storage 失败可见（`role=status` + 重试 + `data-layout-diagnostics`）、恢复后拖拽提交成功」；探针 P4 复核该失败截图里确实存在可见提示条 | 迁移门禁（`b5babea8` 之后）本轮未复测；多标签/多机器同步不在本期 | 否（消费端已接线）；但本轮未对迁移门禁做独立复现，证据来自 t49 两轮复核 |
| `ui.nested-grid` | 宿主与 Lab fixture 的既有证据来自 t44/t45（本轮未复测）；t50 只在 `WorkbenchShell.vue` 的窄屏堆叠路径上确认标题栏叶不再被 `flex-1` 拉高（代码 + P3 抽取的 CSS 证据） | 嵌套 grid 的保存格式、宿主行为本轮未复测 | 否（未在本切片改动范围内） |
| 桌面 envelope（bridge 回归限制） | 能力判定只认 bridge（无 UA 探测）；`quit`/`zoom*` 在无 bridge 时不执行（`bridge ? bridge.window("quit") : undefined`，`queueDesktopZoom` 内 `if (!bridge) return`）；组件用例覆盖 `desktop:true` 档的菜单补回 | **没有真实桌面宿主回归**（本机无 Envelope；t50 §4.4 同样披露）；窗口控制、桌面缩放、退出应用的真实执行路径未验证 | 是：桌面专属动作只由 bridge 判定，浏览器里整条不画（不是「未接入却显示可用」） |


---

# 追加复核（修复后）：R1–R4

- 被复核状态：首轮基线是 `a74c7fb8`；R1–R4 复核时是 worktree 工作树改动，复核后由实现者提交为 **`9df461e1`**
  （`fix(titlebar): keep the edit target and clear the titlebar`，同提交里也带上了我更新的探针 P2/P3/P5）。
  §8.1 的 SHA256 与 §8.2 的读数就是该提交的内容（与 `git show 9df461e1` 一致）。该提交涉及的文件：`app/app.vue`、`app/components/common/{DesktopTitleBar,DesktopTitleBarChrome,NotificationViewport}.vue(+test)`、`app/pages/index.vue`、`app/utils/workbench-chrome.ts(+test)`、新增 `app/composables/useTitleBarEditTarget.ts(+test)`、`app/composables/useTitleBarPresent.ts`。
- 复核方式：只读取证 + 我自己的探针（jsdom）+ 独立跑产品用例（`vitest`，不跑 Nuxt/不建 `.nuxt`）；**没有**启动 dev server（按 Leader 广播），真机读数沿用实现者提供值并标注来源。
- 本 Task 目录之外只读了文件，没有写入；产品代码/测试与 t50 目录未被我改动。

## 8.1 被复核文件 SHA256（工作树当前内容）

```
dff4357940885e8cdf05bdb41a75bb6e9bb9fe39e723b3c80a09a1d2d9e946ef  app/composables/useTitleBarEditTarget.ts（新）
eec6b149d19f92c638bffab677c1b39850429bad1bbe25bf633516eb20e8d203  app/composables/useTitleBarEditTarget.test.ts（新）
cc9abacd1b72f804034cfb4e220c48e37c85948c2e724daa103261592a258087  app/composables/useTitleBarPresent.ts（新）
c41e050654bf7353f387af9b84c09bb6a326240a5d02f19ea5af615675a75bd8  app/components/common/NotificationViewport.vue
ff7bdd370a99fe0a58b657b957c643b472636dd11f2c1fe8618d9c3da3436ce4  app/components/common/NotificationViewport.test.ts（新）
d885c8e2bb7f434f7a5c999f2c847ecaa3bdb773b23adb1408ee1f01db269b08  app/app.vue
fdf1201c36c5874819c96c4fd3fed64399c3fb5a4e58dff8bae7fafac0fb0315  app/utils/workbench-chrome.ts
e0e40602f4f244d5b13736c75c5de278366f429170fc15c693d55821b7a4ffb7  app/utils/workbench-chrome.test.ts
b7de652b371fce6ab6491c88b52cc8c895a8497a4e4617a6ec4e4030f60b2762  app/components/common/DesktopTitleBarChrome.vue
0eeabf2d7cd1d7b9fe3da615932401d2b50a12038f3e2c5e56bcb770cd251331  app/components/common/DesktopTitleBarChrome.test.ts
d51aee73741e5ee047d1e550cb0609dafe453e62b9afbfaead18b0fb5c78e95f  app/components/common/DesktopTitleBar.vue
0583a268a7d4b349ffdd82c78a79adc1e30bdcd8663b81f6394d6c49514fa15a  app/components/common/DesktopTitleBar.test.ts
2dfca25f2bc2304150c001f2456a12d3aa04ca7b92e47b539653d09d4ed08df3  app/pages/index.vue
```

## 8.2 本轮命令与退出码（cwd 见括号）

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | `git status --porcelain` / `git diff`（worktree 根，只读） | 0 | 见 8.1 的改动清单 |
| 2 | `bunx vitest run --reporter=verbose --silent false --config .agents/.../probes/vitest.probe.config.ts`（worktree 根） | **1** | 3 文件 10 例：9 通过、**1 例按预期失败**——`P5/R1b` 复现出残留缺陷（记忆元素已 `isConnected=false` 却仍报可编辑）；首轮同命令是 6 例全过 |
| 3 | `bunx vitest run app/utils/workbench-chrome.test.ts app/composables/useTitleBarEditTarget.test.ts app/composables/useWorkbenchChrome.test.ts app/components/common/NotificationViewport.test.ts app/components/common/DesktopTitleBarChrome.test.ts app/components/common/DesktopTitleBar.test.ts`（`packages/neuro-book`） | **0** | `Test Files 6 passed`、`Tests 28 passed`（与实现者自报的 6 文件 28 例一致） |
| 4 | 探针 P1 未重跑 | — | `execCommand` 路径本轮未改，首轮结论（Chromium 真机生效）继续有效 |
| 5 | 探针 P4 未重跑 | — | 没有新截图；R2 的真机读数由实现者提供，我离线复核的是机制与数值来源 |

## 8.3 逐条裁定（R1–R4）

### R1 编辑目标会话 — **成立（1 处残留，见 8.5-R1b）**
- 实现：新增 `useTitleBarEditTarget`（`activeElement` 可注入）+ `resolveEffectiveTitleBarEditTarget` / `isTitleBarFocusOwner`（`TITLE_BAR_FOCUS_SELECTOR = ".desktop-title-bar, [data-titlebar-menu-panel]"`），`index.vue` 改为 `titleBarEdit.target.value` 并在原生命令前 `rememberedElement?.focus()`。
- 前后差异（同一探针口径）：首轮 `[P2/B] 键盘打开菜单：editTarget=none；可点项=0` → 本轮 `[P2/B] 键盘打开菜单（焦点在触发按钮）：target=native；titleBarOwnsFocus=true；可点项=5`；`[P5/R1] 记忆元素=输入框`，`rememberedElement.focus()` 后 `document.activeElement` 就是那个输入框。
- 与首轮成果一致：Studio 档位仍走会话（`P2/C`：`edit.undo=studio`），焦点在页面普通控件时回到实时判定（`[P5/R1] 焦点移到页面普通按钮：target=none`），没有「拿记忆冒充所有输入框」的路径。
- 实现者提供的真机读数（输入框键入 → 标题栏 Edit → ArrowDown 六条可用 → Enter 后输入框被撤销）与我离线复现的机制一致；真机那一步我未复跑（无 dev server 窗口，按 Leader 约束）。

### R2 通知让位 — **成立**
- 实现：新增 `useTitleBarPresent`（模块级 ref，标题栏组件 onMounted/onBeforeUnmount 写），`app.vue` 传 `:titlebar`，`NotificationViewport` 用 `SHELL_TITLEBAR_HEIGHT` 写行内 `top`，删掉 `.notification-viewport--desktop { top: 36px }`。
- 证据：`[P5/R2] titlebar=true → 容器内联 style="top: 36px;"`（卡片首行 = 36 + 默认 offsetY 16 = 52 > 标题栏 bottom 36，不再重叠）、`titlebar=false → style=""`；源码里 `notification-viewport--desktop` 与字面 `36` 只余缓存构建产物，源码零命中；`:desktop` 这个旧 prop 只剩一个调用点已改名为 `:titlebar`。
- 与首轮缺陷对照：首轮实测截图红块 y=16..83 对标题栏 0..35；修后按同一算术应为 y=52 起，重叠消失（实现者真机读数 `容器 top=36px、卡片 top=52`）。真机那一步我未复跑。

### R3 受控路径定位 — **成立（Project 一条分支残留，见 8.5-R3p）**
- 实现：`anchorForOpenMenu()` 按 `props.openMenu` 回查 `[data-menu-button="…"]`，`panelStyle` 里 `anchorRef.value ?? anchorForOpenMenu()`。
- 证据：`[P3/host] openMenu=View → 内联 style="position: fixed; top: 6px; left: 8px; max-height: 320px;"`（父节点仍是 BODY，样式表仍不提供定位 → 坐标只来自这条回查）；点击路径不变（`[P3/click]` 同上）。产品用例也补了同名场景（`宿主直接给 openMenu（受控用法）时，下拉层照样贴在触发按钮下方`）。
- 残留：`[P3/project] openMenu="project" → 面板内联 style=""`，因为标题栏里 Project 触发按钮只有 `data-titlebar-action="project-switcher"`、没有 `data-menu-button`。

### R4 分类器覆盖 — **成立**
- 实现：`workbench-chrome.test.ts` 改 jsdom 环境，新增「编辑目标的分类只认真实焦点」（input/textarea/select/contenteditable/button/body/null + Studio 优先）与「焦点在标题栏里时沿用记忆的编辑目标」（含 `isTitleBarFocusOwner` 四种输入与 `resolveEffectiveTitleBarEditTarget` 五档）；新增 `useTitleBarEditTarget.test.ts`（2 例）、`NotificationViewport.test.ts`（2 例）。
- 独立复核：`grep -rn resolveTitleBarEditTarget` 现在命中测试文件；我独立跑 6 文件 28 例 **exit 0**。
- 附带改动核查：`resolveTitleBarEditTarget` 额外用 `closest('[contenteditable="true"], [contenteditable=""]')` 兜住子节点与不实现 `isContentEditable` 的环境——`[P2/A] jsdom 对 contenteditable 的读数：isContentEditable=undefined；closest 判据下分类=native`；全仓无 `contenteditable="plaintext-only"`（grep 零命中），故该分支无遗漏调用场景。

## 8.4 首轮成果未回归（本轮复核）

| 首轮结论 | 本轮复核方式 | 结果 |
|---|---|---|
| 能力映射只由宿主能力决定（无 UA 探测） | `workbench-chrome.ts` diff 只增 `isTitleBarFocusOwner`/`resolveEffectiveTitleBarEditTarget`/`contenteditable` 兜底，IA 表与 `desktopOnly`/`requiresSurface` 未动；`grep userAgent` 仍零命中 | 未回归 |
| 鼠标路径（`@mousedown.prevent` 保住焦点与前选区） | `DesktopTitleBarChrome.vue` 只增 `anchorForOpenMenu()`；探针 `[P2/B]` 鼠标路径 5/6 可点项、`[P3/click]` 定位不变 | 未回归 |
| Teleport 逃裁剪 + outside/Escape/方向键 | 同一文件未动相关代码；`[P3/host]` 仍 `parentElement=BODY`；产品用例 28 例含键盘遍历/Escape/outside 全过 | 未回归 |
| 几何单一来源（`SHELL_TITLEBAR_HEIGHT`） | 标题栏与 `WorkbenchShell.vue` 未改；本轮新增的让位量也取同一常量（`NotificationViewport` 不再有字面 36） | 更强 |
| 两条 Project 打开路径、能力裁剪 | `DesktopTitleBar.vue` 只增在场登记；`index.vue` 只改编辑目标接线；相关用例全过 | 未回归 |

## 8.5 本轮残留（建议与本次修复一并收口，均不阻塞合并）

1. **R1b 记忆元素卸载后仍报可编辑**（P3）：`useTitleBarEditTarget` 只在 liveTarget ≠ none 时写记忆、从不校验元素是否仍在文档里。探针实测：`input` 移出文档 → `rememberedElement.isConnected=false` → 键盘进标题栏后 `target=native`（可点项 5/6）。用户看到的是「撤销可用」但原生路线执行时 `focus()` 落在游离节点上、`execCommand` 作用不到，只会得到「当前没有可编辑的选区」提示。一行 `isConnected` 守卫即可闭合（建议块随本轮缺陷回报一并给出）。
2. **R3p `openMenu="project"` 仍无定位**（P3）：`anchorForOpenMenu()` 的回查选择器与 Project 触发按钮的属性不匹配（`data-menu-button` vs `data-titlebar-action`）。命中面只在 Lab/受控宿主（产品路径总是点击带入锚点），但与 R3 是同一缺陷的残留分支，且组件文档承诺的是「受控用法也贴着触发按钮」。

## 8.6 最终裁定

**可合并（correct）**：首轮三项 P2 与一项 P3 均已被修复，且四项修复我都独立复现成立（R1/R3 在机制层用真组件/真会话复现；R2 在组件层复现让位数与来源；R4 独立跑通 6 文件 28 例 exit 0）；首轮确认成立的主干（能力映射只由宿主能力决定、鼠标路径、Teleport 逃裁剪、几何单一来源）未回归；第一轮的「色值表诚实性」「ADR superseding 准确」「nb-ui portal 排除链」结论不受本轮改动影响。

两条 P3 残留（8.5）建议在合并前一并修掉——都是一处小改，且都属于「显示为可用但实际执行不了」这一类，与本切片「不装成可用」的判据同源；若不在本轮修，请在 t50 的 §七 或后续 Task 里显式登记为遗留，不要静默略过。

## 8.7 capability 证据表（修复轮更新）

| capability | 已覆盖的行为（证据） | 未覆盖的入口 | 是否依赖未接入路径 |
|---|---|---|---|
| `ui.workbench-shell` | 标题栏两种宿主都显示 + 高度单一来源（`SHELL_TITLEBAR_HEIGHT`）；能力映射双向用例；**编辑动作在键盘路径也可用**（R1：探针 P2/B、P5/R1a + 产品用例 28 例）；**受控展开态有定位**（R3：探针 P3/host + 产品用例） | 记忆元素卸载后的档位（R1b 残留）；`openMenu="project"` 受控路径定位（R3p 残留）；真机滚动/缩放重算；桌面真机回归 | 是：菜单命令仍经 `WorkbenchChromeRegistration.invokeMenuCommand` 落地（已接线）；命令 registry / Ctrl+P / 搜索仍未接入且未伪装可用 |
| `storage.persistence` | t48 接线的既有证据 + t50 §4.2 真机（失败可见/可重试/恢复后提交成功）未变；本轮未触及 `layout-session.ts` 与 `server/storage/**` | 迁移门禁本轮仍未复测（沿用 t49 两轮复核） | 否 |
| `ui.nested-grid` | 与本轮改动无交集（`WorkbenchShell.vue` 本轮未被改）；窄屏叶包装仍读同一常量 | 嵌套 grid 保存格式/宿主行为未复测 | 否 |
| 桌面 envelope（bridge 回归限制） | 能力判定仍只认 bridge（无 UA 探测；`quit`/`zoom*` 无 bridge 不执行）；本轮新增的在场事实（`useTitleBarPresent`）不参与桌面能力判定，不引入新的宿主假设 | 仍无真实桌面宿主回归（本机无 Envelope）；R1/R2 的真机读数由实现者在桌面/浏览器档提供，我未复跑真机 | 是（同上，且浏览器档整条不画桌面动作） |

---

# 追加复核（P3 残留收口后）

- 被复核状态：`9df461e1` 之后的工作树改动，截至复核时**尚未提交**（HEAD 已是 `8d20808d`；未提交的是
  `app/composables/useTitleBarEditTarget{,.test}.ts`、`app/components/common/DesktopTitleBarChrome.{vue,test.ts}` 四个文件）。
  §9.1 的 SHA256 对应这些工作树内容。
- 收口范围（实现者自报）：① 记忆不校验 `isConnected`；② `openMenu="project"` 受控展开无定位。

## 9.1 改动与哈希（收口后）

```
619953f0db7f3944acd1197abf6d388c39afdd300b5b0eb8672595f33132d640  app/composables/useTitleBarEditTarget.ts
dffe0bbead55713b0ee971000cf19edafb22e30995abee9c6241e30e67f06e09  app/composables/useTitleBarEditTarget.test.ts
8d5bc83bbddab06000ebe3f9119584b02d64f55a328f894fc0035a8ba69d2b0e  app/components/common/DesktopTitleBarChrome.vue
8c34212dd112558da4e69bfa4d5eca565e2df2af4c7d44fd228b49de125ff0ef  app/components/common/DesktopTitleBarChrome.test.ts
```

- ① `useTitleBarEditTarget`：写入侧加 `!element.isConnected` 守卫；读取侧新增 `rememberedFocus` computed（`entry.element.isConnected ? entry : null`），并显式 `void activeElement.value` 依赖当前焦点——因为 DOM 卸载本身不触发响应式，焦点变化才是重算时机。`target` 与 `rememberedElement` 都改读它。
- ② `DesktopTitleBarChrome.vue`：Project 触发按钮补 `data-menu-button="project"`，菜单名 → 按钮的钩子对 File/Edit/View/Help 与 `compact`/`project` 统一。

## 9.2 本轮命令与退出码

| # | 命令（cwd） | 退出码 | 结果 |
|---|---|---|---|
| 1 | `bunx vitest run --reporter=verbose --silent false --config .agents/.../probes/vitest.probe.config.ts`（worktree 根） | **0** | 3 files / **10 tests passed**（上一轮为 9 通过 + 1 失败） |
| 2 | `bunx vitest run app/utils/workbench-chrome.test.ts app/composables/useTitleBarEditTarget.test.ts app/composables/useWorkbenchChrome.test.ts app/components/common/NotificationViewport.test.ts app/components/common/DesktopTitleBarChrome.test.ts app/components/common/DesktopTitleBar.test.ts`（`packages/neuro-book`） | **0** | `Test Files 6 passed`、`Tests 29 passed`（上一轮 28，与实现者自报一致） |

## 9.3 前后差异（我自己的探针读数）

| 残留 | 上轮读数 | 本轮读数 |
|---|---|---|
| R1b 记忆元素游离 | `[P5/R1b] 记忆元素 isConnected=false；键盘进标题栏后 target=native；可点项=5` | `[P5/R1b] rememberedElement=null（isConnected=null）；键盘进标题栏后 target=none；可点项=0` |
| R3p Project 受控展开 | `[P3/project] 面板内联 style=""; 触发按钮无 data-menu-button` | `[P3/project] style="position: fixed; top: 6px; left: 8px; max-height: 320px;"；触发按钮有 data-menu-button=true` |

其余探针读数不变（`[P2/B]` 鼠标与键盘路径均 5/6 可点项；`[P3/click]`/`[P3/host]` 定位一致；`[P5/R1a]` 焦点归还输入框；`[P5/R2]` `top: 36px`、卡片首行 52）。

## 9.4 副作用核查

- 新增的 `data-menu-button="project"` 只被两处消费：`anchorForOpenMenu()`（接受任意菜单名）与 `groupTrigger(label)`（只被 `menus.value` 的组名调用，取值为 File/Edit/View/Help）——两组取值不相交，不会把 Project 按钮误当组触发按钮；产品用例 29 例全过，没有用例钉住「该按钮没有这个属性」。
- 收口没有改动首轮与修复轮已成立的部分（能力映射、鼠标路径、Teleport/outside/Escape/方向键、几何单一来源），diff 仅上述两处 + 一条注释。

## 9.5 未验证项（本轮）

- 收口后的 `bun run typecheck`：实现者按 Leader 指令中止（`nuxt prepare` 会重建共享 `.nuxt`，影响开发者正在用的 3001）。我同样不运行——**需由 Leader 在合适窗口补跑**（残留前的 typecheck 为 exit 0）。
- R1/R2 的真机读数仍由实现者提供（我无 dev server 窗口），我复核的是机制、数值来源与两条残留的消解。

## 9.6 最终裁定（收口后）

**可合并（correct）**。首轮三项 P2、一项 P3 与追加轮的两项 P3 残留全部闭合，且每一条我都独立复现（探针 10 例全过、产品用例 6 文件 29 例 exit 0）；首轮确认成立的主干未回归，收口改动没有引入新的越界（属性钩子取值不相交、无测试被反过来放宽）。合并前唯一待补的门禁是收口后的 `bun run typecheck`，因共享 `.nuxt` 约束需 Leader 侧执行。

### 9.7 台账更正与披露

- 复核期间仓库在动：我完成 §8（R1–R4 复核）时那些改动还在工作树里，之后被提交为 `9df461e1`；§9（残留收口）复核时 HEAD 已是 `8d20808d`，收口的四个文件仍未提交。两节的「被复核状态」已按此更正，读数与 SHA256 都对应各自时点的实际内容。
- 披露：`9df461e1` 里误带了一个 `probes/.vite/vitest/.../results.json`（**我**跑探针留下的 vitest 缓存，虽然我在本轮结束前已删 `probes/node_modules`，但提交发生在删除之前），已由 `8d20808d`（`chore(work): drop a probe build cache that slipped into a commit`）删除。它不影响任何结论，但读者若看到该文件不必当作证据。
