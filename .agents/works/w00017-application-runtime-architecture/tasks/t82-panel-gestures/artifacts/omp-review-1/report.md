# w00017 t82 只读实现审查

审查范围：`f0ae4278a..HEAD`（五个提交）。问题按发现顺序编号；每项均区分已运行证据与未在浏览器中复现的部分。

### C1 `toggleable: false` 没有约束公开的显式折叠求解入口

- **严重程度**：建议
- **类别**：正确性／公开合同
- **位置**：`wt/packages/nb-ui/src/components/layout/grid-types.ts:40-47`；`wt/packages/nb-ui/src/components/layout/sash-drag.ts:166-181`；公开导出 `wt/packages/nb-ui/src/components/layout/index.ts:11,88`。
- **现象**：`GridGestureSession.setCollapsed`、两种 session 的 Enter 路径会跳过不可显式切换的叶，但公开的 `solveSashCollapse` 仍允许按索引把同一叶折叠。实验中 editor 标记 `toggleable: false`，显式求解仍返回 `sizesPx: [0, 800]`、`collapsed: {editor: true}`、`issues: []`。
- **为什么是问题**：新增类型与 `grid.md` 承诺这类叶“只经拖动”“显式切换跳过它”；使用公开求解器实现区段按钮时合同不同于 Grid/独立 Splitter 的 Enter。本项不是现有产品 Enter 的缺陷，而是这次新增策略没有贯穿公开入口。base 没有 `toggleable` 这一合同；本次只改了 session 的候选选择，没有修改同样对外导出的显式求解器。
- **如何核实**：已运行 `bun ../gestures.ts` 的等价绝对路径命令（从 `wt/packages/neuro-book` 执行）；脚本位于 `gestures.ts`，首段直接调用真实 `solveSashCollapse`，结果如上。不需要浏览器；没有修改被跟踪文件。现有两种 session 选择路径已逐行核实，没有发现 `setCollapsed` 漏过候选过滤。
- **建议改法**：在拥有显式折叠语义的求解入口拒绝 `toggleable: false`；若这个低层 API 有意允许强制操作，应明确将其排除在策略合同外，并给按钮消费者一个遵守该策略的公开入口。

C1 命令更正：实际已运行的是 `bun /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/gestures.ts`，工作目录 `wt/packages/neuro-book`；上文 `bun ../gestures.ts` 不是可用的相对路径。

### C2 从最大化起步拖回时，面板能缩到非法尺寸，松手又被夹回最小值并丢失原偏好

- **严重程度**：重要
- **类别**：正确性／手势与保存不变量
- **位置**：`wt/packages/neuro-book/src/plugins/workbench/web/shell/layout.ts:249-250,386-395,583-592`。
- **现象**：最大化投影把 panel 分类为 `remainder`，没有给它主轴最小值或收起策略。从底部最大化起步向下拖 830px，真实 session 的预览为 editor 830px、panel 11px，补丁为 `{panelMaximized: false, panelHeight: 11}`；拖到底得到 panel 0px，仍没有 `dragCollapsed.panel: true`。四种位置都能提交 panel 0px，`grid.resizeBranches` 接纳。store 随后把尺寸夹成高 80／宽 160，面板重新弹出最小尺寸，原来的 200／320 偏好也被覆盖。
- **为什么是问题**：Spec 外壳一输出 4、7、8 要求合法展开区跟随指针，越过阈值才拖到零，拖到零不写 0；目前一场“从最大化还原”的手势可以绕过这些规则，呈现与落账后投影不一致。base 最大化时边界为 0、没有此拖动入口；本次开放边界却沿用了只适用于不可拖最大化的 panel 角色。
- **如何核实**：已从 `wt/packages/neuro-book` 运行 `bun /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/gestures.ts` 和 `bun /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/compare.ts`，使用真实投影、Grid session、原子提交入口；输出确认上述数值与四位置的合法接纳。store 的夹取路径已读代码确认。**未在浏览器中复现**；浏览器复核方式：最大化面板，再一场拖动把边界拖到底，观察松手前 0px 与松手后 80／160px 的跳变及刷新后的尺寸。
- **建议改法**：最大化只改变 editor 的收起状态，不应让 panel 丢掉展开最小值、记忆尺寸与收起意图。给最大化下的 panel 保留与普通面板相同的主轴合同，让一次拖回手势也能正确进入拖到零；补测四位置的最大化→合法展开→拖到零→反向拉回与落账后重投影。

### C3 新增编辑器最小高度使短窗口的 32px 标题头和固定 Chrome 被挤没

- **严重程度**：重要
- **类别**：正确性／布局不变量
- **位置**：`wt/packages/neuro-book/src/plugins/workbench/web/shell/layout.ts:386-387,404-408`，与 `322-328` 的约束写入共同触发。
- **现象**：降级成标题头后仍给内容节点写 editor ≥120。标题头叶虽然分配意图是 32，却没有刚性 32 约束，nb-ui 二次分配先保住 editor 的 120，把标题头挤到 22px（1440×200）或 0px（1440×170）。后者还将标题栏从 36 压到 31.03448275862069、状态栏从 22 压到 18.96551724137931；1440×100 时标题栏、状态栏与 panel 都变成 0。投影仍声称 panel 32，卡片计算与真实 Grid 几何也因此不同。
- **为什么是问题**：Spec 输出 3 固定标题栏 36、状态栏 22；输出 5 明确“退到 32px 标题头，仍不够时编辑器取非负余量”，不能为 editor 保 120 而牺牲标题头与固定栏。200px 高时框架头被裁，170px 高时面板操作全部消失。base 相同输入均保留 titlebar 36、statusbar 22、panel 32，editor 分别是 110、80、10；属于本次新增最小约束的回归。
- **如何核实**：已运行 `bun /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/compare.ts`（工作目录 `wt/packages/neuro-book`），逐个对比 base 提取的纯布局模块与 HEAD 的 `projectShell → createShellGrid → grid.layout`，结果如上。**未在浏览器中复现**；浏览器复核宽屏容器 1440×200、1440×170，检查面板标题按钮与标题／状态栏边界。
- **建议改法**：把高度降级后的内容最小值降到当前非负余量，并为固定 Chrome／32px 标题头表达与投影一致的刚性约束；不要仅在投影里减尺寸、把相互矛盾的 min 留给 Grid 再分配。补测高度低于 210px 时固定栏与标题头优先、editor 取余量，以及投影与 Grid 呈现一致。

### C4 两侧都可收起时，相同指针位置的结果取决于多收到一帧还是少收到一帧

- **严重程度**：重要
- **类别**：正确性／时序
- **位置**：`wt/packages/nb-ui/src/components/layout/sash-drag.ts:241-273`；本次引入该双侧组合的位置：`wt/packages/neuro-book/src/plugins/workbench/web/shell/layout.ts:382-395`。
- **现象**：面板初始拖到零时，底部边界一次移动 −800px，理想 editor 为 41px，已越过 120−24，但第一帧只展开 panel，停在 `{editor:120,panel:721}`；再用完全相同的 −800px 求一次才得到 `{editor:0,panel:841}` 与最大化补丁。普通展开起步先拖成最大化、再大幅反向拖到 panel 应收起的位置，也要额外一帧才收起 panel。
- **为什么是问题**：收起循环先用“另一侧仍是收起状态”的刚性上限做 `boundsFit`，拒绝本侧收起；随后才展开另一侧，却没有重判本侧。Spec `nested-grid` 输出 42 和 `grid.md` 保证几何由冻结基线加累计位移决定、相同指针位置对应相同状态。目前快速移动后立即松手和多触发一个 move 的落账结果不同。求解器两遍循环在 base 已存在，但外壳 base 只有 panel 的收起意图、没有 editor 收起，不能产生这个双侧切换；本次组合把该潜在问题变为新的产品路径。
- **如何核实**：已运行 `bun /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/gestures.ts`（工作目录 `wt/packages/neuro-book`），同一真实 session 连续两次 `update({x:0,y:-800})` 得到不同几何与不同补丁。该输入对应真实 requestAnimationFrame 合并后的大位移，不是伪造不可达状态。**未在浏览器中复现**；复核方式：先拖到零，快速拉至顶部并松手，和同位置多移动一帧的操作对比。
- **建议改法**：根据同一帧两侧的理想尺寸先求出联合收起／展开目标，再对联合 bounds 校验与一次分配；不要让同一帧的合法转换依赖旧的另一侧状态。增加两侧都带收起意图的双向跨端点测试，并断言同一位移重复输入不改变结果。

### C5 拉出后拖回原点时，零尺寸内容没有重新停放，直到松手才清掉预览状态

- **严重程度**：重要
- **类别**：正确性／可访问性与时序
- **位置**：`wt/packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShellLayout.vue:184-204,290-292`；上游空预览路径 `wt/packages/nb-ui/src/components/layout/GridRenderer.vue:112-118`。
- **现象**：最大化下的 editor 从停放区拉出 300px 后，再拖回按下点。真实 Grid session 返回 null（当前几何已回到基线），Renderer 将 editor 的高度恢复到 0px，却不发 `gesture-update`。外壳只监听非空的 update，`previewShown` 仍包含 editor，所以输入仍在 editor 叶而不是 `hidden inert` 停放区；松手的 no-change cancel 才把它搬回。拖到零的其它 Part 也有同类空预览路径。
- **为什么是问题**：Spec 输出 7、10 要求零尺寸内容停放，不可交互、不进 Tab 与读屏。这次新增 `previewShown` 脱离了 Renderer 的实际预览寿命：屏幕已回到 0px，内容仍处于可交互 DOM。base 没有提前搬出的预览集合，因此没有这种残留。
- **如何核实**：已从 `wt/packages/nb-ui` 运行 `bunx vitest run /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/preview.dom.test.ts --config /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/dom.vitest.config.ts`，2 个实验通过。实验挂真实 Shell、真实 Renderer，按仓库既有方式只注入 happy-dom 缺少的盒尺寸／矩形，发送 pointerdown→move(+300)→move(0)→pointerup；断言 move(0) 后 editor 高度 0px、输入仍位于叶，松手后回到停放区且没有 resize。初版实验的 scope 测量为 0，未开始手势，修正几何注入时机后才得到上述证据。**未在浏览器中复现**，Tab／读屏影响从非 inert 的 DOM 推断；浏览器按相同步骤，在按住指针返回原点后检查输入是否仍可进入 Tab 顺序。
- **建议改法**：把空预览／回到已发布基线也作为外壳可观察的预览清除事件，或向 slot／宿主发布包含 null 的预览状态；清除时按真实当前几何重算停放。补测拉出→原点、拉出→收起阈值内、取消与提交拒绝，而不只测单向拉出。

C2 补充真实 store 证据：已运行 `bun /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/store.ts`（`wt/packages/neuro-book`），真实内核＋SQLite 上的 `commitSizes` 将 `{panelMaximized:false,panelHeight:0}` 变为 panelHeight 80，dragCollapsed 仍为 `{}`，重投影 panel 高度 80；运行时关闭返回两条 `status: closed`。同一脚本也确认直接在 compact 中提交 `{panelMaximized:true}` 会置内存位 true，但现有产品手势入口在 compact 中不存在且提交有上下文校验，故没有把这条缺少防御检查单列为回归。

### C6 两个 Lab 外壳宿主没有接入新增 `panelMaximized` 补丁，拖动最大化／还原无法保持

- **严重程度**：重要
- **类别**：正确性／调用方合同遗漏
- **位置**：`wt/packages/neuro-book/src/plugins/lab/web/fixtures/WorkbenchShellLayoutFixture.vue:39-42`；`wt/packages/neuro-book/src/plugins/lab/web/fixtures/shell-scene/ShellViewsScene.vue:117-120`；新增补丁 `wt/packages/neuro-book/src/plugins/workbench/web/shell/layout.ts:581-586`。
- **现象**：两个 Lab fixture 的 resize 处理器只合并尺寸与 dragCollapsed，丢掉 `panelMaximized`。从普通面板拖成最大化，提交只有 `{panelMaximized:true}`，受控 `panel.maximized` 仍为 false；下一次由 fixture 回写 sizes 的重投影把 editor 展开，最大化消失。从场景里的“最大化”按钮进入最大化再往下拖，提交含 `{panelMaximized:false,panelHeight:541}`，fixture 保存高度却仍保持 maximized true，重投影又回到最大化。
- **为什么是问题**：最新版计划第 4 节明确要求现有 Lab 面板场景能直接演示三种新手势；UI 规范也把 GridRenderer 等不能独立验证的组件放在这一集成入口。产品 store 接入了新字段，两个真实 Lab 调用方却没迁移，截图不能证明该入口的交互合同。base 的 resize 补丁没有最大化字段，两个宿主原来的处理完整；是本次扩展合同漏迁移。
- **如何核实**：已逐行核对全部 `shellPatch`、`commitSizes`、`mergeShellSizePatch` 的消费者；`gestures.ts` 已实际运行并证明这两种手势的补丁形状。`mergeShellSizePatch` 只返回四个尺寸，不会间接修改 panel。上述 Lab 交互结果目前为**从代码推断，未在浏览器中复现**；复核方式是在 `WorkbenchShellLayout` 普通场景和 views 场景分别拖成最大化、按钮最大化后拖回，观察松手后几何与输入面板的 `panel.maximized`。
- **建议改法**：两个 fixture 都消费 `patch.panelMaximized`，只更新场景内 panel 的内存位，不混进尺寸偏好；对照产品 store 的呈现事实清除规则。复核同一场景三种手势的提交后状态，而不是只截静止最大化截图。

C6 补充实际 fixture 证据：已从 `wt/packages/nb-ui` 运行 `bunx vitest run /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/lab.dom.test.ts --config /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/lab.vitest.config.ts`，1 个实验通过。挂实际 `WorkbenchShellLayoutFixture`、真实 Lab 输入回写 sink 和真实手势，确认松手前 editor 300px；提交为 `{panelMaximized:false,panelHeight:541}`；场景输入只更新 panelHeight 541、maximized 仍为 true；松手后 editor 又是 0px。因此普通 fixture 的结果不再只是代码推断；浏览器视觉与 views fixture 的同类遗漏仍未复现。

## 基线问题与验证边界（不计本次新增回归）

- `wt/packages/nb-ui/src/components/layout/splitter.test.ts:362-365,681` 的 5 处 `vi.spyOn`，以及 `1126,1142` 的 fake timers 路径，在 `git show f0ae4278a:packages/nb-ui/src/components/layout/splitter.test.ts` 中已经存在。本次新增用例没有新增 mock、spy、假计时器或固定时长等待；不将这些既有测试违规算作 t82 回归。
- 预览搬回新增路径只执行 `nextTick(syncTargets)`，没有走 `TeleportMemory.capture/restore`；普通投影更新仍按两轮 tick 恢复。根据 `teleport-memory.ts` 的既有浏览器约束，拖动中搬回的内容存在滚动位置未及时恢复的风险。未运行浏览器，未把滚动丢失当作已复现问题。复核方式：滚到长内容中段→最大化／拖到零→拉出并按住指针，检查松手前、取消后、再次拉出后的 scrollTop；同时确认不抢焦点。此处的静态风险不能用本次 happy-dom 几何实验代替浏览器证据。
- 已核对 Renderer 在调用 `acceptGesture` 之前就发 `gesture-end`，外壳会先清除 previewShown、下一 tick 重同步目标；拒绝路径本身没有发现“只因为没收到 end 而残留”的问题。C5 是手势尚未结束时空预览没有通知的不同路径。
- 已运行的 `matrix.ts` 核对四位置 × 四对齐 × 隐藏 × 标题头收起 × 最大化共 128 个组合，editor 收起意图全部符合最大化可用条件；普通／最大化下两条外层宽度边界的目标与补丁重投影一致。
- 新 e2e 的 650、841、541 与紧凑 82px 都来自显式 viewport 和 Spec 固定 Chrome／1px 边界，不受字体测量支配；未确认有几何随机性。没有运行 e2e，不能据此声称真实浏览器验收通过。

## 本次需求未闭合（原症状在 base 已存在，单独记录，不计新增回归）

### C7 预览只把 Part 框搬回，首次展开的工具视图仍要等松手才加载

- **严重程度**：重要
- **类别**：测试／本次需求缺口（不是新增回归）
- **位置**：`wt/packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShellLayout.vue:184-192`；产品可见集合 `wt/packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShell.vue:180-185,438-442`；首次实例门禁 `wt/packages/neuro-book/src/plugins/workbench/web/components/WorkbenchViewInstances.vue:75-82,149-174`；新 e2e `wt/packages/neuro-book/e2e/workbench-shell.e2e.ts:345-354`。
- **现象**：保存了 panel 拖到零状态后刷新，或该视图尚未首次可见时，往外拉出到 200px，外壳 slot 已搬回可见叶，但工具视图没有实例：`shownParts` 仍按未落账的 dragCollapsed 计算为不可见，`WorkbenchViewInstances` 不触发首次加载。松手写入 dragCollapsed false 后视图才出现。已加载视图的 `ViewContext.visible` 在这个预览期间也仍为 false。
- **为什么是问题**：新增 Spec 输出 8 和本次第三个目标要求内容在拖动中出现，不只是框架占到面积。新 e2e 打开的产品页面板没有视图，只断言 `[data-shell-slot=panel]` 搬回／可见，空框就能通过，守不住真实内容。这个原症状在 base 已存在，因此不把它计为新增回归；它是本次承诺修复的行为仍有未闭合场景。
- **如何核实**：已从 `wt/packages/nb-ui` 运行 `bunx vitest run /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/lazy-preview.dom.test.ts --config /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/lab.vitest.config.ts`，修正 happy-dom 容器测量注入后 1 个实验通过。使用实际 views fixture、实际 `WorkbenchViewInstances` 与手势，确认按住指针时 panel 高 200px、slot 不在停放区，但 `test.terminal` 视图框不存在；松手后该视图框才出现且 state ready。初版未给容器宿主正尺寸，所有视图都无法建立，不能作产品证据；最终实验为容器提供正尺寸以排除该环境门禁。**未在浏览器中复现**；复核方式是在有工具视图的面板拖到零后刷新，再拉出但不松手，核对真正的视图正文与 `context.visible`。
- **建议改法**：将可见预览事实沿受控 slot／事件传给真实宿主，让 `shownParts`、首次加载和 `ViewContext.visible` 跟随当前有效几何，但不要提前写持久化的 dragCollapsed；取消恢复基线。e2e 用实际带工具视图的面板并覆盖“拖到零后刷新”的初次拉出，断言视图正文而不是外层 slot。

## 本轮实际运行的验证

命令中的绝对前缀统一为 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/`；各 C 项已经写出可原样重跑的完整命令。

| 工作目录 | 实际命令 | 结果 |
|---|---|---|
| `wt/packages/neuro-book` | `bun test ./src/plugins/workbench/web/shell/layout.test.ts ./src/plugins/workbench/web/shell/cards.test.ts ./src/plugins/workbench/web/state/layout-store.test.ts ./src/architecture.test.ts` | 79 pass，0 fail，927 expect；含依赖方向门禁 |
| `wt/packages/neuro-book` | `bun run typecheck` | `tsc --noEmit && vue-tsc --noEmit -p tsconfig.web.json && vue-tsc --noEmit -p tsconfig.browser-test.json` 成功，44.98s |
| `wt/packages/nb-ui` | `bunx vitest run src/components/layout/GridRenderer.test.ts src/components/layout/splitter.test.ts src/components/layout/sash-drag.test.ts --config /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/nb-ui.vitest.config.ts` | 3 文件、98 例通过；初次运行因符号链接把 setup 解析到不可加载的 `/@fs/home/.../neuro-book-test-support/src/vitest.ts`，0 例执行；改为当前 worktree 的绝对 setup 路径后成功 |
| `wt/packages/neuro-book` | `bun /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/gestures.ts` | 真实 session 确认 C1、C2、C4；Home/End 的最大化起点另见脚本输出 |
| `wt/packages/neuro-book` | `bun /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/compare.ts` | base 与 HEAD 的短高度对照，以及四位置的从最大化拖到底提交 |
| `wt/packages/neuro-book` | `bun /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/store.ts` | 真内核／SQLite 确认 C2 落账后的 80px 与无 dragCollapsed；两实例正常关闭 |
| `wt/packages/neuro-book` | `bun /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/matrix.ts` | 128 个收起意图组合与两类外层边界往返通过 |
| `wt/packages/nb-ui` | C5 的 `preview.dom.test.ts --config .../dom.vitest.config.ts` 完整命令 | 2 个实验通过，确认零尺寸仍留可交互内容和真实还原提交 |
| `wt/packages/nb-ui` | C6 的 `lab.dom.test.ts --config .../lab.vitest.config.ts` 完整命令 | 1 个实验通过，确认实际 Lab fixture 丢还原位 |
| `wt/packages/nb-ui` | C7 的 `lazy-preview.dom.test.ts --config .../lab.vitest.config.ts` 完整命令 | 1 个实验通过，确认首次工具视图等松手才出现 |

外部实验的“通过”表示断言观察到了报告里的缺陷或校验结果，不表示这些产品行为满足验收。所有自建脚本、基线提取模块、配置、cache、SQLite 实验数据和报告都只在指定 scratch 目录；未修改 worktree 的被跟踪文件，未 commit/push/stash/切分支，未删除文件。没有启动开发服务、构建、安装依赖、e2e 或真实浏览器；未跑 nb-ui 全包 typecheck，也未把作者旧证据当成本轮验证。

## 各级数量

| 严重程度 | 数量 | 编号 |
|---|---:|---|
| 阻断 | 0 | 无 |
| 重要 | 6 | C2、C3、C4、C5、C6、C7 |
| 建议 | 1 | C1 |
| 合计 | 7 | C1–C7 |

其中 C7 是本次需求未闭合，原症状在 base 已存在，**不计新增回归**；其余 6 条是本次新增／改变的合同、入口或组合上的问题。基线测试违规和未在浏览器核实的滚动风险另列，不计 C 条数。

条数自查：已在报告所在目录运行 `grep -c '^### C' report.md`，输出 `7`，与正文 C1–C7 及上表一致。
