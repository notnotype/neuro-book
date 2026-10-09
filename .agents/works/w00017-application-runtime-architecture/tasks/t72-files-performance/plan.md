# t72 实施计划：Files 竖切五：性能验收

## Context

- **为什么做**：第 6 步 Files 竖切的最后一片（[t68 计划的“第 6 步分解”](../t68-files-resource-layer/plan.md#第-6-步分解)）。t68–t71 交付了资源层、文件操作、资源管理器与编辑器区，结构上按[项目文件底座提案](../../../../../docs/proposals/project-file-foundation.md)做了按需列目录、虚拟列表、乐观切换与控件复用，但性能标准还没有在生产构建上逐项测过。本 Task 交付可复现的测量脚本、3000 个文件样本上的正式结果，并按测量修正达不到标准的地方（files-explorer 验收 12）。
- **依据**：[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的“打开与切换”（性能标准表与 800 ms 进度条规则）与验收 12；[t42 基线](../t42-files-baseline-research/README.md)（旧应用在同一台机器上的测量方法、结果与 VS Code 调研[第 16 章](../../../../../docs/research/vscode/16-file-service-explorer-editor-latency.md)）；[t68 的样本生成器](../../../../../packages/neuro-book/scripts/files-sample.ts)（约 3000 个 Markdown、3–5 层、单章 5–30 KB、400 项宽目录、内容文件夹）。
- **测量机器就是参考机器**：本机 `lscpu` 为 Intel Core i5-1035G1（8 逻辑核）、16 GB，与 Spec 写的参考机器一致（t42 同机测量）。浏览器用本机 Chrome（Playwright `channel: "chrome"`，无头，1440×1000）。桌面版加载同一本机服务页面，Spec 规定不单独测。
- **探路测量**（2026-10-09，当前 HEAD 的生产构建，3000 个文件样本，手写探针，非正式结果）：
  - 重新载入页面到第一行文件树可见约 235 ms（服务端已在运行，项目子进程已起）；
  - 展开 `manuscripts`、`volume-01` 约 50–70 ms；
  - 单击未打开过的章节：第一次约 100 ms（含富文本控件的按需加载），之后 13–21 ms 正文出现；选中与标签从点击到探针的第一次检查帧 7–26 ms；
  - 虚拟列表之外的行不在 DOM 里：脚本要先把行滚进可见区（Playwright 的自动滚动与虚拟列表互相打架，探针曾因此超时）。
  - 没测到的：服务刚启动时第一次打开项目（含项目子进程启动）、第二次打开、热切换标签、400 项目录的展开与滚动、Monaco 冷打开、外部大批改动时界面是否冻住、请求数与资源保留。
- **工作方式**：自主推进（[autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md)）：Opus 编码，三个 omp（默认模型）审查计划与实现。worktree `.worktree/w00017-runtime-foundation` 逐片提交并 push。测量与修正都用真实生产构建、真实 Chrome、真实磁盘；产品代码不加测试专用分支（不加只为测量存在的计时点与开关）。

## 关键设计

### 1. 测量脚本（`packages/neuro-book/scripts/perf/`）

- 入口 `files-perf.ts`，包脚本 `perf:files`：`bun run perf:files -- [--count 3000] [--seed 42017] [--iterations 30] [--skip-build] [--out <目录>]`。步骤：
  1. 在系统测试临时根（`createTestTmpRoot("neuro-book-perf", …)`）用 `scripts/files-sample.ts` 的 `planSample` 与写盘函数生成样本，写 `.nbook/project.json`，在状态根的 `projects.json` 登记（与 `e2e/editor-area.e2e.ts` 相同的登记方式）。
  2. 生产构建（`bun run build`，`--skip-build` 跳过），复用 `e2e/fixtures.ts` 的 `startProductServer` 起服务。
  3. Playwright 用本机 Chrome；每个场景新开标签页，`addInitScript` 安装页面内观察器（见第 2 节）。
  4. 逐个场景运行（见第 3 节），原始样本写入临时根，汇总 JSON 与 Markdown 报告写到 `--out`（缺省临时根，正式结果由主 Agent 复制到 Task 的 `evidences/`）。
  5. 结束时停服务、关浏览器；临时根保留到下次运行前由脚本自己删除（路径打印出来）。
- 纯函数（分位数、帧间隔统计、RPC 帧分类、样本选择）放 `scripts/perf/stats.ts`，Bun 测试 `stats.test.ts`。
- 复用旧应用 `packages/neuro-book-legacy/scripts/perf/` 的做法（只读参照）：起止都在页面内记，排除 Playwright 选择器等待与 RPC 往返；`longtask` 与 `long-animation-frame` 观察器。

### 2. 页面内的计时（init script，`scripts/perf/observe.ts` 注入）

- **起点**：真实输入事件。Playwright `page.mouse.click` 在行的坐标上点击；页面里 `window` 捕获阶段的 `pointerdown` 记 `event.timeStamp`（与 `performance.now()` 同一时间原点）。点击前先把目标行滚进虚拟列表的可见区（在页面里设置 `[data-explorer-tree]` 的 `scrollTop`，等目标行出现，再取它的坐标）。
- **终点**用 `requestAnimationFrame` 回调里的时间戳判定“这一帧已经呈现了”：
  - 选中与标签：目标行 `aria-selected="true"`，且活动组里 `title` 等于该地址的标签 `aria-selected="true"`。记两个都满足的第一帧的 rAF 时间戳减起点（标准 16 ms 是“下一帧”，所以同时记起点之后经过了几帧）。
  - 正文出现：活动组里可见的控件含该文件的唯一标记（样本描述里每个文件第一行的 `NBOOK-SAMPLE-…`，脚本从磁盘读），且可输入（富文本 `contenteditable="true"`，源码为 Monaco 文本区存在且未只读）。
  - 打开项目：从导航开始（`performance.timeOrigin`）到文件树根下的行可见、树可接受键盘（`[data-explorer-tree]` 存在、根行 `aria-expanded` 与记录一致）的第一帧。
  - 展开目录：点击到第一个子行出现的帧，以及全部可见区的子行都渲染完成的帧。
- **卡顿**：`long-animation-frame`（LoAF，>50 ms）与 `longtask` 条目按场景时间窗归属；Event Timing（`event` 类型，`durationThreshold: 16`）记点击与键入的处理时长。
- **请求数**：Playwright `page.on("websocket")` 的 `framesent`，按 RPC 帧里的合同 id 与方法名计数（`nbook.files/project` 的 `list`、`read` 等），每个场景单独统计；HTTP 请求另计。
- **资源**：场景前后通过 CDP `HeapProfiler.collectGarbage` 后读 `performance.memory.usedJSHeapSize`；DOM 里 `.ProseMirror`、`.monaco-editor` 的个数（控件实例）；关闭全部标签后这些计数应归零或回到基线。

### 3. 场景（对应性能标准表与验收 12）

| 场景 | 做法 | 次数 |
|---|---|---|
| 打开项目（服务刚启动） | 每次重启服务，新标签页导航 `/?project=book`，含项目子进程启动 | 10 |
| 第二次打开 | 同一服务上新标签页再导航 | 10 |
| 点击文件：选中与标签 | 同一目录里轮流单击不同文件（preview 替换） | 30 |
| 正文出现：未打开过 | 每次点一个从没打开过的章节；富文本与源码（`.json`）分开 | 各 30 |
| 正文出现：已打开过 | 两个固定标签之间来回点标签；单组与双组（拆分后另一组）分开；富文本与源码分开 | 各 30 |
| 展开目录 | 展开 400 项宽目录（每次先收起），再用滚轮从头滚到尾 | 10 |
| 后台不冻住 | 空闲时与连续键入时，在磁盘上改写 500 个文件（含已展开目录与已打开文件），记 LoAF 与键入的事件时长 | 5 |
| 加载提示 | 已有的 e2e 与控制器测试证明 800 ms 规则；脚本只核对正常打开时从不出现 `[data-editor-progress]` | 全部场景 |

- 每个场景记 p50/p95/最大值、LoAF 次数与最长时长、请求数、控件个数与堆。开发构建不测（t42 已知差异在 10% 以内，标准针对生产构建）。
- **规模扫描**：300、1000、3000 个文件各跑一次主要场景（打开项目、未打开过、已打开过），看耗时是否随文件数增长（t42 发现旧应用随规模线性增长）。

### 4. 按测量修正（S3 起）

- 正式基线出来后，对每一项不达标或随规模增长的指标：先用 CDP 的 CPU 采样（`Profiler`）与 RPC 帧计数找到时间花在哪里，再改；改完用同一脚本复测，前后数据写进 README。
- 已知的候选（从代码推断，待测量确认）：
  - 第一次打开富文本或源码文件要按需加载编辑器代码块（探路约 100 ms，Monaco 更大）：可在编辑器区空闲时预取代码块（`requestIdleCallback`），不改变“第一次挂上才创建实例”的行为；
  - 内容文件夹每次列出都读一次 `content.xml`（t68 留到 t72 测）；
  - 递归文件监视在 3000 个文件上的事件量与 75 ms 合批后的重新列出；
  - 宽目录 400 行的渲染与滚动。
- 每个修正单独一片、单独提交；改变产品可见行为的（例如预取改变首屏请求、展开记录的重列策略）记入待确认清单；达不到标准且改不动的项，写明测量与原因，交开发者决定是否改标准，不擅自放宽 Spec。
- 修正涉及的行为由现有或新增的单元、DOM、e2e 测试守住（例如请求数用 e2e 断言），不把耗时阈值写进测试（机器负载会让它不稳）。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/workbench/files-explorer.md` | “证据”一节加验收 12 的测量入口（`scripts/perf/files-perf.ts`）与本 Task 的结果链接；全合同仍有跨机器项未验证，保持 `planned` |
| `packages/neuro-book/AGENTS.md` 或 `scripts` 说明 | 登记 `perf:files` 的用途与运行条件（生产构建、本机 Chrome、参考机器） |
| 本 Task `README.md` | 正式结果表、规模扫描、每个修正的前后数据 |

## 切片

| 片 | 内容 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | 计划、Task README、Work 登记 | 文档 | `docs:check`、`governance:check` |
| S1 | 测量脚本与页面观察器、纯函数测试；300 个文件的小样本跑通全部场景 | `scripts/perf/*`、`package.json` 脚本 | `typecheck`、`bun test scripts/perf`、`bun run perf:files -- --count 300 --iterations 5` |
| S2 | 3000 个文件的正式基线与规模扫描，结果进 `evidences/` | 证据与 README | 同 S1 的正式参数 |
| S3… | 每个修正一片 | 产品代码与对应测试 | 受影响测试、`test:e2e`、复测 |
| 收尾 | 最终测量、Spec 证据行、README | 证据与文档 | 全量检查 |

## 验收映射

| 标准（files-explorer 性能表与验收 12） | 证据 |
|---|---|
| 打开项目 1 秒内可操作；第二次约 300 ms | 场景“打开项目”“第二次打开”的 p50/p95 |
| 选中与标签 16 ms 内切换 | 场景“点击文件”：起点到首个满足帧的时长与帧数 |
| 正文：已打开过 100 ms 内、未打开过 200 ms 内 | 场景“正文出现”两类，富文本与源码、单组与双组 |
| 展开几百个子项不卡、滚动流畅 | 场景“展开目录”的耗时与 LoAF |
| 任何时候不被后台冻住 | 场景“后台不冻住”的 LoAF 与键入事件时长 |
| 800 ms 内不出现加载提示 | 全部场景中 `[data-editor-progress]` 出现次数为 0；规则本身已由 t71 的控制器测试与 e2e 覆盖 |
| 请求数、控件创建与资源保留 | 每个场景的 RPC 帧计数、控件个数、关闭全部后的堆与控件数 |

## 验证

- 测量：`bun run perf:files`（生产构建、本机 Chrome、无头）在参考机器上跑正式参数；结果 JSON 与报告进 `evidences/`，原始样本只留在临时根（体积大，不入库）。
- 正确性：脚本本身的纯函数有 Bun 测试；小样本跑通证明每个场景的终点判定能达成（判定写错会超时报错，不会给出假的快数字：每个场景在终点前先核对目标文件的标记确实出现）。
- 修正：受影响的单元与 DOM 测试、`bun run test:e2e`、复测前后对比。
- 未验证的边界：无头与有头 Chrome 的帧时序差异（本机无图形会话，只测无头）；跨机器访问（Spec 规定毫秒标准只针对本机）；桌面版（Spec 规定不单独测）；其它操作系统。

## 不做

- 预读（Spec：“预读留扩展口，策略在实际体验后另定”）；草稿跨刷新、自动保存；桌面版与跨机器的测量。
- 不把毫秒阈值写进自动化测试。

## 风险

- 机器负载造成波动：每格 30 次，报告 p50/p95 与运行时的 `loadavg`；正式运行前确认没有其它重负载进程（只读查看，不结束别人的进程）。
- 无头 Chrome 的 rAF 与真实显示的帧可能不同：报告里写明，判断以“几帧内”为辅助。
- 修正可能触及 t70/t71 刚审查过的代码：每个修正都跑对应的 e2e 与变异检查。
