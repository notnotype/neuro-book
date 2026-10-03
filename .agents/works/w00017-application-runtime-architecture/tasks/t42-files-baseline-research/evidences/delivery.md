# Files 基线测量交付

## 1. 结论

完成标准 1–3 均已取得证据。最终正式报告 `baseline-report.json` / `baseline-report.md`：completed=true，770/770 有效（生产 A20+B30+C360，开发 C360），27 个格完整，无重复 ID；720 个 C 样本均通过真实输入、撤销与 dirty 不变核验。桌面版未测。

| 完成标准 | 结果与完整输出 |
|---|---|
| 1. 类型检查 | 产品 `typecheck` 0 错误：`typecheck-review-1.log`；最终 `scripts:typecheck` 0 错误：`scripts-typecheck-delivery-final.log` |
| 2. 测试 | 受影响目录 90 files passed、2 skipped；713 tests passed、5 skipped：`affected-tests-review-1.log`。最终脚本 2 files、7/7：`perf-tests-delivery-final.log`。5 个跳过均为既有 Windows 条件测试，本轮未新增 skip 或放宽断言 |
| 3. 生产完整测量 | 新生产构建成功：`baseline-build.log`。正式补测退出 0，1099.41 秒，770/770：`perf-baseline-final.log`；最后脚本边界/报表修正再跑生产 smoke，15/15、completed=true：`final-script-smoke-report.json`、`perf-script-delivery-final.log` |

本轮生产矩阵最初完成后，开发启动错误使旧 workflow 退出非零；原报告与日志保留在 `review-1-development-start-failure/`，未改写为成功。正式补测用 `--resume-production` 校验镜像 imageId/sourceDigest、生成参数、次数/迭代、目录动画/数量、正文 marker/组数/真实输入及五个代表 profile；保留原 410 条 raw，只重算 CPU 分类，再补开发 C 和生产项目打开 Chrome/Bun CPU profile。`baseline-audit.json` 核验原生产 raw 值完全一致、互斥区间误差为 0、11 个 profile/21 个原始文件存在且大小一致，最大 2,626,661 bytes，均未超 5 MiB；正式和来源业务临时根已删除，未发现进程引用，retainedProfiles=[]。

正式补测命令：`bun run --cwd packages/neuro-book perf:files-baseline -- --skip-build --resume-production .agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/evidences/review-1-development-start-failure/baseline-report.json`。全量重跑用 `bun run --cwd packages/neuro-book perf:files-baseline`；支持 `--skip-build`、`--report`、规模/seed/重复次数/浏览器路径及 `--include-development`。正式运行期间 worktree 文件冻结，构建、类型检查、测试、测量串行。全量 `bun run test` 按 brief 留给主 Agent。

A/B 生产结果（ms）：

| 场景 | n | p50 | p95 | 最小 | 最大 |
|---|---:|---:|---:|---:|---:|
| A 服务刚启动后打开 | 10 | 6226.30 | 7421.13 | 5928.90 | 7433.10 |
| A 同进程关闭后再次打开 | 10 | 5814.40 | 6441.68 | 5217.90 | 6571.10 |
| B 展开 400 项目录 | 30 | 363.90 | 390.21 | 347.60 | 429.40 |
| B 每次最长完整 Long Task | 30 | 98.00 | 115.65 | 87.00 | 161.00 |

A 每次恰好一条 open 和 tree 请求；完整 tree 响应 4,402,679 bytes。冷开 open 请求 p50/p95=465.25/542.13 ms，tree=3618.95/4690.76 ms；tree 传输=11.95/13.68 ms，响应结束到可操作=2008.00/2204.77 ms。前端模式投影=73.15/79.02 ms，建树=9.30/10.45 ms。再次打开 tree=3291.70/3791.93 ms，响应后可操作=2014.00/2215.59 ms。open 只等 required module minimum-ready，完整 File Index warm-up 在后台，不能把 open 响应当成完整树就绪。

代表项目打开 6650.50 ms，互斥区间为点击到 open 响应 603.50、open 到 tree 响应 3914.50、tree 响应到可操作 2132.50 ms。Bun 分类采样区间：frontmatter/YAML 1791.86 ms（26.94%）、目录与索引/路径校验 578.96 ms（8.71%）、索引问题校验 40.38 ms、文件读取 CPU 14.81 ms、GC 1.17 ms、未归类 4223.32 ms。Chrome 同窗口 Vue 深度遍历 1725.62 ms，最长任务 2106 ms。服务原始采样有 1618.906 ms 和 462.936 ms 的长间隔；分类是采样时间戳区间，不是精确 CPU 活跃时长或异步 I/O 分解，不能据压缩函数 jVg 断言它执行了 1.62 秒。tree 响应后的残余还包含 JSON 解码、状态发布、Vue 更新、DOM 渲染和两帧确认。

C 每格 n=30，p50/p95（ms）；全部最小、最大及每次明细见正式报告：

| 模式/组数 | 入口 | 生产 p50/p95 | 开发 p50/p95 |
|---|---|---:|---:|
| 富文本/1 | 冷开树 | 1531.20/1710.65 | 1631.10/1855.60 |
| 富文本/1 | 热树 | 1066.15/1092.85 | 1080.80/1120.10 |
| 富文本/1 | 热标签 | 867.25/890.24 | 890.70/920.42 |
| 富文本/2 | 冷开树 | 1526.05/1596.26 | 1560.20/1634.15 |
| 富文本/2 | 热树 | 1057.05/1085.91 | 1074.70/1093.64 |
| 富文本/2 | 热标签 | 874.70/883.53 | 894.85/944.47 |
| 源码/1 | 冷开树 | 1553.30/1620.39 | 1663.60/1712.21 |
| 源码/1 | 热树 | 1095.40/1117.88 | 1160.10/1201.53 |
| 源码/1 | 热标签 | 909.80/931.44 | 973.00/999.27 |
| 源码/2 | 冷开树 | 1561.55/1596.82 | 1652.95/1691.28 |
| 源码/2 | 热树 | 1094.05/1172.85 | 1163.10/1203.92 |
| 源码/2 | 热标签 | 905.90/969.16 | 981.50/1025.79 |

240 次正式冷开均为 read=1、stat=0；480 次热切换 read/stat 合计为 0，且无 TipTap/Monaco create/model measure。生产单组冷开富文本 read 请求 p50/p95=14.60/19.00 ms，服务 read=2.30/4.79 ms，传输=1.10/1.55 ms；`files.activation.read` 却为 435.05/492.86 ms，因为 await 含主线程排队、JSON 解码和 continuation，不能解释成服务读文件用了 435 ms。源码同格 read=11.95/15.26 ms，服务=1.70/2.41 ms；Monaco model=0.30/0.66 ms、create=4.25/7.40 ms，mount=442.65/453.09 ms。TipTap create=450.85/477.83、initialize=442.85/471.04 ms，是含异步 onCreate 调度的联合区间。

生产富文本首个冷开 2173.00 ms 的互斥区间为 180.90/18.40/591.50/1332.30/49.90 ms（单击等待/activation 到 read 响应/read 响应到 session/session 到 view/view 到可编辑）。首个热标签 854.80 ms 为 0.20/0/0/407.80/446.80 ms。生产四个冷开代表 profile 的 Vue traverse 分类区间为 1180.33–1211.91 ms，占窗口 74.32%–76.28%；开发对应为 1207.78–1301.56 ms，占 73.71%–75.72%。真实 bundle `go` 与开发未压缩 `traverse` 均由唯一函数体、URL 和行列范围匹配。代码中 Pinia `$subscribe` 深度观察全 store，persist 的两个 pick 配置不缩小 watch 来源；这是订阅机制推断，尚未用干预证明具体订阅造成全部遍历。本任务未优化它。

文件树选中反馈 p95 为约 3–6 ms；目标标签仍随正文链路延后。生产单组富文本热标签的选择/标签观测 p95=876.75 ms、最长任务 p95=881.60 ms。因此生产打开、冷/热正文和标签反馈超过 Files Spec 时限；测量任务通过不代表性能达标。

D：正式生产和开发各 360 次 C 均没有 250–400 ms 样本，count=0、分位数为空。生产范围 854.80–2173.00 ms，开发 875.60–2743.30 ms，实际延迟更长。40 文件、每文件 5120 bytes 的已完成试跑 `review-1-spa-smoke-2-report.json` 曾出现该区间：生产 6 个，p50/p95=279.15/360.12 ms；开发 5 个，270.20/326.48 ms。生产代表冷开富文本单组 372.70 ms，由 181.40/16.80/8.90/125.20/40.40 ms 构成；开发代表冷开富文本双组 300.80 ms，由 180.40/17.90/17.20/65.00/20.30 ms 构成。它们说明小工程文件树入口可见约 0.3 秒，主要固定成本包含 180 ms 单击等待；不并入正式 raw，不把小样本结论扩大为开发者实际项目归因。

环境：Intel Core i5-1035G1 @ 1.00GHz，8 逻辑 CPU，16,429,027,328 bytes 内存；Linux x64，Bun 1.4.2、Nuxt 4.4.8、Nitro 2.13.4，headless Chrome 151.0.7922.71，1440×1000。逐样本 loadAverage[0]：生产 0.91–2.86，开发 0.98–3.55。checkout=`.worktree/w00017-runtime-foundation`，branch=`refactor/w00017-runtime-foundation`，HEAD=`a7346d225d48b8496078001a5ddfa656da85e827`，本任务无独立 commit、改动未提交。生产 imageId=`sha256:895f3503035c8956947a40e2f2097e5b873109a6ec38283deb8cafd78801f03f`，sourceDigest=`sha256:8d2af8044852a5494b15f22b61bb02f43bb39e7e44c3870a7458264c52fb5cc4`，dirty=true；HEAD 不能单独代表本 diff。最终 `git diff --check` 通过。

## 2. 测量设计

- 固定 seed `42017`，每项目生成 3000 个 Markdown，5120–30720 bytes，合计 52,769,090 bytes。root `index.md` 1 个、lorebook 899 个（29.97%）、manuscript 999 个（33.30%）、notes 1101 个（36.70%）；`notes/wide/` 直接含 400 文件。官方创建入口的 39 个默认 Markdown 模板文件保留，实际约 3039 个；报告 fileCount/totalBytes 指生成器，不包含模板。主体路径深度 3–5 层，根与宽目录为浅层入口。marker 同时在 frontmatter title 与正文首段，不添加产品钩子。
- 系统临时根经 `@notnotype/neuro-book-test-support/paths` 公开入口分配；官方 Product bootstrap 做 migration/admin/启动。真实 POST `/api/projects` 返回 projectRoot 后写样本，通过 Picker 真实 click 打开。开发沿用 Manager 的 `dev:runtime`，脚本持有 token/nonce 与进程组，登录、新建、返回书架走真实 UI 的 SPA 路由；不同模式使用独立项目，避免旧标签/分组污染。
- A：服务重启后首次打开 10 次；同进程关闭后再次打开 10 次。不清 OS 页缓存。capture click 到 Files explorer 和 lorebook/manuscript/notes 根行可见、中心可命中，连续两个 RAF 满足条件。
- B：400 项宽目录折叠后展开 30 次。capture click 到全部直接子行挂载、数量正确且展开动画结束，连续两个 RAF 满足。当前完整 tree 快照已发布，B 是客户端展开；不将零 tree 请求解释为按需目录协议。
- C：cold-tree/hot-tree/hot-tab × rich/source × 单组/双组，12 格各 30 次，共 360 次。双组 hot-tab 作为补充保留。冷开用本项目内未打开的不同文件，保持产品单击默认 preview 行为；只有热切换两文件先双击固定为 permanent。文件树单击保留产品既有 180 ms 等待，标签入口另计。计时起点为 capture click，终点为实际活动组数正确、目标标签选中、可见编辑器包含标记、输入宿主可写且 panel 不 busy，连续两个 RAF 满足。每个样本在窗口外实际键入、核对可见、Ctrl+Z 撤销，再核对 dirty 不变；失败不进入有效分位数。
- D：从成功生产 C 中筛选 250–400 ms，不复制样本形成另一份 raw。逐原始 ID 登记条件、分位数和代表样本互斥区间。生产未出现时停止生产，按既有 `dev:runtime` 命令以相同规模和不同合成项目补测 C；可通过 `--include-development` 强制运行。开发是否完整结束、未取得/部分样本与真正复现分别报告。
- 默认常规生产样本为 A20 + B30 + C360 = 410。预热、独立 CPU/trace 与输入证明不进入常规统计。分位数使用线性插值 `(n-1)*p`，每格保留 count/p50/p95/min/max；失败保留原始数据与诊断，完整未完成时退出非零。
- Resource Timing 保留每请求 duration/TTFB/body transfer/encoded、decoded、transfer bytes 与 Server-Timing；每操作统计 stat/read 次数（含零），User Timing 仅按固定名字的 measure 聚合。Long Tasks/LAF 保留原始条目，最长完整任务可能跨窗口边界。
- 关键路径按点击→activation→read 响应末尾→session 发布→view 发布→跨帧可编辑单调切分，相加为操作总时长；嵌套 parse/model/control measure 不再相加。TipTap initialize 是解析、模型、控件联合阶段，CPU 采样类别不能冒充独立异步 wall-clock。
- Chrome CDP 1000 µs CPU sampling 与 `devtools.timeline,blink.user_timing,v8.execute` 独立运行。脚本自身临时校准 mark 对齐 performance.now 与 trace monotonic 微秒，裁剪到 click-to-ready，trace 仅取页面 pid/tid 主线程；校准 mark 随后清理。服务 CPU 用 Bun `--cpu-prof` 直接采样 `.output/server/index.mjs`，按 performance.timeOrigin 对齐 Unix 微秒，只分析代表项目打开窗口。服务压缩函数在本次构建 AST 以独特函数体唯一识别，JSON 保留源码符号、压缩名字、行列和 matchedBy；不确定名称保留未归类。负 timeDeltas 原始保留，累积时间戳排序后切非负区间，报告负 delta 数。
- 浏览器 Vue `traverse` 使用真实 bundle 的 `__v_skip`、`new Map`、`Object.getOwnPropertySymbols`、`propertyIsEnumerable` 独特函数体唯一识别，记录 URL、压缩名、函数起止行列；CPU frame 必须同时落在该脚本及函数范围才归类为 Vue 深度遍历。祖先栈只能证明 watch/effect 深度遍历，Pinia/persist 源码可说明订阅全 store 的机制；本轮不通过禁用持久化等干预证明因果，不优化产品。
- 代表性 trace/profile 单文件不超过 5 MiB 才放正式证据目录；超限只保留系统临时 retained-profiles 并登记路径，作品、State Root 和 Chrome profile 在 finally 清理。stdout 与服务 JSONL 均归档。上一轮 `/tmp/neuro-book/t42-files-baseline-IWXjAq` 已确认无占用并清理，证据在 `interrupted-round-1/cleanup.json`。
- 与 t16/t24：两者是 Windows、Chromium 151.0.7922.34、Source Dev、1440×1000、两份 8 KiB Markdown 的 permanent 标签切换，3×30 次；t24 单组 rich p50/p95=33.5/38.0 ms，source=43.5/53.8 ms。本轮 Linux/headless/生产/3000 文件/5–30 KiB/逐样本输入验证。视口和 capture 起点一致，只有 hot-tab 入口对应，构建、平台、样本规模、文件大小和跨帧终点不同，不能据此直接计算回归幅度。

## 3. 新增计时点清单

所有常驻前端计时使用固定名字、局部 `performance.now()` 起止，不生成 mark、递增序号或环境开关。服务端沿用 `createServerTiming`。

| 文件（packages/neuro-book 下） | 名字 | 所有者边界 |
|---|---|---|
| server/api/projects/open.post.ts | files.project.ref / files.project.open | 请求解析；Project Session/required modules minimum-ready，不含后台完整树 warm-up |
| server/api/workspace-files/tree.get.ts | files.tree.resolve / files.tree.index / files.tree.scan | 目标解析、Project snapshot 或 plain Workspace 扫描；原 workspace.resolve/workspace.index/workspace.tree 改名 |
| server/api/workspace-files/stat.get.ts | files.stat.resolve / files.stat.read | 目标解析、文件 stat DTO |
| server/api/workspace-files/read.get.ts | files.read.resolve / files.read.read | 目标解析、正文与文件状态读取 |
| app/stores/novel-ide.ts | files.tree.client | tree 请求至 JSON 返回，不含状态提交 |
| app/stores/novel-ide.ts | files.activation / files.activation.stat / files.activation.read | 激活整体；stat fallback 请求；read 请求本身，read 不含 buffer/session 提交 |
| app/stores/novel-ide.ts | editor.session.publish | openTabInGroup 与 session outcome |
| app/components/novel-ide/workspace/workspace-file-tree.ts | files.tree.project / files.tree.build | 模式投影、建树与排序 |
| app/components/editor-workbench/EditorViewHost.vue | editor.view.publish | 原顺序 releaseActive→lastUsed→handle/actions 发布→trimClean |
| app/components/markdown-studio/TipTapMarkdownEditor.vue | editor.tiptap.create / editor.tiptap.initialize | useEditor 配置至 onCreate；onBeforeCreate 至 onCreate，解析/模型/控件联合 |
| app/components/markdown-studio/load-monaco-editor.ts | editor.monaco.load | 首次共享模块/worker 加载与环境建立 |
| app/components/editor-workbench/MonacoCodeEditor.vue | editor.monaco.model / editor.monaco.create / editor.monaco.mount | 模型创建、控件创建、挂载至 nextTick/layout/ready 前 |

## 4. 改动的文件列表

- `packages/neuro-book/scripts/perf/` 八个新文件：files-baseline.ts、files-baseline-browser.ts、files-baseline-observations.ts、files-baseline-report.ts、files-baseline-resume.ts、files-sample-generator.ts、files-baseline-observations.test.ts、files-sample-generator.test.ts。
- `packages/neuro-book/package.json`：只新增 `perf:files-baseline`。
- 上表的四个 API、novel-ide store、五个组件/加载/树所有者；`open.post.test.ts`、`read.get.test.ts` 按本轮授权补齐 H3 假事件 context。
- `EditorViewHost.md`、`MonacoCodeEditor.md` 在允许组件目录同步观测说明；新增代码目录已被既有测试与脚本类型通配符覆盖，无需 Lab 登记或配置变更。
- 本 Task evidence 目录。Task/Work/研究 README、brief、锁文件和其它配置未修改。

## 5. 禁止清单逐条自查

1. 错误分支按状态码/错误码/类型；catch 重抛或记录诊断，ENOENT/ESRCH 仅处理明确生命周期状态，不按文案分支。创建项目 HTTP/JSON、镜像启动 metadata、CPU profile 和生产续跑输入均运行期校验。
2. 未跳过测试、放宽断言或把失败标为成功；三处产品 event.context 兜底已删除，只改授权假事件 context。输入/dirty/组数核验失败保留并退出非零。
3. 未替换任务之外代码、配置和注释；package.json 仅一条新脚本；不触碰研究 README 的已有修改。
4. 保留原语句顺序、finishGroupActivation、view 收口与错误上抛；自有服务/Chrome/finally 清理仍由脚本持有。
5. 跨包使用公开包入口，没有深导入其它包源码。
6. 使用已有 Product、Project、Files、Monaco 输入与浏览器链路，压缩名称未归类不伪报精确耗时。
7. 未用 rm -rf 清仓库；仅清理自己建立且确认无占用的系统临时数据；所有证据命令从 worktree 根执行。

未执行 commit/push/stash/切分支、Git 配置修改、真实模型调用、用户数据删除或 Electron 安装。

## 6. 测量局限与可疑数据

1. 桌面版未测；Linux headless 与 t16/t24 Windows Source Dev 条件不同，不能直接声称性能回归。
2. 服务冷开不清 OS 页缓存，reopen 仍经历 Project modules 与 watcher 生命周期。
3. CPU 分类为采样时间戳区间，服务含 1618.906/462.936 ms 稀疏间隔，不能当精确 CPU 活跃时间或异步 I/O wall-clock。TipTap 初始化与 Monaco mount 含调度等待；压缩未归类部分保留，persist 因果尚未干预证明。
4. 常驻计时、页面 RAF 就绪检查与独立 profiling 有开销；常规不包含独立 profiling，系统负载自然记录，不控制其它用户进程。开发准备曾出现 401、504 Outdated Optimize Dep、titleInputRef.value?.focus is not a function；历史 SPA 试跑还见 403 STORAGE_CONTEXT_INVALID/Storage 释放异常，均保留日志，不扩大任务修复。
5. B 含既有动画，仅证明子行渲染，不证明持续滚动流畅；C 两帧终点与窗口外输入验证分开，Long Task/LAF 仅保留基本 timing，未记录完整 script attribution；无长任务不表示无短阻塞。

反思回写建议仅交主 Agent 汇总，未修改规范：

| 编号 | 类别 | 依据 | 建议修改 | 目标位置 |
|---|---|---|---|---|
| 1 | 用户纠正 | 固定 User Timing 名字、删除无消费者 mark、read 仅包请求后，await 仍比 Resource Timing 长数百 ms；既有规范未说明这类证据边界 | 新增：“性能观测使用固定阶段名和局部起止值，不生成无消费者 mark。报告区分接口/await wall-clock、互斥关键路径与采样构成，嵌套阶段不相加；压缩函数归类需同时匹配真实脚本与函数范围。” | docs/testing/README.md 的验收脚本小节 |
| 2 | 踩坑 | 在 H3 假事件缺 context 时曾给产品加兜底；审查要求移除，补齐测试事件后原断言通过 | 新增：“测试替身缺少真实宿主必备上下文时修替身，不为让测试通过在产品边界补隐式兜底；产品容错必须有独立合同。” | docs/testing/README.md 的测试文件组织小节 |
