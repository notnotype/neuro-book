# Project Status

## Summary

llmlint 的核心资产是一个**中文正文规则库**，有两个消费时机：**写作期** `guide` 把规则投影成动笔前的写作约束（markdown，可注入系统提示词或存成文风预设，不需要输入文件）；**审查期** `check` 用 regex/density/handler 静态定位候选，`rules --detector semantic` 交出静态查不到的语义规则，`detect` 另走外部检测服务，Agent Skill 读上下文判断并在用户审批后改写。当前版本 **3.0.0**（真相源 = `skill/package.json.version`），已从 neuro-book 内嵌 skill 拆分为独立开发仓（真相源 = 本仓，`github.com/notnotype/llmlint`）。

**写作期证据状态（2026-07-31，guide-arm 三模型面板 + delivery-arm 有效性更正）**：**收益必须逐模型实测，推不出来——同一份约束在不同模型上是完全不同的画像。**

- **deepseek-v4-flash 上有效**（`guide-arm`，26 对）：主指标 docPAi 0.896 → 0.776、留出规则命中同步下降，均 20/26、p = 0.009；注入规则命中不显著这一点排除了「表层规避」；篇幅无代价。唯一同时满足判读口径两条的模型。
- **gemini-3.1-pro 上零收益 + 实打实的代价**（`guide-arm`，26 对）：质量三层全不显著（docPAi 0.977 → 0.972），可见字数中位 −757 字（**−26%**、23/26、p < 0.001）。约束没让它少 AI 味，只让它少写。**不建议默认注入。**
- **mimo-v2.5-pro 上证据不足**（`guide-arm`，26 对）：规则侧同向（留出 −1.74/千字、p = 0.076；docScore p = 0.009）说明它照约束改了写法，但主指标不动（14/26、p = 0.845）；篇幅 −8%（p = 0.076）。26 对判不了。
- **Opus 5 与投递位置仍未定**：旧 `delivery-arm` 的 toolresult 命令漏传 profile，两个处理臂实际使用 71/66 条不同 guide，唯一变量不成立。五组旧 meta 已标 `invalid`，其数表只能作为历史输出描述，不能支持 Opus 5 收益、模型强度或 system prompt/tool result 优劣结论；修复版 `delivery-arm-v2` 尚未调用模型重跑。
- **「基线高 ⇒ 收益可期」已被实测推翻**：gemini 基线 0.969 全面板最高，实测收益为零。基线（gemini 0.969 / deepseek 0.945 / gpt-5.5 0.941 / mimo 0.923，claude-opus-4-8 **0.130** / claude-fable-5 **0.071**，人类 **0.285**）只决定主指标**可不可测**——claude 系贴地板必须换裁判；基线高的模型有没有收益仍要逐个实测。
- **两个维度排序不一致**：claude 系在 docPAi 上低于人类，但规则侧 docScore 仍有 6.4–7.25（人类 2.47）。「躲过神经检测器」与「不写套路」是两件事，`guide` / `check` 分别对着它们。
- **合并面板数字会撒谎**：78 对合并跑五行里四行显著，掩盖「质量信号全来自 deepseek、字数信号主要来自 gemini」。跨模型结论必须先 `guide-compare --model` 分层看。

所以写作期是「deepseek 有证据、gemini 不建议、mimo 与 claude 系未定、整体未验收」。**D5 第二条件的缺口现在是硬阻塞**——gemini 的有效实验已经出现篇幅显著缩短，人评 `wantReadOn` 拿不到就无法判断「写短了」是否同时「变差了」；它也是 claude 系唯一现成的独立裁判（规则侧是循环指标）。产品上不要无条件推荐注入，也不要当成已确认有效的功能对外表述。

**体系定位（2026-07-02）**：中心资产是**大规则库**（超集，规则只有"对某任务好不好"）。四环 = ① 规则选择（evals → task profile）→ ② 评价获取（web：llmlint + 外部 AIGC 检测器双路首检 + 人类盲评）→ ③ 规则整理（NL 标注 → 规则增补入库）→ ④ 应用验收（改文后检测概率降**且**人评不降，D5）。外部检测器是地基不是对手。详见 [CONTEXT.md](CONTEXT.md) §1/§3。

## 2026-08-15 作者与评委生态研究

- Task 133 已归档，参与者版报告、ZIP 和复跑正文等临时产物已清理；最终文风默认切换由 NeuroBook 侧完成。
- 下一阶段正式提案见 `docs/proposed/author-reviewer-ecosystem.md`，前置分析草案保留在 `docs/drafts/author-reviewer-ecosystem-research.md`：作者候选 = `writer + critic + style + guide`，评委候选独立建模，`DocJudgment` 保持人类真值，AI 评委只写独立预测。
- 现有 `/contribute`、`Revision`、盲评双轴和统一数据模型可以作为基础；`/style-review` 当前仍是私有固定题库，不等于公开竞技场。
- 推荐先做 10 brief × 3 作者候选 × 3 次生成的离线小实验，再用 pair/brief 切分校准 reviewer；未通过冻结 holdout 前，不让 AI 评委替代人类，也不自动淘汰作者。

## 2026-08-16 架构规范首轮拍板

- `docs/specs/` 首轮目标合同已全部标为 `Accepted`；`current-state/web-workbench.md` 继续保持 `Snapshot`，用于迁移盘点。
- 14 项架构决策全部接受推荐选项：路由拆分、四 tab、评判工作区命名、线性 revision、风险参考分、显式 skip、ReviewerPrediction、窄共享层、单 detector 热力图、Playwright E2E、per-user Arena exposure、D5 primary、GeneratedCorpus owner/撤回治理。
- 关键合同已补齐 canonical Workspace API、D5 transport、Operation timeline、Engine/Detector 算法身份、Revision provenance v2、Arena exposure 和 skip DTO；代码仍待按 Accepted spec 迁移。

## 2026-08-16 前端旅程第二轮对齐

- 每个 revision 固定经历 `blind-review → inspect-edit`：首次阅读正文居中、只读、可选区评价；提交 blind judgment 或显式 skip 后才 reveal，候选 revision 同样执行。
- reveal 后正文移到左侧，右侧首轮只显示 Overview、Rules 和 Agent；历史 revision 浏览、Revisions 面板和跨版本比较延后，未来比较使用正文内联 diff。
- Accepted `DocumentEditorSurface` 统一 immutable revision 和 DraftSession working body；服务器 DraftSession 是 authoritative generation，客户端串行保存并保留失败队列。commit 后新 revision 回到 blind-review。
- D5 升为 `d5-owner-v2`，baseline 与 candidate judgment 都要求 blind；多 detector 逐项展示，正文一次只显示明确选择的一个 run。
- owner 与未来 study assignment 只复用正文和评分 intent；独立 assignment 授权/API 合同 Accepted 前不实现 participant 路由。uploaded 评价可进入获许可的 reviewer/规则研究制品，但不能冒充 D1 ground truth。

## 核心规范（权威文档）

> eval 是本项目最核心的部分；方法论与术语是一等规范，代码按它实现。

- [CONTEXT.md](CONTEXT.md)：领域语言（术语）+ 硬不变量 I1–I28。
- [evals/METHODOLOGY.md](evals/METHODOLOGY.md)：评测方法论 / 流程规范（代码遵守它，冲突以它为准）。

## Architecture

- 仓库根是开发工作区（name=`llmlint-dev`），承载 `skill/`、`evals/`、`tests/` 和开发脚本。
- `skill/` 是可安装、可发布的 runtime 包（name=`llmlint`）：`bin/llmlint.ts` + `src/`（config / rules / scanner / reporter / guide / round / contribute / markdown-mask / cli）+ `rulesets/builtin/default/` + `references/` + `SKILL.md`。CLI 命令面 = `guide`（写作期）+ `check` / `fix` / `detect` / `rules`（审查期）+ `round` / `contribute`（本地轮次与学习出口）+ `status` / `config`。
- 判据类别（`RuleDetectorKind`）是 `regex` 词法 / `density` 统计 / `handler` 算法 / `semantic` 语义。命名的是判据性质不是执行者；语义类曾叫 `llm`，那个名字与 `review:"agent"` 撞语义、也和「写作期全部规则都由模型消费」冲突，已硬切。handler 规则无 `detector` 字段，判据类别统一走 `ruleDetectorKind(rule)`。
- `evals/` 是判别力评测 harness（consumer + generator + acquire），进 git 但不进 `skill/`；语料合规边界见 `.agents/tasks/03-llmlint-eval-harness/data-acquisition.md`。
- `web/` 是单 Node Nuxt 采集站（`ssr:false` 保留）：构建期把完整规则 catalog + 默认 active registry 预烘成 `registry.json`，浏览器按本地设置覆盖调用纯函数 `materializeRules`，再用 `scanText`/`computeMaskedRanges` 做 regex+handler 的 span 扫描；Nitro MachineScan 采用同一 span-only 边界。density 仍会在规则目录展示，但 Web 当前不执行、不写入 `hitsJson`/`docScore`；完整 regex+density+handler 静态检查由 CLI 与 Agent `lint_check` 提供。Nitro server 另提供鉴权、Prisma 7 + libSQL 持久化、盲评采集、span 标注和管理员导出。
- web 的 LLM 分析/改写只依赖深 Module `AgentHarnessPort`，唯一实现为公开包 `@notnotype/neuro-agent-harness@0.1.0`。llmlint Adapter 提供 Prisma SessionStore、Pi ModelRuntime、analysis/optimize Profile、MachineLlmReviewProjector、权限和 SSE DTO；Core 直接提供 cursor/replay，不再经过第二层 EventBus。Store 使用进程级 per-session queue并明确只支持单 Node + SQLite；libSQL 连接容忍有限外部 busy lock，projector 只补缺失 review，startup reconcile 顺序且防重入。SSE route 由请求级生命周期统一关闭 heartbeat、Core subscription、forward task 与 H3 writer。历史 Session 由 `bun run agent:migrate-neuro` 显式备份、按 ledger 重建、重跑 analysis 后 hard cut。
- `/contribute` Agent tab 展示完整可观察 transcript：System Prompt 使用折叠节点，Profile 内部首条 user-role 消息标记为“模型输入”，只有 `llmlint.request` 标记为“你”；Assistant、工具、edit/report 与 Invocation 状态正常展示。Composer 统一承载选区、输入、外部 LLM、retry、发送/停止与连接状态。Cancel 绑定 active invocation ID 并等待 SSE terminal；durable workspace 经 SSE 实时写入只读中的正式修复稿，断线可由 snapshot 恢复。Assistant 内容使用 `marked + DOMPurify` 安全 Markdown。
- `/contribute` 报告为三维“AI 痕迹风险”：规则引擎、外部检测、LLM Agent 并列，越高越可疑、绿→黄→红；综合风险仅作次级参考（30%/45%/25%，缺失通道重新归一）。一条线性 Revision lineage 复用同一 Agent Session，Session revisionId 是当前指针，Invocation revisionId 是运行归属真相。`RevisionTextWorkspace` 暴露 `read/edit/lint_check/lint_fix/get_revision_detections`；历史 Revision 只读，current 工作副本结果统一进入 diff 审阅。
- LLM 评审使用 `llm-rules-agent-v6`，Optimize 使用 `repair-agent-v5`。一键修到底先由宿主应用 `fixability:auto` 静态修复，再以更新后的草稿声明 `objective=polish_ai_risk`；该 Invocation 不暴露 `lint_fix`，避免模型未读正文先改工作副本。强判别与当前启用的 `vocabulary.*` AI 敏感词是必修，weak/LLM Review 结合语境处理；eval report 缺失时安全降级为 contextual。Agent 可对高风险句段做小范围整体润色，并在内部多候选中选择最不像模型惯用表达的方案。历史恢复不会启动工作，跨篇状态清场后已有 active Invocation 会按 ID abort，未揭示 head 等待用户显式“继续检测”。正文只经 `read` 进入模型上下文；单轮输出预算按模型上限计算并封顶 65,536。
- 运行时：**Bun 原生** 或 **Node + tsx**；裸 `node` 因无扩展名 TS 相对导入不可直接运行。依赖装在 `skill/` 内自包含（commander / node-fetch-native / picocolors / tinyglobby）。

## Rules / CLI Facts

- 默认无 config 时加载单一内置 ruleset `builtin/default`：约 **360 rules / 266 active**，跨 50+ namespaces，由人工基础规则、中文策展规则（shuorenhua / avoid-ai-writing / humanizer）与 story-deslop 校准检测器合并生成。
- 三个正交维度：`level`（high/medium/low，严重度+退出码）、`review`（agent/human/none，审查受众，`check` 默认 `--review agent`）、`fixability`（auto/candidate/manual，机械修复能力）。默认 review 桶为 agent=54 / human=210 / none=2；默认 regex 规则为 auto=2、candidate=0、manual=243；`action.replace` 只是替换模板，不授予应用权限。
- 配置三层覆盖：rule id > namespace > ruleset > rule 默认；字符串是对象覆盖的语法糖，config 一处去糖、消费端无分支 patch。
- 规则模型 v3.0 已落地：`scope.layer` 硬切为 narrative/quoted/all，磁盘省略归一为 all，Active 规则与公开输出必带 resolved scope，项目配置不能覆盖。quoted 只配对同一行内 `「」`/`『』`/`“”`/`‘’`/`【】`，不支持 ASCII 直引号、未闭合或跨行配对。regex/density/handler 共用等长 view、position window 和 offset 合同，完整 layer 区间由执行器二次过滤；位置窗口按当前 layer 的 Unicode 码点计数，并跳过 Markdown 遮罩、frontmatter、标题和结构行。当前 active 分布 `all=240 / narrative=24 / quoted=2`。
- **density 与 handler 的分工边界**：density 表达分布指纹（「套词 12 处/千字」），它的 `hits`/`perKilo`/`samples` 只有在 pattern 是具体词组时才有意义。段落长度这类统计量属于 handler——`story-deslop.long-paragraph` 曾用 `[\p{L}\p{N}]` 逐字计数塞进 density，结果 `perKilo` 恒为 1000、`samples` 退化成段落头几个单字，2026-07-26 已迁为 `long-paragraph` handler，字数走 `Issue.detail`。当前 7 条 density / 6 条 handler。
- **规则 `title` 是紧凑 JSON 里唯一的人类可读标签**（`CompactRuleEntry` 不带 `detector.targets` 和 `examples`），所以必须逐条唯一。`tests/rule-titles.test.ts` 用三条硬不变量守住：全局唯一、不含正则作者术语、≤20 码点。2026-07-26 重写了 143 条共用标题（曾有 19 条都叫「R18词汇」、6 条把「必带"的/地"防误伤」这种正则笔记当标题）。规则 id 是标识符不参与该约束，允许与 title 口径不同（如 `stacked-degree-adverbs` 实际匹配单个程度副词）。
- `check` 支持多文件/glob/目录、Markdown 遮罩（代码块/frontmatter/链接不误杀）、regex+density+handler 静态扫描、`--min-level` / `--review` 过滤、stylish（TTY 上色）与 `--format json`。
- **修复有篇幅护栏**：`check` 报告的 `summary.visibleChars` 给出正文可见字数，与 density 的「/千字」同分母（只数 CJK/字母/数字，跳过结构行与遮罩区）。复测判据是三条同时成立——静态命中减少、无新命中、**篇幅在原文 ±20% 内**；第三条防的是「靠删够多来清零命中」。段级上限（一段删超三分之一要停）挡不住「每段各删一点、全篇掉三分之一」，实测出现过 4663→3003 字（−35.6%）而命中 55→2、docPAi 0.947→0.597，两个指标都在变好、没有任何信号提示删多了。±20% 沿用 repair prompt 既有口径，不引入新魔数。
- `check --format json` 默认输出**紧凑形态**：规则元数据（含 resolved scope）按 id 去重到顶层 `rules`、命中只带 `ruleId`、`context` 各裁 24 码点、`registry` 去掉逐 namespace 明细、不缩进。投影在 `skill/src/check-report.ts`（纯函数、无 picocolors，CLI 与 web「复制 JSON」共用）。`--rule-detail` 恢复完整内联形态供写规则/排查 overlap 用。实测同一样本 `--review all` 从 84936 降到 19720 字节（−77%；随后规则 `note` 变长使绝对值上移到 20856 / detail 88802，压缩比不变）。
- `fix` 只做 `fixability:auto` 机械修复（零宽字符 + 省略号/破折号尾部清理），默认 dry-run（有待修退出 1，可做 CI 门禁）、`--write` 落盘；重复感叹号/问号不再自动压缩，语义修复仍由 Agent 读上下文、经用户审批执行。
- `status` / `config` 提供用户级 `~/.llmlint/settings.json` 初始化门。数据链路明确分开：`contribute` 只写本机 outbox，当前无发送通道；fragments/full 只带轮目录安全快照名，stats 不含文件名或自由文本。`detect` 会把缓存未命中的正文块 POST 到配置服务（默认 HF Space），请求不含文件名或项目路径，`sharing.off` 不关闭它，远端日志/保留不受 llmlint 控制。检测结论分整篇绝对阈值与文内相对排序两层。
- Agent Skill 使用“首次 install 依赖门 + 五步闭环”：当前安装首次启用，或依赖字段/`bun.lock` 变化导致依赖合同失效、`node_modules` 缺失时，先在 skill 根执行 `bun install --frozen-lockfile`，成功后才进入 `status`。单纯版本、提示词、规则或源码更新必须保留现有 `node_modules`。修复提示词把静态命中与文内位次视为候选证据，先按修/留/问分流，再按删/压/换做最小改动；创作类正文默认 `--review all`，检测分数只作参考。
- 测试脚本 `bun run test` 先跑 `registry:build` 再跑 vitest / bun test。`web/app/data/registry.json` 是 gitignore 的构建产物，过期时会让规则漂移的用例假通过——这条链已在 2026-07-26 咬过一次。
- Web 同样严格区分修复权限：一键机械修复只吃 auto；默认 semantic replace 全部 manual，candidate 只保留给用户配置的显式白名单。构建期 `creative-writing@1` profile 直接消费 holdout report，排除 noise/anti 与稳定重复家族；Web/MachineScan 只扫描 active 规则里的 regex+handler span 子集，`engineVersion` 也只哈希这两类实际执行规则。原始 eval 与 CLI/Agent 才执行含 density 的完整静态超集；density 将来进入 Web 时必须使用独立结果合同与指纹决策。

## Recent Tasks

2026-08-14 t133 更新：Web 采集站已从历史本地密码/注册入口切换为独立 Node/Nitro 服务 + NeuroBook 官方 OAuth Authorization Code + S256 PKCE。llmlint 只建立 host-only `llmlint-session` sealed session；官方用户 ID 写入 `User.neuroBookUserId`，本地 `User.id` 及评分/文本外键不变；生产 fail-closed 禁止旧 `NUXT_ADMIN_*`。工作树内完成 provider/llmlint typecheck、聚焦 OAuth 验证、Node `node-server` build，以及隔离 SQLite + 真实 `.output/server/index.mjs` smoke（health 200、SSO disabled 503、未认证 style-review 401）；Node 运行前另修复 Windows Nitro/Prisma 虚拟 `file:///_entry.js` 启动崩溃。正式公网尚未开放。
生产服务器部署前置：已确认 Ubuntu 24.04.3、Node / Bun 版本、目标回环端口空闲、磁盘可用；已创建 `/srv/llmlint`、`llmlint` system user、systemd/Nginx/ACME/发布脚本模板，并留存入口配置 hash 备份。Linux frozen build 首次因宿主内存不足 OOM（kernel 记录 `Out of memory: Killed process ... (node)`）失败；未停止既有服务。随后临时启用 swap、将 Nitro 的模型运行时依赖外部化并把构建堆默认限制为 1536 MiB，生产服务器 Linux build 已成功完成，Node artifact 隔离 smoke 已通过 health 200、`auth/me` 为 `authEnabled=true,ssoEnabled=false,user=null`，并确认 `@libsql/isomorphic-ws`、`@earendil-works/pi-ai`、`@google/genai`、`@anthropic-ai/sdk`、`@mistralai/mistralai`、`openai` 均可由 Node 解析。DNS `llmlint.notnotype.com` 当前解析为 `<公网 IP>`，但 llmlint unit 仍 inactive、`/srv/llmlint/current` 缺失；未安装正式 TLS vhost、未启用 443 stream。原测试服务已停止，生产库仍保留，尚未切换。
本轮代码门禁：本地 `cd web && bun run typecheck:server && bun run typecheck && bun run build` 通过；生产服务器 Ubuntu frozen build 通过；生产服务器 Node artifact `/srv/llmlint/releases/t133-style-eval/web/.output/server/index.mjs` 的独立临时 SQLite smoke 通过 health 200、`auth/me` 为 `authEnabled=true,ssoEnabled=false,user=null`。PR #3 的 GitHub Actions build 经过三次 fresh-checkout 门禁修复后于 Run `31815121110` 通过：workflow 现在先生成 registry 与 Nuxt 类型，再上传包含隐藏 `.output` 内容的 artifact。build 仍报告缺少 `evals/report/report.json` 的降级提示和既有 Vue 插件 warning `[Vue] Load plugin failed: vue-router/volar/sfc-route-blocks`，均未导致退出失败。真实 Node smoke 使用 `node` 执行，不使用 Bun 直接加载 Nitro 产物（Bun 在产物外部化 `@libsql/isomorphic-ws` 解析上存在差异）。

| Task | Status | Notes |
| --- | --- | --- |
| [24 多轮修订谱系与数据收集通道](.agents/tasks/24-revision-rounds-and-contribute/README.md) | Local loop implemented / service pending | `round begin`、台账 v3、`contribute` 四档裁剪、`--auto`、`--list` 与本地 outbox 已实现。v3.0.0 读取端逐层拒绝未知键和非法值，导出端再次逐字段重建；source 快照必须精确完整，output 不完整时不哈希、不进 full，并写 `degradedReason:"output-snapshots-incomplete"`。决策路径无法映射到 sourceFiles 时整轮跳过，fragments/full 只保留安全快照名；stats 保持零文件名/零自由文本。当前没有上传通道。 |
| [23 Skill 闭环与服务接入](.agents/tasks/23-skill-loop-and-service/README.md) | 分片 1 A/B Done / 规则整理进行中 | 本地闭环、story-deslop 校准规则、规则模型 v3 与“首次 install 依赖门 + 五步修复流程”已落地。提示词先按修/留/问判定候选，再按删/压/换做最小修复，保护剧情、人设、时间线、角色声音和载体功能，不为检测分数制造新文本。规则整理按“默认 Agent 低误杀、human 保留高召回但不保留已证实噪声、canonical 消重”持续收敛。当前 360 total / 266 active，review = agent 54 / human 210 / none 2；active 同 span 只剩 1 处 human 宏观节奏规则共振。待决策略集中在 `rule-curation-open-questions.md`；分片 2 contributions 与分片 3 登录仍未做。2026-07-26 完成分片 1 端到端验收（真实 deepseek 样本走完五步）并**修完全部 7 项发现**：① `check --format json` 紧凑化（`--review all` 84936 → 19720 字节，−77%；`--rule-detail` 逃生舱逐字节回归）；② `--review all` 提为创作类主路径；③ 一轮修复后 docPAi 反升（0.8757→0.8844，改动最密 chunk +6.1pp）确认为方法论结论并写进提示词，不是缺陷；④ 四象限改相对判据（`rank` / `relative` / `spread` 派生字段，`spread < 0.15` 守门）；⑤「热力绿 ⇒ 规则误报」改为「规则与检测器分歧」；⑥ 对白层调研给出反证，不新增规则；⑦ `sharing.tier` 口径统一。顺带堵掉一个假绿：`test` 现在先跑 `registry:build`，此前 gitignore 的 `web/app/data/registry.json` 过期会让规则漂移的测试假通过。详见任务 walkthrough 与 `dialogue-layer-research.md`。**2026-07-26 又做第二轮流程测试**（刻意换题材换模型：宫斗 + gemini-3.1-pro，7287 字），流程全通、复测判据满足，另修 4 项上一轮无法触发的问题：① `long-paragraph` 滥用 density detector（`perKilo` 恒 1000、`samples` 是单字）迁为 handler；② **规则标题体系性失效**——266 条 active 里 143 条共用 title，且这是上一轮紧凑化放大的（Agent 不再拿到 `detector.targets`），143 条全部重写并加 `tests/rule-titles.test.ts` 三条硬不变量守住；③ `spread` 边界带（本篇 0.167 距门槛仅 0.017）stylish 补弱证据提示；④ `.agent/` 台账改 `{version:2, rounds:[]}` 只追加不覆写，计划/输出显式为单槽过程产物。四象限首次给出可用信号（「规则静默 × 文内高位」正确指到并列回忆蒙太奇段）。规则缺口（蒙太奇、跨段自重复）只记录不新增规则。**2026-07-27 补上写作期入口**：规则库此前只有审查期消费面，`show-llm-rules` 只覆盖 8/266 条且措辞纯审查期，SKILL.md 的 `description` 是 `Use when reviewing…`——要动笔的 Agent 永远不会触发它；而消费端插槽早已存在（neuro-book writer profile 的 `writingStylePreset`，52 个**手写**预设 + 英文无度量的 `stop-slop`），与 266 条实测规则零交集。本轮：① 新增 `llmlint guide` 输出写作期约束（markdown 单一形态，四档 `core 13 / standard 71 / wide 100 / full 266` 严格嵌套，判别力走 `--profile` 外部传入，**不烧进规则记录**，新增 I24）；② `detector.type: "llm"` → `"semantic"` 硬切（判据类别命名判据性质而非执行者；旧名已迫使 `Review` 改叫 `agent` 来避让）；③ `show-llm-rules` → `llmlint rules` 覆盖全部 266 条，语义规则自动展开判定说明与示例；④ 提示词面五处措辞改为「两个消费时机」；⑤ 中途发现并修掉真 bug——`examples` 的 `good` 被同时当「改写版」和「保留」裁决词，16 个示例里 8 个对照例被 `guide` 标成「别写成」、被 web 画成红色删除线，schema 改 `{text, hit, fix?, reason?}` 并加 I25。新增 `tests/guide.test.ts` 8 条守卫（含对照例回归）。**2026-07-27 跑完写作期约束 eval 并做了第三轮用户实测**：新增 `evals/experiments/`（元评测，与常规判别力流水线分开）+ `render-v2`（只多一个约束槽位，空约束时与 v1 逐字节等价，5 条测试守着）。26 对配对 render 结果——主指标外部检测器 docPAi 0.896→0.776、主要佐证「留出规则命中」7.994→7.014，两者都是 20/26 更低、p = 0.009；**注入规则命中不显著（12/26，p=0.845）恰好排除了「表层规避」这个替代解释**（若模型只是躲开被告知的词，最该降的就是它）；篇幅未被压垮。按预注册判读口径**有证据支持注入写作约束**，但 **D5 只满足一半**（第 ② 层 critic 未建，人评 `wantReadOn` 拿不到），且证据仅来自 deepseek 单模型，结论暂定。同期把 skill 装进 `~/.claude/skills/llmlint/` 用 `claude -p` 跑四场景实测：五步闭环全通、台账落盘、`rules --detector semantic` 首次获得实测证据、`guide` 在两个写作场景被自发调用且产物与 CLI 直出逐字节一致。**但实测方向相反**——Opus 5 读了 guide 之后照样写出「不是A，是B」，而那条就在 guide 第 42 行；两个变量同时不同（eval 注入 system prompt + deepseek，实测是 tool result 上下文 + Opus 5），下一轮三臂最小实验拆开。另发现三个问题：`guide standard` 66 条里 18 条与虚构叙事无关（27% 噪声，选集按 `action.type` 而非写作期相关性）、58 条结构类规则无示例（只有 8 条语义规则带正反例）、写作场景被 `status` 初始化软门多拦一次。**随后跑 `delivery-arm` 拆开这两个变量**（固定 Opus 5，三臂 × 15 章 = 45 样本，只动约束进上下文的位置）：system prompt 确实比 tool result 更能让模型遵守约束（注入规则命中 1/15、p=0.001，校正后显著）、规则侧朝人类基线移动（docScore 5.349→3.462，p=0.035），但篇幅显著缩短 24%（p=0.007）。**主指标 docPAi 不显著不能读成无效**——Opus 5 基线 0.227 已低于人类 reference 0.285，指标没有下降空间。本轮有两处自我修正：中途只看规则侧曾误判「投递位置是主因」；补上检测器后初版结论又写成「对强模型净有害」，那是用失去分辨力的裁判下判决，措辞过头。最终口径是「claude 系待换指标重测」。按模型基线（`externalDetector.byModel`）：gemini 0.969 / deepseek 0.945 / gpt-5.5 0.941 / mimo 0.923 / claude-opus-4-8 0.130 / claude-fable-5 0.071，人类 0.285——主指标只在基线明显高于人类的模型上可用。顺带把 `guide-compare.ts` 从写死两臂泛化为 `--arms 基线,处理`（用原数据回归，26 对五项指标逐个一致），共用语料读写抽到 `arm-corpus.ts`。两个 headless 环境坑记入 TODO：claude CLI 的 OAuth 凭据是进程间共享单文件（并发刷新互相踢掉，首批 37/45 因此失败，已加认证重试）、宿主会掐掉长进程（已加 `--max-calls` 分批配额）。**2026-07-27 把 guide-arm 扩成三模型面板**（gemini / mimo 各补 26 对，`guide-compare.ts` 加 `--model` 分层比较）：deepseek 有效（此前已知）、**gemini 零收益且篇幅 −26%**（23/26、p<0.001，不建议默认注入）、mimo 规则侧同向但主指标不动（14/26、p=0.845，26 对判不了）。合并 78 对跑出四行显著是假象——质量信号全来自 deepseek、字数信号主要来自 gemini，跨模型结论必须分层看。「基线高 ⇒ 收益可期」被 gemini（基线 0.969 面板最高）实测推翻：基线只决定主指标可不可测，收益要逐模型实测。 |
| [22 Agent Chat 界面适配](.agents/tasks/22-agent-chat-ui/README.md) | Implemented / Browser Pending | Flow 展示可区分来源的完整运行上下文；同 Session 跨 Revision 保留 transcript/cursor；历史 Analysis 重试与取消由 `useAgentChat` 按 Invocation revision 收口；一键入口先应用 auto 静态修复，再把更新后的草稿交给不含 `lint_fix` 的风险润色 Agent。最终全量 34 files / 290 tests、双 typecheck、Nuxt production build 通过；浏览器验收待用户授权。 |
| [20 AGPL-3.0-only 许可证迁移](.agents/tasks/20-agpl-license-migration/README.md) | Implemented | 根开发仓和可安装 `skill/` package 已迁移到 AGPL-3.0-only；NeuroBook monorepo 在 system assets projection 时从该 package 生成运行时资产。 |
| [21 NeuroAgentHarness llmlint Adapter](.agents/tasks/21-neuro-agent-harness-llmlint/README.md) | Complete / Runtime Hardened | 公开 Harness hard cut 保持；同一线性 Revision lineage 复用 Session，Invocation revisionId 作为归属真相；`RevisionTextWorkspace` 统一 read/edit、CLI 同源 check/auto fix、历史只读 Revision 与三路持久检测。幂等 advance、精确读取覆盖和规则结果清零均已回归；业务能力仍留在 llmlint Adapter/Profile，不进入 Core。 |
| [01 anti-ai-slop / llmlint skill](.agents/tasks/01-anti-ai-slop-skill/README.md) | 历史 | llmlint 源头（原名 anti-ai-slop）：TypeScript+正则、static/llm 分层、6 步润色流程、CLI 与参考文档、2026-06-28 硬切重命名。 |
| [02 llmlint Rule Registry](.agents/tasks/02-llmlint-rule-registry/README.md) | Implemented | flat Rule Registry（id/namespace/ruleset）、三层覆盖、review/fixability 维度、rules 目录递归加载、CLI `fix`+多文件+Markdown 遮罩；Task 23 规则整理后默认 auto=2/candidate=0，并以版本化 creative profile 收敛 8 条稳定重复规则，不删除全局规则资产。 |
| [05 Web Frontend](.agents/tasks/05-web-frontend/README.md) | Implemented | 纯客户端检测网页（Nuxt 4 SPA）：本地 `scanText` 检测、分组/过滤/规则详情/Markdown 遮罩、**首页双状态输入→分屏动画**、**行内高亮**、**列表↔正文双向点击定位**、**一键机械修复(auto 桶,含撤销)** + **复制 JSON**、**首屏 About 说明** + **评测报告查看器(内置示例报告预烘)** + **CI-only Node/Nitro artifact workflow** + **轻量主题/i18n/设置弹窗/规则覆盖配置**。机械修复逻辑抽到共用 `skill/src/fix.ts`，规则 materialize 抽到 `skill/src/rule-registry.ts` 供 CLI/Web 共用；frontend/server typecheck 及 production build 已通过。
| [06 Web Data Collection](.agents/tasks/06-web-data-collection/README.md) | SSO cutover implemented / Task 133 archived | 检测数据 web 采集已切换为 NeuroBook 官方 SSO-only：删除本地密码 login/register/admin seed；`User.neuroBookUserId` 只做官方 ID 映射，历史本地外键保持；机器首检仍先算后藏。Task 133 已完成 20 份 owner 双轴盲评、5 组 pair、26 篇跨题材蒸馏、5×3 最终预设复跑与参与者版报告；最终默认文风已由 NeuroBook 侧切换。正式生产服务器 DNS/证书/Node 服务尚未开放。
| [07 Web Review Editor](.agents/tasks/07-web-review-editor/README.md) | V1 Implemented | 规则审查编辑器第一版：新增专用 `ReviewEditor`，保持单一 Markdown 文本真状态；source 模式继续使用精确 textarea/UTF-16 offset；preview 模式引入 TipTap 渲染 Markdown；批注以当前审查 session sidecar 保存，不污染原文；`fixability:auto` 的确定性正则替换可在正文预览并单条应用，preview 与 source 背板都会显示 replacement/delete 提示，单条替换会给出可恢复文本和批注快照的撤销通知，右侧报告列表也可对 auto 命中就地替换/删除并复用同一撤销链路，替换后会自动衔接到后续剩余命中。已补 TipTap 风格 inline selection menu（批注/复制/定位源码/单条替换），菜单在选区命中规则时会直接显示级别、规则标题与处理状态；source/preview click-outside 与 `Escape` 选区菜单收尾、全文上下文单条替换和批注范围变换；真实 NeuroBook manuscript 链路验证 scanner/web registry 正常，首页提交新文本或工作台内换新长文档时若旧过滤器会隐藏所有命中，会自动放宽到全部命中；汇总条和主列表会区分“过滤隐藏”和“本地规则覆盖关闭默认命中”，规则设置导致页面看似无命中时会提示并提供恢复默认规则入口；批注 rail 新增未处理/总数与完成/重开状态，source/preview 标记会弱化已完成批注，preview 正文 mark、so
| [13 Web 五步通路 UX+Schema](.agents/tasks/13-web-five-step-flow/README.md) | Spec + W1 Implemented | web 通路（采集线 B）权威规格 + W1 落地（2026-07-07）：五步流程 UX 状态机 + Task 12 目标 schema + API 面，四项拍板（`Revision.revealedAt` 揭示显式化、分类三值三源、机器信号一律服务器算、report verdict 烘进 registry 供强判别静态替换）。W1：schema 迁移（origin 三变体 / 拆 MachineScan+MachineDetect / DocJudgment 四维可选）、服务端扫描通道（engineVersion=`2.0.0+r{hash}` 单源、docScore 对齐 evals 口径）、reveal/machine 端点（未揭示 403 = D2 服务器强制）、blind 新规则、废除 `/api/scans`、export 适配；34/34 API 闭环断言 + 双 typecheck 绿。W2–W6 全部落地（2026-07-08）：W2 五步 UX 完形（自报三项/盲评可跳过/复评四维/多轮循环 head 追踪/verdict 烘焙 strong 过滤——**发现 strong∩auto 当前为空集**、7 条 strong 全 candidate，一键机械清理近不可见属预期/span 标注组件/中英 i18n 还清 Task 10 R2；35/35 断言）；W3 外部检测器服务端腿（HF 走代理 `node-fetch-native/proxy` dispatcher、异步 waitUntil 写 MachineDetect 含热力图 chunksJson、真跑 docPAi 0.9991、失败优雅缺省、D5 检测概率腿升级/降级双口径）；W4 `llm_fix`「AI 改写」任务式端点（mimo + 复用线 A repair-v1 链，真跑 57s 命中 84→48 / docScore 38.2→29.4）+ provenanceJson 逐规则 hunk；W5 lift 闸门谓词双侧代码化（report.json 逐字节零漂移）+ export `liftAdmissible` 标记 + corpus 导入脚本（curated 5/generated 30/repair 3 血缘幂等、visibility 强制 private 守 I11）；W6 上传后异步 LLM 分类补空（mimo 真跑、只补空防覆盖原子写实测、失败静默）。最终合并态 evals 42/42 测试 + 三重 typecheck 全绿；**浏览器手动验收清单 17 步在 walkthrough 执行记录，待用户一次性验收**。 |
| [14 线 A 修复一轮循环](.agents/tasks/14-line-a-repair-loop/README.md) | Implemented | llm render helper 通路（M4 repair 部分，2026-07-07）：`repair-v1` 版本化提示词 + `repair.ts` CLI（断点续跑/拒答守门/限流预算复用）+ meta 契约加 `repairOf` 血缘 + `report.repair` 配对统计（不触 lift/AUC 任何路径，零漂移验证）。5 对真实验证（修复者 deepseek）：docScore 中位 25.32→19.58（5/5 改善）而神经检测器 P(AI) 中位仅 −0.7pp——**表层规则一轮修复撼不动神经检测器**，D5 双条件反 Goodhart 的正向实证。39/39 测试绿。 |

Task 07 latest supplement（2026-07-03）：工作台左右面板支持拖拽调整宽度并持久化；最近历史改为精确正文恢复并过滤旧截断记录；静态单条替换、顶部一键机械清理、source/preview 选区剪贴板替换、source/preview 选区 Markdown 加粗/斜体/删除线/行内代码格式化（含 Ctrl/Cmd+B、Ctrl/Cmd+I、Ctrl/Cmd+Shift+X、Ctrl/Cmd+` 快捷键和专属格式化通知）、source/preview 选区块级 Markdown 引用/无序列表/有序列表/围栏代码块格式化（既能识别/解包 ```，也能识别/解包 ~~~，新增代码块规范输出为 ```；选区支持 Ctrl/Cmd+Alt+0/1/2/3 切段落/标题，Ctrl/Cmd+Shift+7/8 切有序/无序列表）、source/preview 文本块样式面板（段落、标题 1/2/3、无序列表、有序列表、引用、代码块；标题/列表/引用之间互斥转换，不会叠出 `- ## 标题` 或 `### > 引用`；列表项可用 inline 菜单或 source 模式 `Tab` / `Shift+Tab` 增加/减少缩进来调整嵌套层级，非列表段落不会被 Tab 误改；段落会移除标题/列表/引用/围栏代码块等块结构但保留 inline Markdown；当前区块图标会随选区状态更新，选中围栏代码块内部也能识别为代码块；preview 写回 source）、source/preview 选区 Markdown 链接格式化（内联 URL 表单，可用 Ctrl/Cmd+K 打开；已有链接会预填当前 href，支持 `<...>` angle destination 中的空格/括号 URL和普通 destination 中的平衡括号 URL，更新已有链接会替换整个 link wrapper 而不嵌套，可直接移除链接并保留 label，也可只更新 destination；preview 只读链接选区会同步 DOM selection 到 ProseMirror selection）、source/preview 选区批注表单可用 Ctrl/Cmd+Alt+M 打开并保存到同一批注 rail，批注 rail 可用 Ctrl/Cmd+Alt+J/K 在未处理优先队列中前后巡检，并用 Ctrl/Cmd+Alt+D 完成/重开当前批注、source/preview 选区清除 Markdown 格式（可用 Ctrl/Cmd+\；单行普通内联选区只清当前 wrapper，跨行或块结构选区才清标题、引用、列表、围栏、链接、行内代码、粗斜体、删除线等 Markdown 原生标记）、source/preview inline 菜单会基于同一个 Markdown source-range 状态点亮当前格式按钮（标题、粗斜体、链接、删除线、代码、引用、列表、围栏），外部 LLM 全文剪贴板替换都会生成 sidecar diff 标注，source/preview 都能显示删除线旧文本和新增标记，零宽字符删除会显示为可读标签，撤销会同步恢复正文、批注和 diff；preview 结构性格式化会先收起 BubbleMenu 再在下一 tick 替换 Markdown，避免菜单卸载与 ProseMirror 文档重写撞出 Vue DOM patch 错误；source/preview inline 菜单在移动端会按视口宽度收口并换行，不再因按钮增多越界。用户可以用 toolbar 的上一处/下一处修改逐条巡检 diff，也可以用 Ctrl/Cmd+Alt+N/P 巡检下一处/上一处修改、Ctrl/Cmd+Alt+Enter 清除当前修改标注，也可以直接点击 preview 正文里的删除线/新增 diff 标记来选中该修改，再在 source/preview 中单独清除当前激活的修改标注并撤销清除，清除标注不回滚正文。全文替换 diff 使用行级 LCS，并规范化 CRLF/LF，避免 Windows textarea 换行导致未改行被误标。未接入 LLM 前，除全文指令外，当前 active 命中可一键复制“命中 + 上下文 + 相关批注”的局部优化指令；source/preview inline 选区优化指令现在也会携带邻近上下文和相关用户批注，并明确要求外部 LLM 只返回选中片段；批注卡片可复制“原文片段 + 批注 + 状态”的上下文，方便交给外部 LLM 或人工 reviewer。编辑器、外部 LLM 菜单、最近历史、右侧报告列表、规则详情弹窗、设置弹窗、Header 登出通知、登录/注册页、汇总条、过滤条和 LLM 规则提示的界面 chrome 已补齐 zh-CN/en-US i18n，规则标题与正文仍按内容原样显示。分屏 diff 与真实 LLM 修改链路仍作为后续设计。

Task 07 latest supplement addendum（2026-07-03）：批注 rail 的键盘审稿流继续补齐，当前激活批注可用 Ctrl/Cmd+Alt+E 打开现有编辑表单并聚焦输入框；保存、取消仍复用原有 rail 编辑路径。

Task 07 latest supplement addendum（2026-07-03）：`Ctrl/Cmd+Alt+M` 的批注快捷键现在会优先批注当前 source/preview 选区；没有选区但存在 active issue 时，会打开当前命中的批注表单，避免用户从右侧报告定位命中后还要重新框选正文。

Task 07 latest supplement addendum（2026-07-03）：当前 active issue 的外部 LLM 局部优化指令可用 Ctrl/Cmd+Alt+L 直接复制，复用原 toolbar 按钮的 prompt 构造、相关批注上下文和剪贴板通知路径。

Task 07 latest supplement addendum（2026-07-03）：当前 active issue 若存在确定性静态替换/删除，可用 Ctrl/Cmd+Alt+R 直接应用；快捷键复用原 `acceptReplacement()` 路径，保留 diff 标注、批注范围变换和撤销通知。

Task 07 latest supplement addendum（2026-07-03）：命中巡检补齐键盘入口，TextPanel 现在支持 Ctrl/Cmd+Alt+ArrowDown/ArrowUp 在当前过滤后的可见命中中前后移动，复用原上一处/下一处命中按钮的 `navigate-issue` 路径。

Task 07 latest supplement addendum（2026-07-03）：外部 LLM 局部指令快捷键 Ctrl/Cmd+Alt+L 改为选区优先；当前 source/preview 有可映射选区时复制选区优化指令，否则回退到当前 active issue 的命中优化指令。

Task 07 latest supplement addendum（2026-07-03）：外部 LLM 片段回填链路补齐，当前 source/preview 有可映射选区时可用 Ctrl/Cmd+Alt+V 从剪贴板替换选区，复用原 inline 菜单剪贴板替换与 sidecar diff/撤销路径。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 支持 Ctrl/Cmd+Alt+T 在 source/preview 模式间切换，复用原 `updateMode()` 路径并在分段按钮 title 中暴露快捷键。

Task 07 latest supplement addendum（2026-07-03）：通用 `SegmentedControl` 会把 `option.title` 同步为按钮 `aria-label`（缺省回退 label），ReviewEditor 的 source/preview 模式按钮现在用可访问名称暴露 Ctrl/Cmd+Alt+T；浏览器 smoke 已覆盖按 accessible name 找到源码/预览按钮并用快捷键往返切换。

Task 07 latest supplement addendum（2026-07-03）：工作台左右分屏的拖拽 separator 补齐键盘调整能力，聚焦后可用 ArrowLeft/ArrowRight 微调、Shift 加速、Home/End 收放到最小/最大宽度；键盘路径复用同一持久化宽度与 clamp 规则。

Task 07 latest supplement addendum（2026-07-03）：source/preview inline 选区菜单把外部 LLM 选区优化指令提升为带文字的主入口（`复制指令` / `Copy prompt`），复用原 Ctrl/Cmd+Alt+L 与 prompt 构造路径，降低未接 LLM 阶段的关键工作流发现成本。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 批注 rail 在桌面端支持拖拽调整宽度，复用 `useResizablePanel()` 并持久化到 `reviewCommentPanelWidth`；移动端仍保持上下堆叠布局，批注数据与审稿队列不变。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 批注 rail 的 resize separator 补齐键盘调整能力，聚焦后可用 ArrowLeft/ArrowRight 微调、Shift 加速、Home/End 收放到最小/最大宽度；键盘路径复用同一持久化宽度与 clamp 规则。

Task 07 latest supplement addendum（2026-07-03）：批注审稿键盘流补齐 `Ctrl/Cmd+Alt+C`，可复制当前激活批注的原文片段、批注正文和处理状态，复用原卡片按钮的 `copyCommentContext()` 路径。

Task 07 latest supplement addendum（2026-07-03）：修改标注巡检流补齐当前 diff 上下文复制，工具条新增复制按钮，`Ctrl/Cmd+Alt+Shift+C` 可复制修改标题、来源、删除文本和插入文本，零宽字符会转成可读标签。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 工具条和批注 rail 的纯图标控件补齐显式 `aria-label`，覆盖 diff 巡检、复制修改上下文、批注栏开合、批注栏 resize、批注巡检和清空/收起入口。

Task 07 latest supplement addendum（2026-07-03）：source textarea selection menu 与 preview TipTap BubbleMenu 的纯图标控件补齐显式 `aria-label`，覆盖复制、剪贴板替换、块样式、inline Markdown 格式、链接、引用/列表/代码块、源码定位和清除格式入口。

Task 07 latest supplement addendum（2026-07-03）：source 模式下点击/移动光标到修改标注范围会激活对应 diff，已与 preview 点击 diff 的行为对齐；激活后现有复制当前修改上下文、清除当前修改标注和 diff 巡检入口可直接使用。

Task 07 latest supplement addendum（2026-07-03）：批注 rail 卡片操作补齐显式 `aria-label`/`title`，覆盖定位批注、复制批注上下文、完成/重开、编辑和删除批注；删除批注使用独立 `review.deleteCommentTitle` 文案，避免多条批注时出现泛化操作名。

Task 07 latest supplement addendum（2026-07-03）：批注 rail 卡片操作的可访问名称继续带上被批注原文片段，覆盖定位、复制上下文、完成/重开、编辑、删除，以及编辑表单保存/取消；普通空格保持自然显示，不可见字符会转成可读标签。浏览器 smoke 已覆盖 `其实` 当前命中批注保存后，rail 操作与编辑表单按钮均包含对应 quote 上下文。

Task 07 latest supplement addendum（2026-07-03）：批注编辑保存新增反馈与撤销：`TextPanel.updateComment()` 会记录旧正文，保存后显示“已更新批注”，撤销时若批注仍存在则恢复旧正文。`bun run typecheck`、`bun run build` 通过；浏览器 edit-undo smoke 已尝试但受 rail 编辑表单自动化时序影响，未声明通过，详见 Task 07 walkthrough。

Task 07 latest supplement addendum（2026-07-03）：右侧 IssueCard 的规则详情、定位命中和应用替换/删除按钮补齐带上下文的 `aria-label`/`title`，名称包含规则标题或命中文本，避免重复列表中只出现泛化的“详情/定位/替换”操作。

Task 07 latest supplement addendum（2026-07-03）：TextPanel 上一处/下一处命中、ReviewEditor 清除全部修改标注、当前命中批注和当前替换按钮补齐显式 `aria-label`，复用现有快捷键/上下文 title，导航命中到应用替换的工具条路径更稳定。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor inline Markdown 清除格式补齐双反引号 code span，`foo\`bar` 这类含反引号文本经过 inline code 格式化后可再用清除格式恢复，`code` 与 `clear formatting` 操作闭环。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor inline Markdown toggle 更贴近 TipTap：选中已格式化 span 的内部文本后再次点击同一格式按钮会取消外层格式，覆盖 bold / italic / strike / 单反引号 code / 双反引号 code，并避免把 `**...**` 或双反引号误判成单字符 wrapper。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 链接编辑补齐 label 反转义语义；更新已有链接 href 时不会双重转义 `[a\\]b]` 这类 label，移除链接时会还原为用户看到的 `a]b` 文本。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor inline 链接创建会根据选中文本预填 href；已有 Markdown 链接仍优先使用原 href，普通 `http(s)` / `mailto:` / `tel:` 选区直接带入，`www.` 选区补 `https://`，邮箱选区补 `mailto:`。source textarea menu 与 preview BubbleMenu 复用同一选择状态 helper，并补充纯函数回归测试，链接创建路径更接近 TipTap 编辑器体验。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 链接预填契约继续收紧；已有 Markdown 链接 destination 即使为空也会优先保留，不会因为 label 看起来像 URL 就重新推断 href。已补 full-link / label-only 空 destination 纯函数回归测试和 source 模式浏览器 smoke。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor inline 菜单的“移除链接”改为专用 `remove-link` 命令，不再复用广义 `clear-formatting`；在标题、列表、引用等块结构内 unlink 时只移除 Markdown link wrapper，保留外层块格式。source/preview 菜单共用该命令，source 模式浏览器 smoke 已覆盖 `# [标题](url)` -> `# 标题`。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor Markdown formatting command 类型收口到 `web/app/utils/markdown-format-command.ts`，source textarea menu、preview BubbleMenu 和 editor handler 不再各自维护命令 union；新增 preview BubbleMenu unlink smoke，覆盖 `# [标题](url)` 预览选区移除链接后回到源码仍为 `# 标题`。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 链接 href 预填会清理选中 URL/email/`www.` 文本尾部的句末标点与不匹配右括号，避免用户框选 `https://example.com/path。` 时把 `。` 写进 href；平衡括号 URL 仍保留。已补纯函数回归测试和 source 模式浏览器 smoke。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 新建 Markdown link 时复用同一 URL/email/`www.` 候选清理逻辑，URL-like 选区尾部句末标点会留在链接 label 外，例如 `https://example.com/path。` 会生成 `[https://example.com/path](https://example.com/path)。`；普通短语链接不受影响。source 模式应用链接 smoke 已覆盖。

Task 07 latest supplement addendum（2026-07-03）：修复模式第一层基础落地：工作台进入时保存原文基线，左侧正文作为修复稿继续编辑；TextPanel 顶部显示原文字数、修复稿净变化和回到原文入口，重置支持撤销。Web 单条静态替换可在用户确认下应用 `candidate` replace 规则，但共享 helper 默认仍只允许 auto，CLI `fix` 自动修复边界不变。source 模式会叠加“修复稿相对原文”的标注式 diff；删除候选和删除 diff 改为直接在正文基线画红色删除线，不再统一使用右上角标。已用 `测试！！！ / 测\u200b试 / 他说……...` 链路浏览器验证提交、机械修复、修订标注、回到原文与删除线视觉。

Task 07 latest supplement addendum（2026-07-03）：修复模式 source diff 叠加规则收紧：具体的静态/LLM sidecar diff 优先显示并保留在 diff 巡检队列，修复稿相对原文的 baseline diff 只补没有被具体 diff 覆盖的手动编辑区域，避免机械修复后同一处同时出现规则 diff 与 baseline diff 的重复删除标注；浏览器 smoke 已覆盖三处机械修复不重复标注、回到原文后手动追加文本仍显示 baseline 标注。

Task 07 latest supplement addendum（2026-07-03）：source 删除候选的草稿纸删除线语义改为结构化字段传递：`ReviewEditor` 给 replacement range 传 `isDelete`，`HighlightedTextarea` 不再通过比较本地化文案 `review.delete` 来判断删除样式，避免后续文案/i18n 调整破坏删除线显示；浏览器 smoke 已覆盖零宽删除候选直接显示删除线且不出现 `-> 删除` 角标。

Task 07 latest supplement addendum（2026-07-03）：preview 模式删除候选视觉与 source 对齐：TipTap preview decoration 为删除候选增加 `llmlint-issue-delete-replacement`，直接在正文上画红色删除线并取消 `-> 删除` 箭头；非删除替换仍保留 `-> replacement` 提示。浏览器 smoke 已覆盖 `测试！！！` 替换候选仍显示箭头、`测\u200b试` 删除候选在 source/preview 都显示删除线。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 工具条的静态修复统计从单一“可替换”总数拆成 `替换 N / 删除 M`，让修复模式更像草稿纸改文时的动作清单；浏览器 smoke 已覆盖一处连续标点替换 + 一处零宽删除时显示 `替换 1 / 删除 1`，且删除候选仍保持直接删除线。

Task 07 latest supplement addendum（2026-07-03）：右侧 IssueCard 的单条应用按钮区分 auto 与 candidate：自动修复仍显示绿色 `替换` / `删除`，候选修复显示 amber `候选替换` / `候选删除`，并同步到 aria-label/title；浏览器 smoke 已覆盖默认 Agent 视图下 `其实` 显示 `候选删除`、展开全部后连续标点 auto 仍显示普通 `替换`，点击候选删除可写入修复稿。

Task 07 latest supplement addendum（2026-07-03）：source textarea menu、preview BubbleMenu 和 active-hit toolbar 的候选静态修复入口也与右侧列表对齐，显示 amber `候选替换` / `候选删除`；应用删除后的 source diff 标注继续保持不改变 textarea 布局的覆盖层，但去掉徽标背景、圆角和小字号，改为贴正文基线的红色删除线。浏览器 smoke 已覆盖 source/preview 删除候选无 `-> 删除` 箭头，以及点击 `候选删除` 后 diff 标注为透明背景、0 圆角、正文尺寸删除线。

Task 07 latest supplement addendum（2026-07-03）：source textarea selection menu 的禁用控件视觉与 preview BubbleMenu 对齐；普通段落选区下不可用的列表缩进/减少缩进按钮会显示明确禁用态（低透明度、默认光标、无 hover 高亮），并保留 `先选择列表项` 的 aria/title 解释。浏览器 smoke 已覆盖 source 菜单打开后的 disabled 样式与可访问名称。

Task 07 latest supplement addendum（2026-07-03）：ReviewEditor 的命中级别、候选/人工状态、替换 title 和替换按钮文案收口到 `web/app/utils/review-issue-ui.ts`，source textarea menu、preview BubbleMenu 和 active-hit toolbar 共用同一套文案组合，避免候选删除/应用候选删除再次漂移。已补纯函数回归测试，并用浏览器 smoke 覆盖右侧命中激活 toolbar、source inline menu、preview BubbleMenu 三条候选删除路径。

Task 07 latest supplement addendum（2026-07-03）：source textarea menu 与 preview BubbleMenu 的批注/链接表单焦点管理从全局 `document.querySelector` 收口为组件本地 template refs；`data-review-*` 标记保留给测试和宿主键盘保护。浏览器 smoke 已覆盖 source 批注自动聚焦、source 链接 href 全选、preview 链接 href 全选三条路径。

Task 07 latest supplement addendum（2026-07-03）：source textarea menu 与 preview BubbleMenu 的批注/链接表单按钮补齐完整操作合同：保存/取消/应用链接/移除链接都有显式 `aria-label`/`title`，并补齐 comment/link cancel 稳定 `data-*` 钩子。浏览器 smoke 已覆盖 source 批注、source 链接和 preview 批注表单按钮。

Task 07 latest supplement addendum（2026-07-03）：当前命中批注表单也对齐 inline 表单按钮合同：取消按钮新增稳定 `data-review-active-issue-comment-cancel`，取消/保存按钮补齐 `aria-label`/`title`。浏览器 smoke 已覆盖右侧命中 -> Ctrl/Cmd+Alt+M -> 当前命中批注表单按钮 -> 取消关闭。

Task 07 latest supplement addendum（2026-07-03）：source textarea menu 的 toolbar 和块样式菜单补齐 `@mousedown.prevent`，与 preview BubbleMenu 保持一致；点击格式化/块样式按钮前不会让按钮抢走 textarea 焦点或打散 source 选区，批注/链接表单区域仍保持正常聚焦。浏览器 smoke 已覆盖 toolbar mousedown 后 source textarea 仍 active 且 selection 不变，以及链接表单聚焦不受影响。

Task 07 latest supplement addendum（2026-07-03）：修复入口发现性与规则元数据收紧：右侧 IssueCard 的可修复命中现在常驻显示 `能修复` / `候选修复` 标签和应用按钮，不再依赖 hover 才露出；规则 loader 会读取规则 JSON 中的 `review` / `fixability` 字段，并把最终 `fixability` 约束到真实能力，只有 `regex` + `replace` 可保持 `auto` / `candidate`，`suggest` / `llm` 规则会回落为 `manual`，避免 UI 把不可替换命中伪装成可修复。`cd web && bun run typecheck` 与聚焦单测通过；完整 llmlint 测试文件在 Windows 5s CLI 子进程超时下仍不稳定，本轮未声明全量通过；`web build` client/server 完成后 Nitro server packaging 长时间无输出，已停止该 build 进程树。

Task 07 latest supplement addendum（2026-07-14）：修复 source 模式删除 diff 与当前正文重叠导致文字叠飞。旧方案为保持 textarea 精确布局，把整段删除文本绝对定位到正文基线；当删除文本长于插入文本时，两层文字必然互相覆盖。source 背板现改为在删除锚点上方显示紧凑的红色 `-N` 字符数徽标，不再绘制整段旧文；完整删除内容仍保留在 preview diff 与当前修改上下文中。实际方案与旧计划的出入：保留“不改变 textarea 布局”的硬约束，但放弃 source 基线上的全文删除线展示，优先保证正文可读性与定位稳定。`web:typecheck` 通过；本地浏览器在用户截图同尺寸 `1534×465` 与窄屏 `390×844` 验证无正文叠字或新增横向溢出。

Task 05 latest supplement addendum（2026-07-14）：Web 完成二次元漫画编辑部 / 稿件扫描终端视觉改造。全局主题、Header、首页扫描台、历史分镜卡和工作台面板统一为青绿/珊瑚红/金色/炭黑/纸白印刷体系；保留工具第一屏和全部检测行为。移动端补充正文/报告高度约束，修复 390px 工作台正文被 flex 压到 1px 的问题。`web:typecheck` 通过；1280x720 light/dark 与 390x844 首页/工作台检查无横向溢出。原计划的原创角色位图因当前无可用内置图像生成工具未落地，本轮改用代码原生漫画视觉，未要求或读取用户 API Key。

Task 07 latest supplement addendum（2026-07-14）：审稿工作台的规则卡片、编辑面板和分隔器对齐漫画主题，分别加入三色印刷顶线、主题表面和网点纹理；只改视觉，不改命中定位、替换、批注或审稿状态。窄屏正文/报告分区修复后在 390x844 下分别保有 334px/425px 可操作高度。

Task 05 latest supplement addendum（2026-07-14）：前端代码整理完成。严格 `vue-tsc` 未发现未使用 TS，因此没有高风险拆分 `ReviewEditor`；首页桌面/移动历史卡片从两套重复模板收口为一套响应式模板，`HomeInputPanel` 从 641 行降到 529 行，并补齐历史入口、评分和展开按钮的原生语义。删除 `AppHeader` 未读取的 `registry` prop、IssueCard 死 opacity CSS 与 5 个无用途标记类。`web:typecheck` 通过；桌面历史收起/展开、评分、进入工作台及 390x844 无横向越界浏览器链路通过。

Task 05/06 latest supplement addendum（2026-07-14）：Web 全站空态密度优化完成。报告页增加 AUC/PAIR/RULES 与规则信号报告预览，数据集页增加 corpus tree 与 reference/render 配对预览，首页无历史状态增加真实 registry 状态台（303 regex / 8 LLM）；登录/注册共用稿件审阅场景外壳，保留原认证逻辑。实际范围没有重做已足够密集的审稿工作台，而是集中填补报告、数据集、认证页和首页无历史状态。`web:typecheck` 通过；1280x720 深浅主题及 390x844 报告、数据集、登录/注册检查无横向溢出。为保护用户本地历史，没有清空现有记录去截图无历史状态台。

Task 08 latest supplement addendum（2026-07-14）：评测可信度前置守门完成。render prompt 版本改为每个 sample 的必填审计字段；generator 新生成时写入版本，断点复用旧文件前强校验，score 对缺版本或跨版本直接退出且不产报告，成功报告记录唯一 `renderPromptVersion`。holdout 门槛、切分、规则 train 拟合与 AUC 只使用存在有效 `pairRef → reference.file` 映射的题组，reference-only/悬空配对不再虚增题组数。聚焦测试 12/12、根 typecheck、fixture AUC 1.000 通过；当前 corpus 28 个旧 render 缺样本级版本，已确认被守门拒绝。Task 08 M3/M4 完成前冻结新基线，当前 `0.530` 仅是 reference 已扩量但 render 未补齐的中间语料状态，不能作为规则质量结论。

Task 08 latest supplement addendum（2026-07-26）：**基线解冻完成**。历史 100 个 render 的样本级 `promptVersion` 有据回填（依据 = 组级 meta 是 generator 生成当时的运行记录 + `prompts.ts` 注册表自始至终只存在 `render-v1` 一个 render 版本，满足 07-14「版本来源被确认」条件，非猜填）；git diff 恰好 5 个 meta.json +100 行零删除，corpus 合同测试 20/20 绿。重跑 score 产出 **round-06 正式基线**（规则整理后首份）：llmlint AUC **0.966**、docScore 中位 人类 2.47 / AI 8.86、误杀 0.00/千字、强判别 5、holdout test 1.000（2 组小样本）、外部检测器 AUC 0.870。⚠ 与 round-05 不可比：docScore 量级降约 8 倍、强判别 15→5 均为 Task 23 规则消重关噪声所致，勿手抄旧中位数做阈值。详见 [Task 08 walkthrough](.agents/tasks/08-eval-pipeline-hardening/README.md) 与 METHODOLOGY §8。

## Known Follow-ups

- **Agent 历史与 Revision workflow（TODO，2026-07-19）**：后续评估接入 nb-history 承载 Session 历史浏览/分支；Revision 提交、进入下一版本、Session 切换、检测触发/重试必须统一设计 approval、幂等、长任务状态和失败恢复，本轮没有加入临时写工具。
- **Task 11 编辑器数据模型（Implemented，2026-07-07，待 playwright 验收）**：编辑器从四套并存坐标系收敛到**单一坐标权威**——一切锚定不可变原文坐标，草稿坐标由 piece-table 投影现算。批注改源锚定 `ReviewAnnotation`（`sourceFrom/sourceTo` + 投影 `stale`「原句已改」提示），`transformReviewComments/Diffs*` 命令式搬运与 `repairDiffs` prop 等死代码全删，undo 只回滚 plan 快照；sidecar 批注存储升 v2（按**原文** key，v1 废弃）。建议与已应用编辑显式分层：**未应用替换不再常驻画进正文**（绿浮标错位与「未修改却有删除线」两 bug 的根因），替换预览按需收敛到工具条/选区菜单/IssueCard，preview 徽章与删除线仅 active 命中显示。86 测试 + 双 typecheck 绿；预览精确 offset 映射（替换 indexOf 模糊匹配）拍板延后为独立任务。详见 [.agents/tasks/11-editor-data-model/README.md](.agents/tasks/11-editor-data-model/README.md)。

- **Task 12 统一数据模型（Designed，2026-07-06）**：评测语料 + web 采集收进同一概念模型（参与者×文本×断言；reference+render = LLM 扮演参与者，量大信度低）。设计定稿：`origin` 三变体（curated/generated/uploaded，删 seeded_gold/goldProvenance）、MachineRecord 拆 MachineScan/MachineDetect（含热力图 chunksJson 槽位）、PairJudgment/LlmJudgment 规范先行建表后置、**D1 改写为 lift 闸门**（只吃 origin∈{curated,generated}）。CONTEXT §2.5/D1 与 METHODOLOGY §0/§7 已同步。**web schema 增量迁移已由 [Task 13](.agents/tasks/13-web-five-step-flow/README.md) W1 执行**（2026-07-07）。详见 [.agents/tasks/12-unified-data-model/README.md](.agents/tasks/12-unified-data-model/README.md)。

- **Task 08 Eval Pipeline Hardening（Implemented，2026-07-03）**：环 ① 全链路硬化 + 小验证轮已跑通。M1 calibre 批转 mobi + catalog 状态层（`neuro-book/datasets/aigc-detection`，manifest 为书目真相源）+ 3 新题组（武侠/宫斗/无限流）；M2 generator 硬化（commander、`eval.config.json`+example 双文件、prompt 版本化注册表守 I8、`claude -p`/`codex exec` CLI transport 走 stdin/合并契约、per-provider 限流、token 预算预估/实报/自校准）；M3 可换外部检测器（HF yuchuantian，句界分块避截断、长度加权 mean、sidecar 内容 hash 缓存、`report.externalDetector` 对照节，复用 rocAuc 同口径）；M4 5 题组/65 render：**llmlint AUC 0.681**（较旧 2 组 0.833 降＝判别力 genre-dependent 实证）、**holdout 首解锁** train0.616/test0.778、**外部检测器 AUC 0.941 ≫ llmlint**（证检测器是强 oracle 地基、gap=漏网新规则矿）。⚠ CLI transport 上游 中转网关 不可达（claude 挂起/codex Reconnecting）未端到端验证，已降级快退。详见 [.agents/tasks/08-eval-pipeline-hardening/README.md](.agents/tasks/08-eval-pipeline-hardening/README.md)。
- **Eval M3**：更多题材/题组/模型 + 文风预设档 + holdout 切分；补稀疏规则 prevalence 口径、真 1:1 同 brief 配对；稳后把「规则体检表」正式交 Task 02 驱动规则修复。M4 的 repair 一轮已建（[Task 14](.agents/tasks/14-line-a-repair-loop/README.md)，2026-07-07），余 realism 难度档 + critic；之后 M5（LLM 规则判别 + 产品成绩单 + 显形回归集）。
- **规则质量**：`creative-writing@1` 继续排除 noise/anti 并抑制稳定 overlap；Task 23 已把可证实的重复、素材转换遗留和低信号规则默认关闭或下沉，不物理删除资产。最新一轮进一步关闭总结/通胀/绝对词/重复标点/瞬时反应、重复否定对比窄变体和错误“肌理→肌肉”规则，收窄安抚姿态与自媒体词表。当前 active exact regex target 重复为 0，当前 dataset 的 active 同 span regex overlap 为 0；全 detector 只剩两条 human 宏观节奏规则同段共振 1 处。后续继续用更多题材 holdout 校准，避免把单轮 verdict 写死为全局删规则。

## 2026-07-11 第二轮规则精简

- 默认规则 materialize 结果（Task 23 规则整理后）：360 total / 266 active；245 regex / 7 density / 6 handler / 8 semantic；review = agent 54 / human 210 / none 2；fixability = `auto=2 / candidate=0 / manual=264`。用户配置仍可把指定 regex replace 提升为 candidate。
- **`fixability` 不能当「改法要多少判断」的代理**：I13 强制语义替换默认 `manual`，264/266 都是 manual，选规则时零区分度。它量的是「脚本能不能盲改」。写作期选规则用 `action.type`（suggest 有祈使句 message / replace 只有词表）加判据类别。
- 写作期档位（`guide --tier`，四档严格嵌套）：`core` 13 条（语义 8 + eval strong 5）、`standard` 71 条（缺省，再加改法要重写的 suggest 规则）、`wide` 100 条（再加 eval weak）、`full` 266 条（再加 200 条词表）。判别力由 `--profile <report.json>` 外部传入，不烧进规则记录（I24）；无 profile 时 `core` 只剩语义 8 条、`wide` 等同 `standard`。
- Web registry 烘焙版本化 `creative-writing@1` profile。报告有效时排除 noise/anti；报告缺失时保留全量，但稳定 overlap 抑制仍生效。规则页保留完整超集并解释 profile 排除原因。
- `Report.overlap` 已纳入正式报告：16,962 raw hits / 11,388 unique spans / 32.9% 原始重复率；score 默认 holdout=0.4。
- 指定 NeuroBook `index2.md`：全量静态命中 115、机械修复 0、LLM 创作候选 17、候选重复 span 0。程度副词、量词、句尾比喻和二元转折家族不再重复进入清单。
- Profile holdout 验收：test AUC 0.990；人类 Agent 误杀 1.12/千字；AI Agent 命中 5.40/千字，是人类侧 4.81 倍；test duplicate rate 11.1%。
- 与首轮方案的出入：没有继续把 strong 语义规则提升为 candidate；判别力只决定是否进入创作 profile，机械权限仍由 `fixability` 独立决定。

## 2026-07-11 Web 配置式鉴权

- 新增 `NUXT_AUTH_ENABLED`：开发环境默认关闭，生产构建默认开启，`.env` 可覆盖。
- 登录关闭时，统一身份解析层返回稳定的 `__llmlint_local_development__` 普通用户，不依赖 Cookie；删除原先按静态路径名单创建随机匿名 session 的中间件。
- 配置式鉴权关闭时，workspace、reveal/machine、Agent session、detector run 等动态接口统一使用稳定本地开发用户，不依赖 Cookie。
- 前端随配置隐藏账号菜单；登录开启时 `/contribute` 路由守卫要求 session，关闭时直接进入工作台。login/register 在关闭模式返回 409。
- **语料合规**：主仓已处置（2026-07-27，[Task 24](.agents/tasks/24-revision-rounds-and-contribute/README.md) Phase 0）。红线曾被突破——仓库 07-16 前已 public 且历史含 `evals/corpus/` 全部 162 文件、其中 26 篇受版权章节全文；已用 git filter-repo 清全历史 + 一次性授权 force push，本地保留 + gitignore，远端 corpus/reference 计数均为 0。⚠ **残留未闭合**：两个 public fork（`Eacgh/llmlint`、`Otirik-handi/llmlint`）与主仓 `refs/pull/1|2/head` 仍带完整语料，force push 够不到；处置需联系 fork 所有者或 GitHub Support，属对外动作，**待用户决定**。
- **发布**：commit / push 到 `github.com/notnotype/llmlint`、tag、以及是否上 npm 由用户决定，本仓文档不代为执行。
- **Web 后续**：采集站部署宿主与数据库备份策略；注册限流/邀请码；~~LLM classification~~ ✅（Task 13 W6，mimo 异步补空）；~~外部 AIGC 检测器服务端通道与应用验收环~~ ✅（Task 13 W3，D5 检测概率腿已接、热力图数据已收 UI 后置）；~~curated/generated 语料导入~~ ✅（Task 13 W5，取代原 seeded-gold 指派评分流）；consent 删除/保留策略；众包公开池 + PairJudgment 打标小游戏 + `ReviewerPrediction` 通道已由 Accepted 架构规范定义，待实现；可选行内命中 hover 提示、分享链接/设置导入导出、完整 config 编辑器。~~`prisma migrate dev/db push` 报空 schema engine 错~~已解决（2026-07-01 复核）：根因是没设 `DATABASE_URL`，设 `file:./data.db` 后标准 migrate 干净通过；端到端 API 闭环（注册→上传→盲评→揭示→标注→导出）已用真 dev server 验证，见 `web/README.md` 与 `web/.env.example`。
