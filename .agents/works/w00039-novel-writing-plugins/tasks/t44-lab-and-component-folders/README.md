---
schema: nbook.task/v2
taskId: t44-lab-and-component-folders
status: done
updated: 2026-11-27
---

# Lab 与组件目录的整理（开发者 11-26 第 3 条）

## 目标与范围

canon 的组件按区域分子目录、Lab 左栏跟着目录分组；场景一个状态一个（ConfirmBar 砍到 4 个左右）；场景登记按插件拆开、放进各插件自己的目录；规则写进 Lab 的场景说明与组件规范。开发者 2026-11-26 在 t43 里同意，计划把它拆成单独的 Task，t43 之后做

合同：[`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md)（输入边界那一句：场景登记的位置）；产品界面的行为合同不变（组件只换目录）。规则改 [`fixtures/README.md`](../../../../../packages/neuro-book/src/plugins/lab/web/fixtures/README.md) 与 [组件规范](../../../../../docs/standards/code/components.md)。

## 当前状态

2026-11-26 经 nbdev 新建。2026-11-27 开发者定 t45 之后先做它；[plan.md](plan.md) 第 1 稿已写。开发者 2026-11-27 答“要开发者定的”三条，都按推荐：

1. 场景放各插件自己的 `web/lab/`（架构测试开一个口子，只许引 Lab 的 `scene-kit`）。
2. canon 的组件按计划的六组分子目录。
3. `ConfirmBar` 留 5 个场景；这次只精简 canon 的场景，别的插件以后改到哪个组件再照规则收。

设计审查（前端，Claude Sonnet）：15 条（阻断 1、重要 7、建议 7），全部成立。按[处理记录](evidences/design-review-resolution.txt)改成[计划](plan.md)第 2 稿：

- 写清开发代码进入产品插件目录的四处边界：架构测试三条规则、Tailwind 排除、产物标记、门禁扫描根。
- 写清共用支持模块与辅助件的归属。
- 旧路径给草稿 worktree 留再导出。
- 拆总表与挪文件改成可重跑的脚本，应对与 w00055 的冲突。
- 场景快照改为全量 JSON。

“一个状态一个场景”写成“模板里每个分支至少一个场景走到”。照它重选 `ConfirmBar`，是 6 个，开发者批的是 5 个，交付时说明。

工作位置：worktree `.worktree/w00039-novel-writing-plugins`，分支 `feat/w00039-t44-lab-and-component-folders`（从 master `1e60d53ba` 开）。

实施进展：

- S1（master `68971d736`）：做了以下几件事。
  - `define.ts` 收场景类型。`defineLabFixture` 与收集时核对登记形状，错误以 `nb-lab:` 开头，这也是产物门禁的标记。
  - 新增 `scene-kit.ts`。总表用 glob 收 `plugins/*/web/lab/fixtures.ts`。
  - 架构测试加三条规则，各带正反例。
  - `tailwind.product.css` 排除 `plugins/*/web/lab`。Tailwind 4.3.3 认通配，变异确认：去掉这一行时场景里的探针类进了产物 CSS。
  - 登记门禁的扫描根扩到草稿区与各插件的 `web/lab/`，并新增“每个 `web/lab/` 都有 `fixtures.ts` 且被收到”。
  - 先搬了 image-viewer、html-preview 两个插件的场景。

  验证：
  - 全量场景快照与基线逐字相同（287 个组件、1679 个场景）。
  - typecheck 通过；`bun run build`（含 `check:dist`）通过。
  - 架构测试 8 条、登记门禁 11 条通过；Lab 与两个插件的 dom 测试 64 条通过。
  - 变异检查 4 个全部被拦下：加载路径写错、导出名写错、缺 `fixtures.ts`、夹具自建定宽盒子。
  - `test:affected` 在负载 30 以上时有 7 条超时，单独重跑全过。
- SDK 修正（master `d36615779`）：t43、t45 给 nb-ui 加的 `TreeSurface`、`TreeToggleOn`、`PopoverReference` 没登记进插件 SDK 的组件子路径，master 上 `sdk.test.ts` 因此失败。这次补上，并写了变更记录。同一文件里 nb-layout 的 `NestedGrid` 快照不同，来自 w00026，没动。

- S2（master `d888e2099`）：canon 的 49 个组件分进六个子目录，只挪不改内容。139 个文件（组件、同名文档、dom 测试、辅助件）按计划的路径表挪，脚本改写了 426 处引用与文档链接。场景快照逐字相同。typecheck、canon/plot/Lab 的 dom 测试 327 条与 bun 测试 552 条、`docs:check`、`governance:check` 通过。
- S3（master `eddbcb387`）：各插件的场景搬进自己的 `web/lab/`。
  - 总表 2876 行按语法树逐条拆进 21 个插件的 `fixtures.ts`，剩 Lab 自己、`src/ui/` 与各包的场景，570 行。canon 按六组分成 `*.scenes.ts` 再合成一张。
  - 116 个夹具与支持模块跟着归属走。几个插件共用的放进它模拟的那个插件，例如设置宿主进 settings、书架样本进 projects、表情包进 stickers。
  - 搬出来的 81 个文件改成只经 scene-kit 用 Lab。
  - 拆开后原来的杂烩函数 `shelfFixtures` 在八个插件里改按插件命名。
  - 给草稿 worktree 留了 7 个旧路径的再导出（见“后续”）。
  - agent 的两个夹具定宽改成 `min(…, 100%)`：搬出子目录后被“假盒子”检查查到。
  - 验证：
    - 场景快照逐字相同；typecheck、架构测试、登记门禁通过。
    - 引到被挪模块的 30 个产品测试里，`ProvidersPage` 的协议检测一条偶发失败：单独跑 3 次过 2 次，负载 30。它依赖的假远端是原样改名，归为原有的时序偶发。
- S3 后的 `lab-scenes`（临时滤掉原有的 ThemeEditor 404，跑完恢复）：
  - 第一次在负载 25 时整页加载超过 15 秒等不到就绪。探针确认没有页面错误，属于已知的冷启动怕负载。
  - 负载 13 时跑到版面比对，报出的问题大多在 11-25 的原有名单里，原名单里的 SubagentCard 因定宽改成 `min()` 不再报。
  - 名单外有两组：
    - canon 的 ComponentChecklist、AddComponentDialog、NewEntryDialog：预设按钮的焦点光晕被裁，是 t45 留下的（余地 3px，焦点环外扩 3.5px），修正 `2088b63f5`。
    - nb-agent-ui 的 AgentMessagesList、AgentMessagesSegment：w00043 t20 这两天改的会话列表带来的，与本 Task 无关。
- S4（master `89f804c0a`）：canon 的场景按“每个分支至少一个场景”精简，261 个留 209 个，ConfirmBar 14 留 6。
  - Sonnet 子代理逐个组件对模板分支出了去留表，主会话审过后多留三个基线或整页场景，输入只改了 4 处保住覆盖所必需的，见[精简表](evidences/scene-pruning.txt)。
  - 原来就没有场景走到的分支这次不补，表里列着。
  - 快照对比：正好少了表里的 52 个、改了那 4 处，其余不变。
- S5（master `db22e36d6`、`b8d78b235`、`076a06be8`）：
  - 改了这些文档：`fixtures/README.md`（场景放在哪里、scene-kit、支持模块的归属、场景数量的规则与 `-english`、`-long` 后缀）、组件规范（超过 30 个按区域分子目录）、应用 AGENTS 的 Lab 例外与登记位置、design-review 的草稿写法。
  - 搬走的夹具注释里的旧路径改了 35 处。
  - Spec 的四个文件（`ui/component-lab`、`ui/component-lab-timeline`、`workbench/commands`、`workbench/quick-open`）合入时在主工作区改。

- 实现审查（前端，Claude Sonnet，提交范围到 `75aef1ca2`）：12 条，都是建议级。按[处理记录](evidences/impl-review-resolution.txt)改了 9 条（修正 `162929a93`），主要有：
  - 架构测试拦住按目录引 `web/lab`；
  - 门禁按文件核对每条登记出自组件所属的插件；
  - scene-kit 只导出用到的名字；
  - 去掉拆分留下的函数外壳，跨插件导入统一写别名；
  - 补 `defineSubjectFixture` 的核对测试；
  - Spec 改动脚本补上 `canon/rendering.md` 的一处链接。

  没改的三条：
  - 产品测试引场景支持模块：原来就有，规则管的是产品代码。
  - EntryPicker 的分组：开发者批的表。
  - `min()` 定宽：测试规范要求的写法。
- e2e `lab` 与 `lab-nb-ui`（37 条，负载 16 到 23）：5 条失败，都卡在整页打开 Lab 等 `.lab-root` 或刷新后等就绪。单独重跑过了 3 条，剩下 `lab.e2e.ts:284`、`:308` 两条又失败。在分支起点的对照 worktree 上交替跑：起点第一轮同样失败 1 条，分支连过两轮，归为负载下的原有偶发。
- 合入前在 master 上的收口：
  - 变基后的 `lab-scenes`：名单外只多了 `EditorGroup/split`、`CodeInput/json` 各一处光晕被裁。在 master 的对照 worktree 上跑同样的 `lab-scenes` 没有这两条，单独开这两个场景两边各量 3 次都干净；场景与夹具代码又和 master 逐字相同，所以归为四个标签页并行、同一页连续切场景带来的偶发。
  - master 上还报着 canon 预设按钮的光晕被裁、SubagentCard 与 BackgroundCommandCard 的越界，本分支已经修掉。
  - 合入时在主工作区按脚本改了 Spec：`ui/component-lab`（登记门禁、产物、owner、装配与索引边界、输入边界、命令场景的位置）、`ui/component-lab-timeline`、`workbench/commands`、`workbench/quick-open`、`canon/rendering` 里的位置与链接。`docs:check` 通过。
- 变基到 master（`06c368841`）：w00055 t02、w00057、w00043 t20 先合了。
  - 纯改名的文件由 Git 跟上了内容改动。
  - 导入行的冲突保留 master 的内容、路径换成新目录。
  - 总表里 master 的 6 处改动（w00055 的标签写法）用脚本重放进 canon 的 `text.scenes.ts` 与 editor 的场景，另外两份复制出去的 `value` 小工具也换成新定义。
  - S4 与去外壳在冲突的文件上重跑了脚本，`preview-problem` 的 `problem` 换成新写法下的那句。
  - 验证：
    - 变基后的场景快照与 master 的快照相比，正好少了 52 个、改了那 4 处输入与一句 `noInput`。
    - typecheck、Lab/canon 与各插件场景的 dom 测试 324 条、架构等 bun 测试 100 条通过，只剩 master 上原有的 `NestedGrid` 快照一条（w00026）。
    - `bun run build`（含 `check:dist`）通过。

## 后续

- 删掉 `lab/web/fixtures/` 里 7 个旧路径的再导出文件（`canon-text.ts`、`canon-images.ts`、`lab-stickers.ts`、`explorer-scene/memory-files.ts`、`editor-scene/lab-editor-menus.ts`、`agent-scene/profile-samples.ts`、`agent-scene/agent-page-text.ts`）。等还在出稿的草稿 worktree（w00056 t06 等）合了 master、改成新路径之后删。

## 下一步

无。合入 master（`68971d736` 到 `71e33635f`，Spec `de0fa2aef`）；开发服务已重启。
