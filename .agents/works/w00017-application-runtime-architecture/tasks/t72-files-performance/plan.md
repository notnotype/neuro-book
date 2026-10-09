# t72 实施计划：Files 竖切五：性能验收

## Context

- **为什么做**：第 6 步 Files 竖切的最后一片（[t68 计划的“第 6 步分解”](../t68-files-resource-layer/plan.md#第-6-步分解)）。t68–t71 交付了资源层、文件操作、资源管理器与编辑器区，结构上按[项目文件底座提案](../../../../../docs/proposals/project-file-foundation.md)做了按需列目录、虚拟列表、乐观切换与控件复用，但性能标准还没有在生产构建上逐项测过。本 Task 交付可复现的测量脚本、3000 个文件样本上的正式结果，并按测量修正达不到标准的地方（files-explorer 验收 12）。
- **依据**：[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的“打开与切换”（性能标准表与 800 ms 进度条规则）与验收 12；[`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md) 的项目代次与宽限期；[t42 基线](../t42-files-baseline-research/README.md)（旧应用在同一台机器上的测量方法与结果，VS Code 调研[第 16 章](../../../../../docs/research/vscode/16-file-service-explorer-editor-latency.md)）；[t68 的样本生成器](../../../../../packages/neuro-book/scripts/files-sample.ts)。
- **测量机器就是参考机器**：本机 `lscpu` 为 Intel Core i5-1035G1（8 逻辑核）、16 GB，与 Spec 的参考机器一致（t42 同机测量）。浏览器用本机 Chrome（Playwright `channel: "chrome"`，无头，1440×1000）。桌面版加载同一本机服务页面，Spec 规定不单独测。
- **探路测量**（2026-10-09，生产构建，3000 个文件，手写探针，非正式结果）：重新载入到文件树第一行可见约 235 ms；展开两级目录约 50–70 ms；单击未打开过的章节第一次约 100 ms（含富文本控件代码），之后 13–21 ms 正文出现。Bun 里跑 Playwright 的探针反复卡死——e2e 配置早已写明 Playwright 必须由 Node 运行（Bun 下 CDP 握手会超时），浏览器部分改由 Node 运行。
- **计划审查**（三个 omp：测量方法、产品性能结构、可实施性，报告见 `evidences/plan-review-*.txt`）：共 39 条发现（阻断 4 条：300 文件样本生成不了、样本没有源码文件、同一浏览器上下文共享客户端身份会恢复会话污染“未打开过”、Bun 跑 Playwright 会卡），全部核实成立并入本稿；取舍记入待确认清单。
- **工作方式**：自主推进（[autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md)）：Opus 编码，三个 omp（默认模型）审查计划与实现。worktree `.worktree/w00017-runtime-foundation` 逐片提交并 push。测量与修正都用真实生产构建、真实 Chrome、真实磁盘；产品代码不加测试专用分支或只为测量存在的计时点。

## 关键设计

### 1. 样本（`scripts/files-sample.ts` 扩展）

- 新增两个可选参数，缺省值保持 t68 的样本不变：
  - `sources`（缺省 0）：另生成这么多个源码文件 `data/source-NNN.json`（合法 JSON，第一行之后的字段里带 `NBOOK-SAMPLE-…` 标记，5–30 KB），不占 `count` 的 Markdown 名额；描述加 `sources: string[]`。
  - `wide`（已有，CLI 加 `--wide`）：宽目录项数。生成器校验它不超过笔记份额（`count - 2·⌊0.3·count⌋`），不够时报错，不再出现“描述说 400、实际写 200”的情况。
- 正式样本：`--count 3000 --sources 60`（宽目录 400）。小样本只做脚本冒烟：`--count 600 --wide 100`，它的宽目录结果不代表 400 项。生成器的测试补这两个参数的布局与校验。

### 2. 测量脚本（`scripts/perf/`）

- **两段进程**：`perf:files` 是 Bun 脚本 `files-perf.ts`：解析参数、生成样本、登记项目（同 `e2e/editor-area.e2e.ts`）、生产构建（`--skip-build` 跳过）、写报告、清理。浏览器部分是 Node 运行的 `browser-runner.ts`（只用 Node 内置模块、`@playwright/test` 与带 `.ts` 后缀的相对导入，同 `scripts/lab-shot.ts`），由 Bun 脚本以子进程启动，参数与结果经 JSON 文件传递，退出码原样传回。
- **服务进程**：runner 自己的启动器持有子进程引用：等监听地址失败时也经标准输入停止并等退出，输出存日志；服务重启前关闭全部页面并等服务以 0 退出。`--server-profile` 时服务以 `bun --cpu-prof --cpu-prof-name=…` 启动，profile 摘要（热点函数前 30）写进结果，完整 profile 只留在临时根。
- **隔离**：每类冷场景用新的 `BrowserContext`（新的客户端身份，`localStorage` 与项目本地记录都是新的），不靠新标签页隔离；热场景在同一页内预热并核对请求数为零。每个场景结束关闭自己的页面。
- **结果状态**：每个场景 `ok / failed / not-run` 带错误；任一失败或未执行，或成功样本少于要求的次数，退出码非零。报告在 `finally` 里总是写出，只统计成功样本。
- **清理**：样本、状态根、日志放运行临时根，`finally` 中先停浏览器与服务、再删除；结果写到 `--out`（缺省系统临时根下另一个 `neuro-book-perf-results/<时间>` 目录），与运行临时根分开。`--keep-temp` 保留现场并打印路径。
- **证据清单**：`summary.json` 固定写入源码 revision、完整命令与参数、样本布局、Chrome 版本、`supportedEntryTypes`、运行前后 `loadavg`、每个场景的状态与汇总；`report.md` 由脚本生成。逐次样本写 `samples.json.gz`，只在需要审查时随证据入库；profile、日志、截图不入库。
- 纯函数（分位数、帧统计、RPC 帧分类、样本布局的可行性）放 `scripts/perf/stats.ts`，Bun 测试。

### 3. 页面内的计时（`scripts/perf/page-agent.ts`，`addInitScript` 注入）

- **起点**：真实输入。`page.mouse` 在目标坐标点击；页面在 `window` 捕获阶段记 `pointerdown` 的 `event.timeStamp`。点击前先把目标行滚进虚拟列表可见区中部（在页面里设 `[data-explorer-tree]` 的 `scrollTop`，等两帧，确认行完全落在树的视口里再取坐标）；5 秒内没收到点击即判失败。
- **两个终点**：
  - `committed`：`requestAnimationFrame` 回调里条件第一次成立的时刻（DOM 已改，这一帧结束时会画出来）；
  - `presented`：其后下一个 rAF 回调的时刻（上一帧已经呈现），并核对条件在这一帧仍成立（排除中间状态）。
  - 同时记点击的 Event Timing（`interactionId`、`startTime`、`processingStart`、`processingEnd`、`duration`），报告分别写输入延迟、处理时长、到下一次绘制。16 ms 标准按 `presented` 与经过的帧数判断，报告写明 rAF 的语义与无头 Chrome 的局限。
- **条件**：
  - 选中与标签：目标行 `aria-selected="true"`，且活动组里 `title` 等于该地址的标签 `aria-selected="true"`（从标签点时只看标签）。
  - 正文：活动组里可见的控件含该文件的唯一标记，富文本 `contenteditable="true"`，源码为 Monaco 文本区存在且未只读。计时之外再做一次真实输入核验：键入一个记号、核对它进入正文、撤销、核对正文与未保存标记恢复；核验失败的样本判失败，不进统计。
  - 打开项目：根目录的列出结果已到（`project://manuscripts`、`notes`、`lorebook.content`、`data` 四行可见）的第一帧；计时之外按 `ArrowDown` 核对焦点在树里移动。
  - 展开目录：第一个子行出现（`committed`）；可见区的子行数稳定两帧（`settled`）。
- **卡顿**：`long-animation-frame` 与 `longtask` 全程收集，按场景时间窗归属；先记 `supportedEntryTypes` 与观察器是否产生过条目，不支持时报 `unavailable`，不当作 0。
- **进度条**：`MutationObserver` 记 `[data-editor-progress]` 每次插入与移除的时刻，归到当时的操作；报告“未出现 / 800 ms 后出现 / 超时仍未就绪”。
- **请求**：`websocket` 的 `framesent` 按 RPC 帧的 `合同 方法` 计数，`framereceived` 计文件变化事件帧（`event`）；文件、Storage、其它合同分开报告。

### 4. 场景（对应性能标准表与验收 12）

| 编号 | 场景 | 做法 | 次数 |
|---|---|---|---|
| A1 | 打开项目（服务刚启动） | 每次重启服务，新上下文导航 `/?project=book`；含项目子进程启动；记服务启动到监听、导航到树可操作 | 10 |
| A2 | 第二次打开（宽限期内） | A1 之后关闭页面，项目进入宽限期，新上下文再导航（复用同一项目代次） | 10 |
| A3 | 重开（子进程已退出） | 服务以 `NBOOK_PROJECT_GRACE_MS=0` 启动，关闭页面后等项目子进程退出，再导航（新代次） | 10 |
| A4 | 打开项目（恢复多个展开目录） | 预置展开记录：`manuscripts` 全部卷与宽目录（约 1300 行）；记可操作帧、行数与 DOM 行数 | 10 |
| B1 | 点击文件：选中与标签 / 正文（富文本，未打开过） | 新上下文；先单独记第一次（含控件代码），再在同一目录里轮流单击未打开过的章节（preview 替换） | 1 + 30 |
| B2 | 同上（源码，未打开过） | `data/` 里的 JSON；第一次（含 Monaco）单独记 | 1 + 30 |
| C1 | 已打开过：来回点标签 | 两个 permanent 标签来回点；富文本 / 源码 × 单组 / 双组 | 各 30 |
| C2 | 已打开过：从资源树再点 | 标签里已有 A、B，停在 B，从树点 A；富文本与源码 | 各 30 |
| D1 | 展开 400 项目录 | 每次先把父行滚回视口收起，再展开；记 `committed` 与 `settled` | 10 |
| D2 | 展开内容目录（约 300 个节点） | `lorebook.content/characters`：含每项 `index.md` 探测与 `content.xml` 读取 | 10 |
| D3 | 滚动 | 展开宽目录后从树顶用滚轮滚到底，记每帧 `scrollTop` 与帧间隔、长动画帧，到底后稳定两帧结束 | 5 |
| E1 | 外部大批改写时连续键入 | 富文本里键入的同时，在磁盘上并发改写 500 个文件（宽目录 250 + 已展开卷 250，含 1 个已打开的文件），最后在宽目录新建一个哨兵文件；窗口从第一次写入到哨兵行出现在树里、且已打开文件的正文换成磁盘内容；记长动画帧、键入的 Event Timing、收到的变化事件帧与 `list`/`read` 次数 | 5 |
| F1 | 资源保留 | 打开再关闭 20 个文件为一轮，跑 5 轮，每轮后 GC 再读堆，看是否平台；关闭全部标签后挂载的控件（`.ProseMirror`、`.monaco-editor`）为 0 | 1 |

- 每个场景记 p50/p95/最大值、成功次数、长动画帧、请求数；`committed` 与 `presented` 分开。开发构建不测。
- **规模扫描**：1000、2000、3000 个文件（宽目录都是 400），每档跑 A1、A2、B1、C1（富文本单组），每格 10 次，同一构建、seed 与协议；判断耗时是否随文件数增长。
- **控件与模型**：页面上能直接数的只有挂载的控件；模型与编辑状态的保留上限与释放由 t71 的控制器测试（视图状态槽淘汰与关闭释放）与 e2e 证明，报告写明哪些是直接计数、哪些是间接证据。

### 5. 按测量修正（S3 起）

- 正式基线出来后，对每一项不达标或随规模增长的指标先归因：浏览器侧用 CDP `Profiler` 采样；服务侧用 `--server-profile` 的 CPU profile 与 t68 的 `scripts/files-list-trace.ts`（列出的系统调用与耗时）；请求与事件计数区分往返次数。归因写进 README 再改。
- 已知候选（从代码推断，待测量确认）：
  - 内容目录每次列出读一次 `content.xml`，并对每个子目录 `lstat(index.md)`；
  - 文件监视的批处理逐条 `await` 分类；文档模型收到一批事件时按“事件数 × 已打开文档数”比较；
  - 资源管理器每次状态变化都从两个根递归投影全部已展开的行（虚拟列表只截取渲染部分）；
  - 每次展开或收起都把两份展开记录整份写入 Storage，没有合并。
- 不做：编辑器代码块的空闲预取（会改变 t71 “第一次打开源码文件之前不加载 Monaco”的合同与 e2e，属于产品行为变更）。测量若表明首次打开超标，把预取作为待确认项提给开发者，不在本 Task 自行改。
- 每个修正单独一片、单独提交，改动前后同一场景复测；改变产品可见行为的记入待确认清单；达不到标准且改不动的，写明测量与原因交开发者决定，不擅自放宽 Spec。
- **防回退**：每个修正配一条不依赖毫秒的结构守卫，用真实测试覆盖：例如切换已打开文件不发 `read`/`list`；同组同类控件实例不重建；展开只列一次、滚动不重复列出；一批外部变化只重列已展开且受影响的目录；关闭全部标签后控件归零；展开记录的写入次数有上限。毫秒数只记在测量报告里。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/specs/workbench/files-explorer.md` | “证据”一节加验收 12 的测量入口（Smoke：`scripts/perf/files-perf.ts`）；全合同仍有跨机器项未验证，保持 `planned` |
| `packages/neuro-book/AGENTS.md` | 命令表登记 `perf:files`（生产构建、本机 Chrome、参考机器，浏览器部分由 Node 运行） |
| 本 Task `README.md` | 正式结果表、规模扫描、每个修正的归因与前后数据 |

## 切片

| 片 | 内容 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | 计划（含审查并入）、Task README、Work 登记 | 文档 | `docs:check`、`governance:check` |
| S1 | 样本生成器的 `sources`、`--wide` 与校验；测量脚本（Bun 外壳 + Node runner + 页面代理）；纯函数测试；小样本冒烟跑通全部场景 | `scripts/files-sample.*`、`scripts/perf/*`、`package.json`、tsconfig | `typecheck`、`bun test scripts`、`bun run perf:files -- --count 600 --wide 100 --sources 20 --iterations 3 --opens 2` |
| S2 | 3000 个文件的正式基线与规模扫描，证据进 `evidences/` | 证据与 README | 正式参数 |
| S3… | 每个修正一片 | 产品代码、守卫测试 | 受影响测试、`test:e2e`、复测 |
| 收尾 | 最终测量、Spec 证据行、AGENTS 命令登记、README | 证据与文档 | 全量检查 |

## 验收映射

| 标准（files-explorer 性能表与验收 12） | 证据 |
|---|---|
| 打开项目 1 秒内可操作；第二次约 300 ms | A1；A2（宽限期内重开，Spec 的“第二次打开”）；A3、A4 作补充 |
| 选中与标签 16 ms 内切换 | B1、B2 的选中与标签：`presented` 时长与帧数，点击的 Event Timing |
| 正文：已打开过 100 ms 内、未打开过 200 ms 内 | C1、C2；B1、B2（第一次含控件代码的单独报告） |
| 展开几百个子项不卡、滚动流畅 | D1、D2、D3 |
| 任何时候不被后台冻住 | E1；A1–A4 期间的长动画帧 |
| 800 ms 内不出现加载提示 | 全部场景的进度条记录；阈值本身由 t71 的控制器测试（按合同写死 799/800）与 Lab e2e 证明 |
| 请求数、控件创建与资源保留 | 每个场景的请求与事件计数；F1 |

## 验证

- 测量：`bun run perf:files`（生产构建、本机 Chrome、无头）在参考机器上跑正式参数；`summary.json`、`report.md` 进 `evidences/`。
- 脚本自身：纯函数与样本生成器有 Bun 测试；小样本冒烟证明每个场景的终点判定能达成；每个正文样本都经过计时外的真实输入核验，判定写错只会失败，不会给出假的快数字。
- 修正：守卫测试、受影响的单元与 DOM 测试、`bun run test:e2e`、复测前后对比。
- 未验证的边界：有头 Chrome 与真实显示器的帧时序（本机无图形会话）；跨机器访问（毫秒标准只针对本机）；桌面版；其它操作系统。

## 不做

- 预读与编辑器代码的空闲预取（见第 5 节）；草稿跨刷新、自动保存；桌面版与跨机器的测量。
- 不把毫秒阈值写进自动化测试。

## 风险

- 机器负载造成波动：报告运行前后的 `loadavg`；正式运行前只读查看有无其它重负载进程（不结束别人的进程），负载高时推迟。
- 无头 Chrome 的 rAF 与真实显示的帧可能不同：报告写明，16 ms 的判断同时给帧数。
- 修正可能触及 t70/t71 刚审查过的代码：每个修正都跑对应的 e2e 与变异检查。
