---
schema: nbook.task/v2
taskId: t42-files-baseline-research
---

# Files 竖切第 1 片：耗时测量与 VS Code 针对性调研

## 目标与范围

阶段 2 Files 竖切的第 1 片（切片顺序见[整体实施路径](../../implementation-plan.md#阶段-2files-竖切项目文件底座)）。先弄清时间花在哪里、VS Code 怎样做，再动底座与资源管理器。本片不改产品行为。

1. **耗时测量。** 在约 3000 个 Markdown 文件、3–5 层目录、单章 5–30 KB 的合成样本上（放在系统临时目录，不用用户数据），用生产构建分别在本机浏览器与桌面版上测：
   - 打开项目：从进入项目到文件树可操作，拆成服务端列目录与索引构建、frontmatter 解析、请求次数与大小、前端建树与首次渲染；
   - 切换文件：从点击到正文可编辑，拆成请求、服务端读取、传输、前端解析（源码与富文本分开）、编辑器控件与模型创建、界面重渲染；冷开与热切换、单组与多组分开；
   - 每项记录 p50/p95 与波动范围，复现开发者报告的约 0.3 秒切换延迟并给出构成。
   - 测量用现有的 Server-Timing、浏览器性能接口与跟踪工具，不在产品代码里加测试专用分支。
2. **VS Code 针对性调研。** 沿用既有调研固定的 VS Code 提交（[调研目录](../../../../../packages/neuro-book/docs/research/vscode/README.md)），用源码核实：文件系统提供者的能力声明与 `FileService` 的分派；资源管理器按需解析子目录与刷新；长列表虚拟化；文件监视的实现与范围；打开与切换编辑器路径上的延迟处理。结论按调研目录的证据标签写成新章节。
3. **结论。** 根据测量与调研，给出第 2–4 片的优先级与具体改法建议，并核对[性能标准](../../../../../docs/specs/workbench/files-explorer.md#打开与切换)是否可达；不可达的项提出修改建议，交开发者决定。

依据：[项目文件底座与 Files 竖切](../../../../../packages/neuro-book/docs/proposals/project-file-foundation.md)（`accepted`）的方案第 5、6 节与“VS Code 参照”；[`workbench.files-explorer`](../../../../../docs/specs/workbench/files-explorer.md) 的性能标准与验收场景 12。行为合同未变。

## 当前状态

2026-10-03 完成，待开发者确认结论。耗时测量由 omp 写脚本并产出基线（任务说明见 [brief.md](brief.md)，交付见 [delivery.md](evidences/delivery.md)，经一轮返工）；VS Code 调研与结论由主 Agent 完成，调研写成 [第 16 章](../../../../../packages/neuro-book/docs/research/vscode/16-file-service-explorer-editor-latency.md)。桌面版未测：本机没有 Electron；桌面版加载的是同一本机服务页面。

测量脚本：`bun run --cwd packages/neuro-book perf:files-baseline`（`packages/neuro-book/scripts/perf/`），支持样本规模、种子、重复次数、`--skip-build` 与 `--include-development`。产品代码只加了常驻计时点（Server-Timing 的 `files.*`、User Timing 的 `files.*`/`editor.*`，固定名字），原 `workspace.*` Server-Timing 改名为 `files.tree.*`；行为不变。

## 测量结果

环境：Intel Core i5-1035G1（8 逻辑核）、16 GB、Linux、无头 Chrome 151、1440×1000，生产构建。合成样本：3000 个 Markdown，5–30 KB，lorebook 内容节点 30%、按卷章节 33%、普通笔记 37%，目录 3–5 层。正式基线每格 30 次（打开项目 10 次），见 [baseline-report.md](evidences/baseline-report.md)。

| 场景（3000 个文件） | p50 | p95 |
|---|---:|---:|
| 打开项目（服务刚启动） | 6226 ms | 7421 ms |
| 再次打开项目 | 5814 ms | 6442 ms |
| 展开 400 项目录 | 364 ms | 390 ms |
| 从文件树首次打开文件 | 1526–1562 ms | 1597–1711 ms |
| 从文件树点开已打开过的文件 | 1057–1095 ms | 1086–1173 ms |
| 点击已打开的标签 | 867–910 ms | 884–969 ms |
| 文件树选中反馈 | 3 ms | 6 ms |

范围是富文本与源码、单组与双组四种组合。热切换不发任何文件请求；首次打开只有一次 read（请求 12–15 ms，其中服务端读取约 2 ms）。

**规模扫描**（主 Agent 独立重跑，每格 10 次，同一构建）：

| 文件数 | 打开项目 | 首次打开文件（富文本单组） | 点击已打开的标签（富文本单组） |
|---:|---:|---:|---:|
| 40（omp 试跑） | 约 0.8 s | 约 300–400 ms | 约 50 ms |
| 300 | 1217 ms | 414 ms | 146 ms |
| 1000 | 2830 ms | 889 ms | 348 ms |
| 3000 | 6082 ms | 1643 ms | 942 ms |

3000 个文件的重跑与 omp 的正式基线相差 5–8%（本次系统负载稍高）。切换耗时随文件数近似线性增长：标签切换从 300 到 1000、从 1000 到 3000 个文件都是每个文件约 0.3 ms。

**耗时构成：**

1. **切换：每次状态变化都深度遍历整个 store。** `novelIde` store 配了两条 `persist`；pinia-plugin-persistedstate 对每条调用 `store.$subscribe`，Pinia 的 `$subscribe` 以 `deep: true` 监听整个 store 状态，`pick` 只决定写入哪些字段，不缩小监听范围（源码：`pinia/dist/pinia.mjs` 的 `$subscribe`、`pinia-plugin-persistedstate` 的 `persistState`）。store 里有 3000 个节点的完整文件树与已打开文件的正文缓冲。CPU 采样：首次打开窗口约 1.2 s 落在 Vue `traverse`，占 74–76%；开发构建的未压缩调用栈确认来自深度 `watch` 的 getter。点击标签切换中“标签状态发布→视图发布”与“视图发布→可编辑”各约 420–450 ms。因果尚未用关闭订阅的对照实验定量。
2. **从文件树单击：固定等待 180 ms。** `WorkspaceFileNode.vue` 的 `scheduleSelectNode` 单击后等 180 ms 才以预览打开，以便双击取消预览改为常驻。每次文件树点击的“点击→激活”都是 180 ms。VS Code 单击立即以预览打开，双击再固定（[第 16 章](../../../../../packages/neuro-book/docs/research/vscode/16-file-service-explorer-editor-latency.md)）。
3. **打开项目：服务端建完整快照，前端深度处理 4.4 MB。** 三段互斥区间（p50）：点击到 open 响应 520 ms；open 响应到 tree 响应 3644 ms（tree 接口等完整文件索引，服务端采样中 frontmatter 与 YAML 解析约占 27%，响应 4.4 MB）；tree 响应到可操作 2008 ms（前端 Vue 深度遍历约 1.7 s，投影 73 ms、建树 9 ms）。
4. **展开目录：** 文件树已整体在前端，展开 400 项不发请求，耗时是渲染 400 行，最长任务约 98 ms。

**约 0.3 秒的来源：** 40 个文件的试跑中，从文件树首次打开文件约 300–400 ms（[试跑报告](evidences/review-1-spa-smoke-2-report.md)，样本少），代表样本 373 ms = 单击等待 181 + 读 17 + 发布 9 + 视图 125 + 可编辑 40 ms。即小项目里 0.3 秒主要是 180 ms 单击等待加一次 store 遍历与编辑器挂载；项目越大，遍历越慢。开发模式与生产差异在 10% 以内，不是开发构建特有。

## 结论

**性能标准核对（3000 个文件）：**

| 标准 | 现状 | 判断 |
|---|---|---|
| 打开项目 1 s 内，第二次约 300 ms | 6.2 s / 5.8 s | 现有“全量快照 + frontmatter”结构达不到；改为按需列目录（第 2、3 片）后，打开只列根目录，按 VS Code 机制推断可达 |
| 选中与标签 16 ms 内切换 | 选中 3–6 ms；标签随正文一起出现（0.9–1.6 s） | 选中已达标；标签需先于正文切换（第 4 片乐观切换） |
| 已打开过的文件 100 ms 内 | 867–942 ms（300 个文件 146 ms） | 去掉随规模增长的遍历后可达：t24 在小项目上已测到 33–47 ms |
| 未打开过的章节 200 ms 内 | 1.5–1.6 s（300 个文件 414 ms） | 去掉单击等待与遍历后，剩余为读文件约 15 ms 加编辑器挂载；在本机这台较慢的机器上余量不大，需在第 4 片实测确认 |
| 展开几百个子项不卡 | 400 项 364 ms，最长任务约 98 ms | 需要虚拟化（第 3 片） |

**建议的第 2–4 片改法与优先级（交开发者决定）：**

1. **store 深度订阅先单独修（建议提前，作为第 2 片之前的一个小任务）。** 它同时拖慢打开项目（前端约 2 s）与每次切换（0.9 s），改动面小、收益最大、与底座重构无依赖。做法：持久化只订阅要保存的字段，不对整个 store 做深度监听；文件树与正文缓冲改为浅层响应（`shallowRef`/`markRaw`），不进入深度遍历。先做一次关闭订阅的对照实验定量，再改。
2. **第 2 片（资源层底座）：** 列目录接口只返回一层的名字与类型，不读文件内容、不解析 frontmatter；读文件一次请求同时返回内容与元数据（现状在树中找不到节点时先 stat 再 read）。
3. **第 3 片（三类文件夹与资源管理器）：** 按需展开、首次展开后缓存；虚拟化列表；保存展开状态，重开只列原展开目录；自己的操作就地更新树，外部监视事件合并约 500 ms 后只刷新已展开的目录。
4. **第 4 片（打开与切换）：** 单击立即以预览打开、双击固定，去掉 180 ms 等待；标签与选中先切换，编辑区空白，800 ms 后才显示进度条；新的打开取消上一次读请求。

**开发者决定（2026-10-03）：**

- 性能标准写明参考机器，就用本次测量机（选较慢的机器以暴露性能问题），已写入 [`workbench.files-explorer`](../../../../../docs/specs/workbench/files-explorer.md#打开与切换)。
- 桌面版不单独测。
- glob 与 grep 的位置（提供者能力，还是 VS Code 式的独立搜索服务）只在出现虚拟方案时才有差别，本阶段的方案都有真实路径，暂不决定，沿用 `workspace.resources` 现有写法。
- store 深度订阅何时修：待开发者确认。

## 验收

- 主 Agent 复核：`typecheck` 与 `scripts:typecheck` 0 错误；受影响目录测试 90 个文件、714 个用例通过；全量 `bun run test` 失败 10 个文件、23 个用例，与已知基线逐一相同，无新增失败。
- 主 Agent 独立重跑测量（重新构建生产镜像）：3000 个文件与 omp 基线相差 5–8%；补充 300、1000 个文件规模扫描。
- 返工一轮：去掉为迁就测试替身加在产品接口里的 `event.context ??= {}`；计时点改为固定名字、不留无用 mark；恢复 `EditorViewHost.vue` 原语句顺序；`files.activation.read` 只包住读请求。
- 证据：主 Agent 的复核输出在 [evidences/acceptance/](evidences/acceptance/)（`typecheck.txt`、`scripts-typecheck.txt`、`affected-tests.txt`、`full-test.txt`，以及三档规模的 `accept-*.md`/`.txt`/`.json.gz`）；omp 的正式基线与审计在 `evidences/` 根下，原始数据压缩为 `.json.gz`。仓库按 `.gitignore` 不收 `*.log`，[delivery.md](evidences/delivery.md) 引用的 omp 日志、性能跟踪、CPU profile、截图与各次试跑产物都不入库，可用脚本重新生成。

## 下一步

开发者确认结论与上面的待决事项后，按确认的顺序开下一个 Task（store 深度订阅修复或第 2 片资源层底座）。
