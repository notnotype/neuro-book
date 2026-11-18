---
schema: nbook.task/v2
taskId: t26-layout-deep-review
status: done
updated: 2026-11-18
---

# 布局工具深入审查：设计与代码质量、文档与规范、API 形状、性能

## 目标与范围

开发者 2026-11-16 试用 t25 后说“接下来没看到什么问题，可以进行一次深度审查”，重点四处：整个布局工具的设计与代码质量；文档与规范完善程度；API 形状，别人用起来顺不顺手；性能，原则是能省则省，避免不必要的样式、布局与重绘，动画帧不多绘，不超过系统刷新率上限和用户自己设的上限。

对象是 nb-layout 整包与工作台里接它的部分（拖动会话、实时布局、外壳表面、布局记录与投影），固定在提交 `954ed9e94`（t25 分支 `fix/w00026-t25-container-feedback` 的 HEAD）。nb-ui 里冻结的旧 Splitter 副本算在“重复”里看。

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md)、[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)；审查本身不改合同，修复改到哪条再写。

## 审查计划（开发者 2026-11-16 批准：“批准这个计划和预算。t25 的审查不用做了”）

- 四个审查者，都是 Claude Sonnet（`claude -p --model claude-sonnet-5-5`），只读，在固定于 `954ed9e94` 的 detached worktree `.worktree/t26-review` 里读，单元测试可以到 t25 worktree 里跑（审查期间那里不改）：
  1. 设计与代码质量；
  2. 文档与规范（三份 Spec 与实现逐条对照，包与组件说明）；
  3. API 形状：以第三方身份只用公开入口写一份接入草稿；
  4. 性能：逐帧路径上的强制排版、多余的样式写入、空转的动画帧、超过刷新率或卡片刷新设置的写入，每条写怎么量。
- 没加 omp 交叉审查（开发者没要，按派给谁的分工 nb-layout 是前端包）；t25 的实现审查开发者说不用做了，不派。
- 上一轮：t06 的两份形状审查（[可维护性](../t06-flat-renderer/evidences/shape-review-maintainability.txt)、[接入与 API](../t06-flat-renderer/evidences/shape-review-api.txt)）；性能另有 [t21](../t21-hover-cpu/README.md)、[t22](../t22-drag-frame/README.md) 的记录。
- 审查结束后主会话在 e2e 环境实测：拖边界、实时拖动、侧栏显隐、静止时每秒的动画帧回调、样式重算与排版次数、卡片尺寸写入是否守住 `dragCardRefresh` 的 60、30 档。无头浏览器固定 60Hz，“不超过 120、144Hz 屏的刷新率”只能从代码确认都挂在动画帧上，记为未验证。实测不和审查同时跑。
- 预算：四份并行约 1 小时，Sonnet 额度约是平常一次实现审查的 4 倍；写说明约 20 分钟，实测约 1 小时，归类与修复看条数（估计半天到一天）。
- 报告：每条发现一个文件，写在主工作区 `.local/agent/works/w00026-layout-package/tasks/t26-layout-deep-review/reports/`（不进 Git），四份到齐后一起归类，扫过密钥再存为本 Task 的 `evidences/`。修复从 t25 合入之后的 master 开分支。

## 当前状态

2026-11-16 开审，四份报告都交了。2026-11-17 扫过密钥（没有命中）后按审查者各存一份：[`evidences/deep-review-design.txt`](evidences/deep-review-design.txt)、[`deep-review-docs.txt`](evidences/deep-review-docs.txt)、[`deep-review-api.txt`](evidences/deep-review-api.txt)（含接入草稿与实验）、[`deep-review-perf.txt`](evidences/deep-review-perf.txt)，每份开头是汇总，后面按条号。没有阻断；重要 15 条（设计 2、文档 4、API 7、性能 2），建议 31 条。抽查的几条在代码里属实。

- 准备直接修的（2026-11-16 在会话里报给开发者，不用答）：
  - 正确性：拖到边缘拆分时新面板 id 和已有的重了会静默覆盖别的面板（api-06，已实验）；布局文档放进 Vue 的 `ref` 抛 `DataCloneError`（api-08，已实验）；`edgeTarget`、`seamAccepts` 这类规则只在落点判定时查、写入时不查（api-02）；`useSashGesture` 换根元素时旧元素的监听没摘（design-03）；校验没拦住条的 id 写错的布局记录（design-04）。
  - 性能（都是从代码推断，先量基线再修）：任何滚动、拖边界的每一帧所有分隔线清空重写、逐条强制样式重算（perf-01）；编辑组头的尺寸观察每次换新对象，多一次整个网格的渲染（perf-09）；实时布局按住不动帧循环照样空跑（perf-04）；同一盒子两个尺寸观察（perf-06）；拖动每帧重算结构键（perf-03）；拖浮动窗没有自己的合成层（perf-05）；过渡结束靠定时器判（perf-08）。
  - 结构：`layout-drag.ts` 1041 行、没有单元测试，“来源收起了”在两个模块里存了三份（design-09、design-10）；改为每场拖动的状态收进一个对象，拆成纯函数文件，补单元测试。
  - 文档：组件说明补全缺的属性、事件与标记，改掉写错的注释（不存在的 `data-no-drop`），Spec 的 Smoke 行补上实际在跑的 e2e；删两个没人用的落点函数。
- master 上 w00046 t19（`6a5d0ae69`）在审查之后改了一部分同样的地方：分隔线一帧里先全部量完再统一写（perf-01 的逐条强制重算），编辑组头交给标签条的文案函数不再每次重建，标签条、活动栏、资源管理器的过渡列表内容没变时不重渲染。perf-01 的触发源（任何滚动都重排全部分隔线）与清空重写、perf-09 的尺寸观察不在它的改动里。量基线时按 t19 之后的 master 重新核对每一条。
- 要开发者定的四件（2026-11-16 在会话里问过，还没答）：
  1. nb-layout 的定位：甲（推荐）承认它是工作台的布局工具，写清通用层（网格、分隔线、拖动会话、标签条）与工作台层的分界，入口改成逐个列出公开的名字，只为第三方准备的几条（构造器、拖动控制器、全套错误码）不做；乙 在甲之上把工作台层移到子路径 `@notnotype/nb-layout/workbench`（机械改约 50 个文件的导入）；丙 做成通用库，等有第二个使用者再说。
  2. nb-ui 冻结的 Splitter 副本（t14）已和 nb-layout 分叉（11-15 的“往回拖不弹回”只在 nb-layout 里），nb-story 与开发者面板还是旧手感；要不要在 t26 之后排上 t14。
  3. `ui/workbench-layout` 里已实现、有测试守着的 planned 条目晋升（前言还写“视图容器还没有实现”），只留真没做的输出 44 的“移到”与输出 47 的入口条几何（t27）。
  4. `ui/nested-grid` 要不要重写：输出条目编号、长条拆成能各自对上测试的小条、组件 API 移到 `NestedGrid.md`；推荐在 t26 里做。

- 开发者答第 1 件（2026-11-16）：“nb-layout 应该是可以复用的通用布局工具，后面可以发到 npm，其他项目依赖他”，即丙，不是推荐的甲。这改了 [ADR 0044](../../../../../docs/adr/0044-workbench-single-layout-tree.md) 与包说明里“工作台的布局工具”的定位：布局文档那一半（区域名、活动栏与状态栏、容器，约 2000 行）要么做成参数，要么搬出包；API 审查站在第三方立场提的几条（api-01 文档层是工作台模型、api-04 拖动控制器不在库里、api-05 错误与诊断、api-07 入口过宽、api-12 要整个 nb-ui 与 token、发布物是源码）都进了范围。怎么拆要先写提案（取代 ADR 0044 的定位那一条），交开发者看过再做；发到 npm 照 [ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md) 发源码的做法。- 开发者答第 2 到 4 件（2026-11-16，会话里“都同意”，按问时的推荐）：
  2. t14（nb-ui 冻结的 Splitter 迁到 nb-layout）排在 t26 之后。
  3. 批准 `ui/workbench-layout` 里已实现、有测试守着的 planned 条目晋升；只留真没做的输出 44 的“移到”与输出 47 的入口条几何（t27 会改写 47，随 t27 晋升）。
  4. `ui/nested-grid` 在 t26 里重写：输出条目编号、长条拆成能各自对上测试的小条、组件 API 移到 `NestedGrid.md`。
- 同时批准的回写：e2e 点完活动栏入口后、点侧栏之前先把指针移开，免得入口的提示框挡住侧栏顶上的标签（t25 合入后 `workbench-views` 的“实例保留……”在高负载下因此失败）；在 t26 里统一改测试辅助函数。
- 推进顺序：先做 t27（同改外壳表面与邻接，t26 的修复排在它合入之后，免得两边改同几个文件）。

- 2026-11-18 拆成三个（待确认清单同日一行，advisor 建议）：本 Task 留性能基线与“准备直接修的”代码修复；`ui/workbench-layout` 晋升与 `ui/nested-grid` 重写拆到 [t30](../t30-layout-specs-rewrite/README.md)；通用库的提案拆到 [t31](../t31-general-layout-library/README.md)。`layout-drag.ts` 的拆分（design-09、10）、删掉两个没人用的落点函数（docs-15）、入口收窄（api-07）等 t31 的分界定了再做。动手前把每条“准备直接修的”按现在的 master 重核（报告固定在 954ed9e94，之后 t19、t27、t29、t28、t38 改写了其中很多地方）；性能基线在 t28 的实现审查处理完之后量，写成能重跑的脚本，含 t28 加的路径（切换容器、入口条上的拖动、每次指针移动的 `measureBands`）。

- 计划第 1 稿的设计审查（Claude Sonnet，2026-11-18，[`evidences/plan-review.txt`](evidences/plan-review.txt)）：14 条，重要 7、建议 7，都是读代码。逐条核实，改成第 2 稿：

  | 条 | 内容 | 处理 |
  |---|---|---|
  | 1 | perf-04 按需排帧：指针一动，判定要等下一帧才被叫醒，卡片多落后一帧；停帧后重启 `lastFrame` 是旧的，缓动一步到位 | 成立，改：这一帧有新指针样本、计时未到、卡片未到位、排序未放任一为真就继续排；重启时时钟对到这一帧；补单元测试与“再动一步同一帧跟上”的 e2e |
  | 2 | perf-08：渲染之后收集过渡时动画还不存在；进行中改终点时旧过渡被取消、`finished` reject，会把新一轮掐掉；宿主读 `moving` 的地方没列 | 成立，改：第二次渲染之后强制样式再收集，轮次令牌只认当前轮；`WorkbenchSurface` 依赖 `moving` 的地方写进 `NestedGrid.md` 并在 e2e 里验 |
  | 3 | perf-08 的回归在 happy-dom 里写不出来，现有 `moving` 用例会坏 | 成立，改：没有 `getAnimations` 时走定时器路，单元测试守它；主线程忙的回归放进 Lab 的 e2e |
  | 4 | api-08 换掉 `structuredClone` 之后，结果里仍混着输入的响应式代理；手写递归碰到 `__proto__` 键 | 部分成立：拷贝用 `Object.fromEntries` 重建（`__proto__` 是自有键）；结果与输入共享没改的子对象，写进合同，接受取舍（入口转原对象还是要求传原对象归 t31，待确认清单同日一行）；规模用例加到 2000 个标签 |
  | 5 | design-04 的校验从 `layout-project.ts` 取前缀会循环导入；只拦面板 id，分支、浮动窗也会撞；漏了 `:sections` | 成立，改：前缀、后缀挪到 `layout-doc.ts`；拦所有节点与浮动窗的 id |
  | 6 | perf-06：计划的指标看不出它（省的是 Vue 渲染），去掉 `decideMotion` 的分支有“改窗口高度滑一下”的风险，还要新增公开接口 | 成立，改：推迟到 t31，和 `NestedGrid` 的接口一起定 |
  | 7 | 基线的量法：每步的次数随机器快慢变、探针服务器没有编辑器与可滚的树、不设动效偏好实时布局不起、perf-08 不能用次数量、两份构建要各自的 fixtures、自己的计数循环会算进去 | 成立，改：按帧归一，用产品服务器加种子项目，`reducedMotion: no-preference` 并断言实时布局真的起了，perf-08 不进基线，从各自 checkout 动态导入 fixtures，计数排除脚本自己的回调 |
  | 8 | design-10 推迟的理由只成立一半：补测试不受库边界影响 | 部分成立：perf-03 的缓存抽成纯函数加单元测试；`layout-drag.ts` 整体的单元测试随 t31 的拆分一起写 |
  | 9 | design-03：`dispose()` 读 `options.root.value`，元素已置空时摘不到；计时器仍用全局 | 成立，改：挂上时记下根与窗口，摘的时候用记下的 |
  | 10 | perf-05 加 `will-change` 的收益没有依据，还会改文字渲染 | 成立，改：不做，记为未验证项 |
  | 11 | api-06 分支 id 只查树，撞浮动窗 id 时校验会拒 | 成立，改：分支也查面板与浮动窗 |
  | 12 | perf-03 只缓存了文档那一半，编辑器那一半每帧仍算 | 成立，改：编辑器那一半在 `tab-drag.ts` 里改成 computed |
  | 13 | perf-01：`useSashSnap` 没有根元素可判；线芯变量也要去重 | 成立，改：补进计划 |
  | 14 | e2e 移开指针移到标题栏，Lab 的表面没有标题栏、产品页的标题栏有菜单悬停 | 成立，改：按文件选位置（产品页状态栏空白、Lab 画布外） |

  第 2 稿的改法都按审查给的方向写，没有新的机制，不再送第二轮；实现审查照常。

## 实施

分支 `fix/w00026-t26-layout-review`，从 master 的 `ba3de16c6`（t28 审查修正 `077e0e6c1` 与记录之后）开出。

- 片 1（`194782993`）：api-06、api-08、design-03、design-04。布局文档的操作按 JSON 形状复制（`Object.fromEntries` 重建，`__proto__` 是自有键），结果与输入共享没改过的子对象，写进 `layout-doc.ts` 头注释与 `grid.md`；`newId` 给出的面板、分支 id 已被占用（面板、树、浮动窗）时拒绝（`rejected`）；校验拦条的叶 id 不等于条名、节点与面板 id 是条名或撞上呈现里生成的 id（`strip:` 开头、`:sections` 结尾，前后缀挪到不导出的 `presented-ids.ts`，`layout-project.ts` 也从那里取）；`useSashGesture` 记下挂上时的根、窗口与文档，换根先摘旧的，计时器与帧走记下的窗口。2000 个标签的文档做一次外缘移动（含拷贝）约 1.2ms。验证：nb-layout `bun test` 593、vitest 254、类型检查；neuro-book 类型检查、工作台单元测试 542；e2e `lab-grid-swap`、`lab-workbench-surface`、`workbench-shell` 39 条全过。变异检查：去掉 `freshId` 的查重、`detach` 改回读 `options.root.value`，新用例都失败。

- 片 2（`e9bb34207`）：4 个 e2e 文件里点活动栏入口的 32 处改成 `pressEntry`，点完把指针移到状态栏中间；Lab 的表面场景也有状态栏，用同一个位置（计划写的是画布外，状态栏一样没有悬停效果，少一种写法）。组件说明（docs-02、08、09、11）按 t28、t29 之后的代码补齐；docs-18 的六处注释改成说现在的约束。验证：改到的 4 个 e2e 文件 124 条，123 过；`workbench-containers:1277`（滑到一半点回来逐帧取样）失败一次，它用 `evaluate` 点入口、不经改到的辅助函数，按真实时间逐帧取样，负载 9 左右时帧间隔变长、提前走完；单独重跑 3 次都过，归负载。
- 片 3（`25c3a26b5`）：基线脚本 `scripts/perf/layout-frames.ts`，自己起产品服务器（和 `e2e/fixtures.ts` 同一种起法，cwd 指向要量的那份检出），没有按计划导入各检出的 `e2e/fixtures.ts`：那里的等待用的是 Playwright Test 的 `expect.poll`，脚本不在测试运行器里。基线构建在 detached worktree `.worktree/w00026-t26-perf-base`（`ba3de16c6`）。第一次测量与读法见 [`evidences/perf-baseline.txt`](evidences/perf-baseline.txt)：基线与分支每项都在噪声内；perf-01 每次树滚动 16 次、每次改窗口 38 次分隔线样式写入，perf-04 按住不动每秒 60 次帧回调，都量到了。

- 片 4：perf-01 与 perf-08。
  - perf-01：`useSashSnap` 收网格根，捕获阶段的 scroll 只在滚动的是文档或包着根的元素时重新对齐（`NestedGrid`、`Splitter` 两个调用方传各自的根）；`SashHandle` 按装饰元素（`WeakMap`）记下上次写的几何与线芯变量，值一样不写。“线芯宽度一轮读一次”没做：读在一帧量的那一半里，第一次之后样式是干净的，再读不触发重算，不同种类的分隔线主题也可能给不同的宽度。测试：`splitter.dom.test.ts` 加“面板里的滚动不重新对齐、包着网格的元素滚动重新对齐”；去重在 happy-dom 里证不了（它的 `MutationObserver` 不记 `style.left = …` 这种写法），放进 `lab-nested-grid` 的新用例：叶里的滚动不排帧、不写分隔线，文档的滚动重新对齐一次但一条都不写。变异检查：去掉判根，`frames` 不为 0；去掉去重，写了 8 次，都失败。
  - perf-08 实测不成立，不改（[`evidences/perf08-probe.txt`](evidences/perf08-probe.txt)）：Chrome 的过渡按建起来那一刻的时间线时间计时，主线程忙过之后过渡本身就到了终点；原来的计时器从 `update` 起算，不会比它先到。改成等过渡结束只多一套机制，撤回。

- 片 4 提交 `acba66349`（只含 perf-01）。验证：nb-layout `bun test` 593、vitest 255、类型检查；e2e `lab-nested-grid`、`lab-grid-panels`、`lab-grid-swap`、`lab-workbench-surface`、`workbench-shell`、`workbench-float` 88 条全过。
- 片 5（`9625e49c9`）：perf-09、perf-04、perf-03。
  - perf-04：`live-drag.ts` 的帧循环按需排，这一帧指针动了、预览换了、卡片的尺寸或追赶没到、候选还没等够稳定，任一成立才排下一帧；停着时 `offer` 与新加的 `wake` 叫醒。`layout-drag.ts` 在实时布局这一场里给窗口挂捕获阶段的 `pointermove`（`wakeLive`），叫醒排在手势自己的发布同一帧，卡片不落后。停过之后第一帧按一帧（1000/60ms）缓动。“排序的标签还要放”没有单列：它只随指针动，已在“指针动了”里。测试：`live-drag.test.ts` 加“按住不动不空转……卡片在那一帧跟上”“停了两秒再动……不一步到终点”；`workbench-drag-cost.e2e.ts` 加“按住不动页面不排动画帧（60 帧里 0 次），再动一步卡片在指针移动后的那一帧就跟上”。变异检查：每帧都排、去掉重启缓动、去掉 `pointermove` 叫醒（e2e 里卡片那一帧没动），都失败。
  - perf-09：`WorkbenchSurface.vue` 的编辑组头尺寸观察只在高度变了才换对象。perf-03：`layoutStructureKey` 按文档身份记住（`WeakMap`，文档不可变），`tab-drag.ts` 的编辑器那一半改成 `computed`；行为不变，现有 `layout-present.test.ts` 的结构键用例照过，缓存本身看不出来，没加只测缓存的用例。
  - 片 3 提交的基线脚本在主 tsconfig 的 `scripts` 范围里、没有 DOM 类型，类型检查报 19 处（片 3 提交前没跑类型检查）；照 `browser-runner.ts`、`page-agent.ts` 把它加进 `exclude`，随片 5 提交。
  - 验证：neuro-book 类型检查；工作台与编辑器单元测试 788；e2e `workbench-drag-cost`、`workbench-live-drag`、`workbench-dnd`、`editor-area` 122 条，120 过。`editor-area:2171`、`2207`（编辑器标签实时布局拖到正文右边缘拆组）在负载 9 到 10 时失败：预览停在 `source-removed`，15 秒没换成拆分。同样负载下分支与基线（`ba3de16c6` 的构建）各把这两条重复跑 6 次，都是 12 次里失败 1 次，分支之前就有，不是这一片带进来的；记在 Work README 的已知问题里，没有排 Task。

- 片 6：修后复测见 [`evidences/perf-baseline.txt`](evidences/perf-baseline.txt) 的“修后复测”（树滚动的分隔线写入 16 → 0，改窗口每次的 DOM 记录 103.5 → 71.5，实时布局按住不动每秒的帧回调 60 → 0，其余在噪声内）。2026-11-18 合入 master（`aa8de685e`），master 自分支起点的 14 个提交没碰这些路径，没有先并。实现审查（Claude Sonnet，`claude -p`）在后台，审查 worktree `.worktree/review-t26-impl` 固定在 `9625e49c9`。

## 下一步

实现审查待处理：报告回来后逐条核实，修正单独提交。基线 worktree `.worktree/w00026-t26-perf-base` 与分支的 worktree 留到审查处理完（修正若改到热路径要重跑测量）。