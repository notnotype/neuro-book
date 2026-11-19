### C1 零尺寸兄弟与 0px 边界会把真实交汇端误判成自由端

**严重程度**：重要

**类别**：正确性

**位置**：wt/packages/nb-ui/src/components/layout/GridBranchRenderer.vue:50-56；wt/packages/nb-ui/src/components/layout/Splitter.vue:395-397

**现象**：外层竖线 root:0 和内层横线 inner:0 同时亮起，但横线仍没有 data-joined-start；nbook 会在真实 T 形交汇处留下 16px 断口。可达树形是 root 横排，右子分支再次横排，前面一个 0px 叶及 0px sash，后面一个竖排分支。

**为什么是问题**：childEdges 无条件用相邻索引的 sash 键覆盖继承边；这里记录 right:0，而它根本没有装饰也不可能亮起。真正同位置的 root:0 被遮掉。违反输出 22 的相交处连着。base 没有端点缩进/连接判定，这个断口由 S2 新增。

**如何核实**：已运行：在 wt/packages/nb-ui 下执行 bunx vitest run --config ../..../../../review-vitest.config.ts 并传 hover.review.test.ts 的绝对路径（准确可重跑命令见报告末尾验证记录）；1 例通过，真实 GridRenderer 与手势同时将两根线设为 active，断言横线 joined-start 缺失。仅元素矩形采用与既有测试一致的几何替身；未在浏览器中复现。浏览器复核：挂载该树形，nbook 下按交汇处，量横线左端应连到 root:0。

**建议改法**：按呈现几何传播边：零占用子节点及 0px sash 不应遮掉同位置的外层有效边界；增加这种嵌套树的连接用例。

### C2 整容器插到收起栏旁会展开来源成员，却没有把这些成员纳入平分

**严重程度**：重要

**类别**：正确性

**位置**：wt/packages/neuro-book/src/plugins/workbench/web/views/drop.ts:293-298；wt/packages/neuro-book/src/plugins/workbench/web/views/intents.ts:306-312

**现象**：来源容器有展开 C、收起 D，目标展开 A、收起 B；落在 B 前面后 A=120、C=120、D=默认 240，C/D 都展开。来源两个都收起时，三个展开成员仍全是默认 240，没有与 A 平分。

**为什么是问题**：新插入分支给 expand:true，但 sourceRatios 和 mergeContainer 的 expandedMovers 仍只认提交前展开的成员。混合来源让拖入成员合计份额超过 A 的另一半；全收起来源完全跳过分配。违反新增插入位挨着展开窗格时平分的合同。base 的半区并入不展开收起来源，因而旧的过滤在旧语义下正确；S3 将 expand 和 split 合用后失配。

**如何核实**：已运行：在 wt/packages/neuro-book 下执行 bun run /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/drop-smoke.ts，退出 0，真实 resolveDrop→applyIntent→applyPatch→buildPresentation 得到上述数值。未在浏览器中复现；浏览器将同样的两容器合组后拖到 B 前，量 A 与 C+D 的展开尺寸。

**建议改法**：插入位 expand:true 时，用放下后要展开的可见来源成员参与分配；已收起来源取保存的展开意图作比例，隐藏成员仍排除。普通展开叶的半区路径继续保留来源收起状态。

### C3 新增全收起栏的前后插入位没有进入键盘停靠点

**严重程度**：重要

**类别**：正确性／验收缺口

**位置**：wt/packages/neuro-book/src/plugins/workbench/web/views/drop-dom.ts:238-248；wt/packages/neuro-book/src/plugins/workbench/web/views/drag-session.ts:282-284

**现象**：两个视图都收成标题条后，keyboardStops 只返回容器中心一个点、axis:null；Tab 到内容区后所有方向键都不能选标题之前或标题之间，只能放到中心所在的插入位（通常末尾）。

**为什么是问题**：S3 为指针新增了多个插入位，却沿用旧的“全收起只接剩余区”键盘分支，违反输出 23 的与指针同一判定及输出 20 的前后插入。已经对照 base：这行代码原样存在，但 base 当时的合同只有一个剩余区；这里是新增行为没有迁移键盘入口，不是把旧缺陷冒充代码回归。

**如何核实**：已运行：在 wt/packages/nb-ui 下，bunx vitest run --config /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/review-vitest.config.ts /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/keyboard.review.test.ts；1 例通过，实际 reader 输出 {axis:null,points:[{x:230,y:200}]}。未在浏览器中复现；按空格拿起、Tab 到全收起目标、上下方向键和 Enter 核对是否能插到两标题之间。

**建议改法**：除空内容之外，不因全收起而把轴和成员停靠点清掉；给每条标题前后及末尾提供能被新 resolveDrop 解析的停靠点，按用户可观察插入位置补键盘用例。

### C4 并入在冲突重放中被拒绝后仍会写入面板展开

**严重程度**：重要

**类别**：不变量／竞态与时序

**位置**：wt/packages/neuro-book/src/plugins/workbench/web/state/layout-store.ts:220-239

**现象**：窗口 A 记着收起面板里的目标；窗口 B 先把目标迁到侧栏。A 再提交带 split 的并入，applyPatch 返回前提失效、视图没有移动，但 applyView 继续把 panel.collapsed 写成 false，revision 从 3 增到 4。

**为什么是问题**：opensPanel 在发起时冻结为 true；重放拿到 outcome.problem 后只记诊断、不停止额外展开写入。破坏“整条不写、unchanged、不增加 revision”的既有保存合同，也让无效拖放展开了没有接到东西的面板。base 在此处直接返回 outcome.value，因此这次意图原来会整体不写；S3 是回归。

**如何核实**：已运行：在 wt/packages/neuro-book 下，bun run /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/store-smoke.ts；退出 0，真实两个窗口、nbook.storage 与 SQLite 条件保存，revision 3→4、collapsed true→false、视图 A 无归属改动，patchProblems 说明并入没有保存；3 个内核实例均 closed。既有冲突测试没有先收起面板，所以 74 个合同测试全过仍漏掉此回归。

**建议改法**：把展开/显示补丁与归属补丁放进同一个可拒绝的应用边界；outcome.problem 非空时返回原值，不再追加展开或 reveal。补在现有“前提不成立整条不写”的双窗口用例中。

### C5 ≡ 的分组把所有命令迁入了不能用方向键操作的子菜单

**严重程度**：重要

**类别**：正确性／无障碍

**位置**：wt/packages/neuro-book/src/plugins/workbench/web/components/WorkbenchTitleBar.vue:163-167；wt/packages/nb-ui/src/components/controls/Dropdown.vue:215-225；wt/packages/nb-ui/src/components/controls/MenuNodes.vue:36-42

**现象**：按 ArrowRight 能画出“视图”等分组的子菜单，但焦点还留在父组；即使手动聚焦首个子项，ArrowDown、ArrowLeft 都不移动焦点或返回父组。新 ≡ 模式下所有命令都在这层。

**为什么是问题**：Dropdown 的手工级联只画普通按钮，不接 Reka 的菜单上下文；useMenuCascade 不搬焦点，MenuNodes 只处理父项的 ArrowRight。违反外壳输出 31 的菜单键盘漫游。base 的 compactItems 是平面叶子项，受 Reka 键盘导航保护；虽级联原语的限制本来存在，S7 首次把产品所有紧凑菜单项迁入这个不满足合同的入口，是本次消费方回归。

**如何核实**：已运行：在 wt/packages/nb-ui 下，bunx vitest run --config /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/review-vitest.config.ts /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/submenu.review.test.ts；1 例通过，真实 Dropdown 的 ArrowRight 展开后 activeElement 仍为父组，子项的 Down/Left 不响应。未在浏览器中复现；F10→打开 ≡→视图→Right→Down→Enter，核对面板命令能否执行，Left/Escape 是否逐级退回。新 e2e 只 hover 子菜单、检查可见，没有走其宣称的方向键路径。

**建议改法**：不撤回已决定的分组设计；让共享级联接完整的键盘与焦点模型，或改用 Reka 的 submenu 原语：进入首项、上下/Home/End 漫游、Left 返回、Escape 收起并归还焦点。通过实际菜单命令执行覆盖验收。

## 验证记录与边界

审查范围：`f7a0ebbb3..3004a8417`，七个提交；先用 `git log --oneline f7a0ebbb3..HEAD` 和 `git diff f7a0ebbb3..HEAD -- .` 读取完整差异，再对照 base 与合同。所有问题按发现顺序追加。未修改被跟踪文件；实验与配置在本报告同目录。

### C1 命令补正

C1 上文的相对配置路径书写有误，不是实际执行命令。实际成功执行的是以下绝对路径命令，运行目录为 `wt/packages/nb-ui`：

```sh
bunx vitest run --config /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/review-vitest.config.ts /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/hover.review.test.ts
```

此补正是 C1 的核实记录，不是新增问题。

### 受影响既有测试

在 `wt/packages/neuro-book`：

```sh
bun test ./src/plugins/workbench/web/views/drop.test.ts ./src/plugins/workbench/web/views/dnd-model.test.ts ./src/plugins/workbench/web/shell/reveal.test.ts ./src/plugins/workbench/web/state/layout-store.test.ts ./src/plugins/workbench/web/titlebar/yield.test.ts ./src/architecture.test.ts
```

结果：6 个文件，74 pass、0 fail，493 个断言；包含依赖方向检查。

在 `wt/packages/nb-ui`：

```sh
bunx vitest run --config /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/contracts-vitest.config.ts src/components/controls/tabs-adapt.test.ts src/components/layout/DropFeedbackOverlay.test.ts src/components/layout/GridRenderer.test.ts src/components/layout/splitter.test.ts ../neuro-book/src/plugins/workbench/web/components/WorkbenchShellParts.dom.test.ts ../neuro-book/src/plugins/workbench/web/components/WorkbenchTitleBar.dom.test.ts
```

结果：6 个文件，112 passed。使用本报告目录的 `cacheDir`；配置把符号链接依赖与 `nbook` 别名定向到当前审查 worktree，组件源码不是另一个 worktree 的副本。

两个包各执行 `bun run typecheck`，均退出 0：

- `wt/packages/neuro-book`：`tsc --noEmit && vue-tsc --noEmit -p tsconfig.web.json && vue-tsc --noEmit -p tsconfig.browser-test.json`。
- `wt/packages/nb-ui`：`nuxt prepare playground && vue-tsc --noEmit && vue-tsc --noEmit -p playground`；包脚本自动生成了 `playground/.nuxt` 类型。

### 实验与未运行项

- C1、C3、C5：各 1 个 Vitest 实验通过，断言当前缺陷确实存在，不是修复后通过的回归测试。
- C2：`drop-smoke.ts`，真实纯模型链，退出 0。
- C4：`store-smoke.ts`，真实内核、双窗口、Storage 和 SQLite 保存，退出 0；最终三个实例均 `closed`。
- 第一次临时 Vitest 配置运行在 setup 阶段失败：符号链接依赖被转换成外部 `/@fs/.../neuro-book-test-support/src/vitest.ts` 路径；第二次因 `require.resolve("vitest")` 命中 CommonJS 入口失败。修正仅发生在报告目录的配置中，未将这两次失败当作产品缺陷。键盘实验首次缺少 `nbook` 别名同样是临时配置失败，补别名后只重跑该实验并通过。
- 未启动子代理；未运行 e2e、开发服务、构建、安装或真实浏览器。所有像素绘制、实际 ResizeObserver 布局时序、主题四组合与端到端动画仍未在浏览器中复现；各条已列浏览器复核方法。
- e2e 里的收尾采样在短暂覆盖层上每 20ms 轮询，标题栏/标签带的宽度循环也没有直接等待对应测量档位稳定；本次未运行 e2e，不能把静态时序风险报成已复现的随机失败。

### 基线项与不计入本次的问题

- 已知 `settings/commands.test.ts` 的“项目层覆盖着主题时……”失败：依照任务说明接受为 base 已有，未重新运行。
- 标签字号 `text-[var(--text-xs)]` 的编译问题：依照任务说明排除。
- `DropFeedbackOverlay.test.ts:75-79` 的 `vi.stubGlobal`/`vi.spyOn` 测量替身在 base 已存在，本次 diff 没有新增；不作为本次回归计数。
- nb-ui 原语手工级联的键盘限制在 base 已存在；本次计入的是 S7 将原来可键盘操作的平面命令迁入该限制入口的消费方回归（C5），不重复报告原语旧问题。

## 各级数量

| 严重程度 | 数量 | 编号 |
| --- | ---: | --- |
| 阻断 | 0 | 无 |
| 重要 | 5 | C1、C2、C3、C4、C5 |
| 建议 | 0 | 无 |
| 合计 | 5 | C1–C5 |

### 标题数量自查

实际执行：

```sh
grep -c '^### C' /tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/report.md
```

结果为 `6`：五个问题标题（C1–C5），另一个是验证记录中的“C1 命令补正”，不是第六个问题。该补正标题误用了 C 前缀；遵守报告只追加的限制，没有回改已写内容。严重程度统计按五个唯一问题计算：阻断 0、重要 5、建议 0。
