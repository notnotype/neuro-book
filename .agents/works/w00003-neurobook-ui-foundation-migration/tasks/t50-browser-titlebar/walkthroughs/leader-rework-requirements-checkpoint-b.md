# t50 返工要求（检查点 B 后）

依据：[t51 检查点 B 审查](../../t51-checkpoint-b-review/walkthroughs/review.md)（被审 revision `a74c7fb8`，裁定「需修复」）。
主干成立（能力映射只由宿主能力决定、编辑路由真机 execCommand 验证、Teleport 逃裁剪、几何单一来源、ADR 与 nb-ui portal 排除链准确），以下四项须闭合。

| # | 级别 | 要求 | 探针 |
|---|---|---|---|
| R1 | P2 | **键盘打开 Edit 菜单时六条编辑动作全部失效**。当前 `titleBarEditTarget` 只按"此刻焦点"判定：键盘要进 Edit 菜单必须先把焦点移到标题栏按钮 → `activeElement` 不再是输入框、Studio 编辑器 blur 后 `studio.activeEditor` 归空 → `editTarget="none"` → 六条全部 `unavailable`，且禁用项被排除出键盘遍历，可点项为 0。请让"打开菜单"这个动作本身不销毁目标语义：例如在菜单打开时**捕获**当时的编辑目标（含 Studio 优先判定），菜单存续期间用捕获值，关闭时清除；不得为此把 Studio 撤销冒充原生撤销，也不得让鼠标路径回退。补键盘路径用例（Tab 进标题栏 → ArrowRight 到 Edit → 六条可用且执行去处正确）。 | P2/A、B |
| R2 | P2 | **浏览器里通知条压住标题栏右侧控件**。`app.vue` 把 `desktopAvailable = Boolean(window.neuroBookDesktop)` 传给 `NotificationViewport`，后者只在 `--desktop` 档让位 36px；浏览器现在也有 36px 标题栏，于是 toast 从 y=16 起画并盖住标题栏右侧按钮（且卡片 `pointer-events-auto` 会吃掉点击）。让让位量跟随**标题栏是否真的存在**（与切片 5 同一真相源），而不是 bridge 标志。补用例断言浏览器档的让位量。 | P4 |
| R3 | P2 | **宿主直接给 `openMenu` 时下拉层没有任何定位**。`panelStyle` 在 `anchorRef === null` 时返回 `{}`，而 `.desktop-title-bar__dropdown` 已无 `position/top/left`，于是 Lab 三个场景（`fixtures/index.ts` 的 `openMenu: "File"|"View"|"Edit"`）看到的面板掉在文档末尾。请给宿主驱动路径一个真实锚点（按菜单名解析对应触发按钮）或等价定位回退，使文档承诺的"贴着触发按钮下沿、`position: fixed`"在受控路径同样成立。补用例：`openMenu="View"` 时面板具备定位且在触发按钮下方。 | P3/host |
| R4 | P3 | **`resolveTitleBarEditTarget` 零覆盖**。它是本切片判定"输入框走原生 / Studio 走会话 / 其余禁用"的唯一判据，但现有用例是把手写 `editTarget` 喂给路由表，测不到分类器。补真实分类用例：`<input>`/`<textarea>`/`<select>`/contenteditable/`document.body`/null，以及"Studio 活跃优先于 activeElement"这一步；并覆盖页面调用点用到的组合。 | P3 说明 |

## 约束

- 不回退已成立的主干；不改 nb-ui 内部；不碰 3001（开发者使用中）；不要启动第二个 dev server（共享 `.nuxt` 会摧毁 3001），需要真实浏览器时先 hub 报 Main 协调窗口或复用 3001 做只读检查。
- 不提交、不 push。
- 完成后更新 `walkthroughs/implementation.md`（逐条 R1–R4 的新证据与命令/退出码），并 `hub send` 通知 `CheckpointBReview` 做追加复核。