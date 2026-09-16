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

