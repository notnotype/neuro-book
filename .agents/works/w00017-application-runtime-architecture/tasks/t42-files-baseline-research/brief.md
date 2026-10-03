# 任务说明：Files 现状耗时测量（w00017 t42）

你是本任务的编码者。主 Agent（Claude）会审查你的 diff、自己重跑测量并决定验收。用简体中文写最终汇报。

## 背景

阶段 2 要重做项目文件底座与文件资源管理器。开发者的实际体验：打开项目要等文件树预读并解析全部 frontmatter；在本机浏览器里切换文件有约 0.3 秒延迟。动手前先量清时间花在哪里。本任务只测量，不改产品行为；VS Code 调研与结论由主 Agent 另做。

依据（先读）：
- `.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/README.md` 第 1 项“耗时测量”；
- `docs/specs/workbench/files-explorer.md` 的“打开与切换”一节（性能标准表）与验收场景 12；
- `packages/neuro-book/docs/proposals/project-file-foundation.md` 的“当前行为与证据”与方案第 5、6 节；
- `docs/testing/README.md`（临时根、证据与验证门禁）。

再读现有实现：
- 打开项目与文件树：`server/api/projects/open.post.ts`、`server/api/workspace-files/tree.get.ts`、`server/workspace-files/project-file-index.ts`、`project-workspace-index.ts`、`content-node-schema.ts`；前端 `app/features/files/`、`app/components/novel-ide/workspace/`（`WorkspaceFileTree.vue`、`workspace-file-tree.ts`、`FilesExplorerView.vue`）；
- 切换文件：`app/stores/novel-ide.ts` 中 `requestWorkspaceActivation` 一路（stat、read、缓冲、`openEditorTabInGroup`）；`app/components/editor-workbench/`（`EditorGroup.vue`、`EditorViewHost.vue`、`MarkdownEditorView.vue`、`MonacoCodeEditor.vue`）；`app/components/markdown-studio/`（TipTap 与 Monaco 加载）；
- 计时：`server/utils/server-timing.ts` 与现有使用者；
- 生产构建、State Root 准备与浏览器驱动的现有做法：`scripts/smoke/product-lifecycle.ts`、`scripts/smoke/product-lifecycle/browser.ts`（`playwright-core` + 本机 `/usr/bin/google-chrome-stable`）；临时根用 `@notnotype/neuro-book-test-support/paths`。

## 目标

新增一个可重复运行的测量脚本，并用它在生产构建上产出一份基线报告。

### 1. 合成样本

- 约 3000 个 Markdown 文件，目录 3–5 层，单个文件 5–30 KB；固定随机种子，同一参数生成相同样本。
- 布局贴近现有项目，让现有的 frontmatter 解析路径真实生效：内容节点（带 `index.md` 与 frontmatter 的目录，如 `lorebook/` 下的角色、地点）、章节（`manuscript/` 下按卷分组）与普通笔记都要有；比例由你定，写进报告。至少一个目录直接包含 300 个以上子项，用于测展开。
- 正文用生成的文本，不用任何用户数据或仓库外的素材；每个文件含一个唯一标记，供浏览器判断“正文已显示”。
- 放在系统临时目录（经 `neuro-book-test-support` 的路径函数），测完清理，保留时在报告中写明路径。
- 项目通过产品现有的入口进入工作区（例如经产品接口创建项目后写入样本文件，或使用产品支持的导入方式），不伪造产品内部元数据。具体做法由你找现有的自然路径并说明。

### 2. 测量场景

每个场景重复足够次数（切换类每项不少于 30 次，打开项目类不少于 10 次），记录 p50、p95、最小与最大值，原始数据全部保留。

**A. 打开项目**：从发起打开到文件树可操作（文件树已渲染出根层条目、可点击）。冷启动（服务刚启动后的第一次打开）与再次打开分开。拆成：
- 服务端：打开项目接口与文件树接口各自的耗时，其中列目录与索引构建、frontmatter 解析各占多少；
- 网络：请求次数、每个请求的大小与耗时；
- 前端：建树与首次渲染。

**B. 展开目录**：展开含 300 个以上子项的目录，到子项全部渲染完成的耗时，以及期间最长的主线程阻塞。

**C. 切换文件**：从点击文件树条目到正文可编辑（编辑器中出现该文件的唯一标记，且编辑区可输入）。分开记录：
- 冷开（该文件第一次打开）与热切换（已打开过的文件或已有标签之间切换）；
- 富文本（TipTap）与源码（Monaco）两种视图；
- 单个编辑组与两个编辑组；
- 每次拆成：请求（stat、read 各自的次数与耗时）、服务端读取、传输、前端解析、编辑器控件与模型创建、界面重渲染，以及期间的长任务。

**D. 复现约 0.3 秒的切换延迟**：说明哪个场景、哪种条件下出现，延迟由哪几段构成。生产构建上复现不出来时，再用开发模式（仓库现有的开发启动命令，空闲端口）补测同一切换场景作对照，并写明两者差异。

另外记录测量环境：CPU 型号与核数、内存、Chrome 版本、当前 commit、测量期间的系统负载。

**桌面版不在本次测量范围**：本机没有安装 Electron，不要为此安装。报告里写明“桌面版未测”。

### 3. 测量手段

- 优先用现有手段：Server-Timing、浏览器的 Resource Timing、User Timing、Long Tasks / Long Animation Frames 接口、Chrome 性能跟踪（CDP tracing）、服务进程的 CPU profile。
- 现有计时点不够拆分时，**可以**在下列边界上加常驻的计时点：服务端用 `createServerTiming` 加 Server-Timing mark（打开项目、文件树、stat、read 接口，以及索引构建中“列目录”“解析 frontmatter”这类阶段）；前端只用 `performance.mark` / `performance.measure`（文件打开链路与编辑器挂载的边界）。要求：计时点无条件生效，不读环境变量或测试开关，不改变任何返回值、顺序或时机；名字统一以 `files.` 或 `editor.` 开头；每个计时点放在拥有该阶段的边界上，不在调用方重复包一层。全部列入汇报。
- 用跟踪与 CPU profile 拆分时，把用到的函数名与归类方法写进报告，便于主 Agent 复核。

### 4. 产出

- 测量脚本：`packages/neuro-book/scripts/perf/files-baseline.ts`（可拆出同目录下的样本生成等模块），在 `packages/neuro-book/package.json` 增加一条脚本 `perf:files-baseline`。支持复用已有构建（类似 smoke 的 `--skip-build`）、指定报告路径、调整样本规模与重复次数。
- 样本生成器中决定结构的纯函数（例如路径与大小分布、种子稳定性）写单元测试；需要启动产品的部分不写单元测试。
- 报告：证据目录 `.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/` 下的 `baseline-report.json`（全部原始数据与统计）和 `baseline-report.md`（按场景 A–D 的表格与结论）。性能跟踪与 CPU profile 文件可能很大：只在证据目录放不超过 5 MB 的代表性文件，其余留在系统临时目录并在报告中写明路径。

## 允许改动的文件

- 新增 `packages/neuro-book/scripts/perf/**`（脚本、样本生成器及其测试）；
- `packages/neuro-book/package.json`：只新增 `perf:files-baseline` 一条脚本；
- 只为加计时点：`server/api/projects/open.post.ts`、`server/api/workspace-files/{tree,stat,read}.get.ts`、`server/workspace-files/project-file-index.ts`、`server/workspace-files/project-workspace-index.ts`、`app/stores/novel-ide.ts`、`app/components/novel-ide/workspace/**`、`app/components/editor-workbench/**`、`app/components/markdown-studio/**`（以上路径都在 `packages/neuro-book/` 下）；
- `scripts/smoke/product-lifecycle.ts`、`scripts/smoke/product-lifecycle/browser.ts`：只允许给已有函数加 `export` 以便复用，不改其行为；
- 本 Task 的证据目录。

不改：其它产品代码、`runtime/**`、`docs/**`、任何 `README.md` 与 Work/Task 文档、锁文件、`tsconfig*.json`、`vitest*.config.ts`、`nuxt.config.ts`、`desktop/**`。确实需要改列表外的文件时，先在汇报中说明原因，不要自己改。新增文件若按仓库规则需要配套登记，先在汇报中说明。

## 验证命令与完成标准

命令从 worktree 根目录执行，包内命令用 `bun run --cwd packages/neuro-book <脚本>`：

1. `scripts:typecheck` 0 错误；改了产品代码时 `typecheck` 也 0 错误。
2. 新增的单元测试，以及被加了计时点的文件所在目录的已有测试（例如 `test -- server/api/workspace-files server/api/projects server/workspace-files app/components/novel-ide/workspace app/components/editor-workbench app/components/markdown-studio app/stores`）：全部通过。
3. `perf:files-baseline` 在生产构建上完整跑通，产出上面两份报告；报告覆盖场景 A–D 的每一项（桌面版标明未测），每项有样本数、p50、p95、最小与最大值。
4. 全量 `bun run test` 由主 Agent 跑，你不用跑。
5. 把第 1–3 步的完整输出保存到证据目录。

本机内存有限：构建、测量、开发服务与类型检查不要并行跑，一次只跑一个重任务；测量期间不要跑其它重任务，以免干扰数据。构建期间不要改动 worktree 中的文件。开发者可能开着 `nuxt dev`：用空闲端口，只结束你自己启动的进程，按 pid 结束。等进程退出用 `wait <PID>` 或检查输出里的结束标记，不用 `pgrep -f` 循环。浏览器用独立的临时用户数据目录，不碰本机已在运行的其它 Chrome。

本次运行有 3 小时上限，到点会被直接截停。**先写 `delivery.md`**（按下面“最终汇报”的结构写设计），测量跑完后再补结果。

## 禁止清单（汇报前逐条自查，在汇报中逐条写明结果）

- 不按错误文案做程序分支，用错误类型或错误码；不用静默的 `catch` 吞掉错误，至少写一条诊断；
- 不为让测试或检查通过而掩盖问题：不跳过测试、不放宽断言、不把一种失败改报成另一种，不在产品代码里加测试专用分支；
- 不删除或替换任务之外的已有代码行、配置项（例如 `package.json` 里的其它 scripts）和注释，也不顺手改写无关注释；
- 重构时保留原有的清理与收口语句（例如失败分支里的资源释放），不留下多余的第二条路径或不可达的代码；
- 不跨包深导入其它包的源码，跨包只经包名与公开入口；
- 不确定能否检查或实现时，先找现有的自然做法，不要直接标成“无法做到”；
- 不用 `rm -rf` 清理仓库内的目录；误写的文件逐个删除，删除前用 `git ls-files` 确认它们没有被跟踪。写证据的命令从仓库根执行，用仓库根相对路径。

设计与主要编码由你自己完成，不交给子代理；子代理只用于调研、审查或批量机械改动这类独立、简单而工作量大的活。子代理给出的事实性结论要你自己实测确认后才能写进代码注释或汇报。

另外：不 `git commit`、`git push`、`git stash`、切分支，不改 git 配置；不设置 http_proxy，不改时区与 locale；测量产生的临时数据放在系统临时目录并清理；注释用中文，只写边界上不明显的原因，不复述代码；测试不匹配源码字符串。仓库规则见 worktree 根目录的 `AGENTS.md`，TypeScript 规范见 `docs/standards/code/`。不要触碰 `packages/neuro-book/docs/research/README.md`（开发者自己的改动）。

## 最终汇报

写入证据目录的 `delivery.md`，再输出同样内容：

1. 结论：完成标准 1–3 各自的结果（附证据文件名）；场景 A–D 的主要数字；约 0.3 秒延迟是否复现、在什么条件下、由哪几段构成；
2. 测量设计：样本结构与比例；“文件树可操作”与“正文可编辑”的判定方法；每一段耗时用什么手段取得、怎样归类；
3. 新增的计时点清单（文件、名字、所在边界）；
4. 改动的文件列表；
5. 禁止清单逐条自查结果；
6. 测量的局限与可疑数据（不超过 5 条）。
