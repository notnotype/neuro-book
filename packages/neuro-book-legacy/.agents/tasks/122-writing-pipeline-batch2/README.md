# 122 写作链路第二批（workflow 落地 + guide 注入 + tutorials 刷新）

## Relative documents refs

- [121 写作 Skill 体系重组](../121-novel-skill-reorg/README.md)：前置任务，占位的 workflow 在本任务落地。
- `reference/agent/workflow/`（authoring.md、chart.md）：workflow 编写合同。
- `assets/workspace/.nbook/agent/skills/novel-guide/SKILL.md`：写作路线图（本任务注入 leader 并更新 workflow 表）。

## User Request / Topic

Task 121 后用户拍板并行推进四件事（多 agent 分发执行）：

1. 章级写-评-修 workflow（`chapter-write-review-revise`）——把 novel-writing 正文循环的手动评审修订变成确定性编排。
2. 一致性审计 workflow（`consistency-audit`）。
3. novel-guide 注入 leader.default（此前只有 catalog 两行 frontmatter 可见）。
4. tutorials 整体刷新（simulation 时代口径 → World Engine + 新 skill 体系）。

另拍板：教程 06 归档处理；默认模板自身的 simulation 残留一并修。

## Goal

两个新内置 workflow 可被 WorkflowCatalog 加载、mock 控制流测试全绿并在 novel-guide / novel-writing 中登记；leader 每轮上下文常驻 novel-guide 路线图全文；docs/tutorials 与默认项目模板无 simulation 活引用（归档与 `simulation-migration` 产物名除外）。

## Current State

Implemented（2026-07-26）。真实模型冒烟（run_workflow 实际跑两个新 workflow）与浏览器验收待用户。

## ADR / Decisions / Discussion

- **W1 写手用真实 `writer` profile，是内置 workflow "全 adhoc" 取向的刻意例外**：adhoc 固定工具集只有 read + report_result，写不了文件；落盘写章必须走 Leader-Writer 契约（`invoke({message, input:{path, chapterId?, context?}})`）。writer session 设 `ephemeral: false` 保留可追溯。评审仍全 adhoc。
- **评审每轮新建 ephemeral adhoc**（不跨轮 followup）：每轮把最新正文全文重新贴进 message，避免评审记忆陈旧稿。
- **收敛语义**：major=0 即收敛提前结束；`revise=false` 或达轮数上限时带着未收敛状态正常完成（不 throw），`converged` 字段告知调用方。
- **W2 全 adhoc + workflow 主体做全部 IO**：`wf.workspace.read` 读齐章节与 lorebook 后把片段拼进 message，agent 只判断不做 IO（重放友好、token 可控，抄 split-book 模式）。World Engine 事实由 leader 预查后经 `worldFacts` 参数传入——workflow 层没有 execute_world，也不该为审计引入有状态查询。
- **章节发现兜底**：`chapterPaths` 为空时读 `manuscript/index.md` 双正则提取；提取不出在创建任何 agent 前 throw，提示 leader 用 bash 列路径传入。WorkspacePort 无目录列举是硬边界。
- **测试放独立文件**（`chapter-write-review-revise.workflow.test.ts` / `consistency-audit.workflow.test.ts`），不挤 workflow-builtins.test.ts——两个并行 agent 各写各的避免编辑冲突；`workflow-catalog.test.ts` 的 expectedPhases 由主会话统一加。
- **P3 注入方式选 HistorySet Import**（三个候选中侵入最小）：`<SkillCatalog />` 之后插 `<Import path=".../novel-guide/SKILL.md">`；`reference/agent/leader-default.md` Skills 段补例外条款（novel-guide 已注入无需再 read），消解与"只在匹配时才 read skill"规则的冲突。
- **教程 06 归档而非重写**（用户拍板）：`docs/archived/tutorials/`；docs 站 srcExclude 排除 archived，站内链接删除而非改链（避免 404）。
- **模板 simulation 残留一并修**（用户拍板）：实际 13 处（探索列 11 + 复查多出 2），死链 `reference/content/simulation.md` 改为文字描述或并入 lorebook.md 链接。

## Verification / Test

- `bun test server/agent/workflow/workflow-catalog.test.ts workflow-builtins.test.ts chapter-write-review-revise.workflow.test.ts consistency-audit.workflow.test.ts`：15/15 绿（expectedPhases 已含两个新 key）。
- W1 测试覆盖：两轮循环 phase 序列 / 提前收敛 / chapterPath 缺失 0-agent 早失败；W2：并发审计透传 + verdict / lorebook 容错 / 空清单早失败。
- `bun run profile:metadata`：14 profiles，1 stale（leader.default）重编译成功——同时证明 novel-guide Import 路径可解析。
- `bun test server/agent/profiles/profile-dsl.test.ts server/agent/skills/skill-catalog.test.ts`：40/40 绿；leader-assets 保持 13/15（2 失败为 Task 111 未提交漂移，未新增）。
- `rg simulation docs/tutorials templates/project-directory-templates`：仅剩 05 中两处 `simulation-migration` 产物名（允许）；`rg novel-workflow docs/tutorials` 零匹配。
- **已知非本任务失败**：`bun test server/agent/workflow/` 全目录 35 测试中 12 失败——demo-service（10）与 job（1）是 `vi.resetModules` 等 Vitest API 在 bun test 下不可用；run-vm（1）是 mermaid 断言漂移。均为工作区既有未提交面，与新 workflow 无关。

## Implementation Walkthrough

四个并行子 agent + 主会话收口：

1. **W1**：`assets/workspace/.nbook/agent/workflows/chapter-write-review-revise/workflow.ts`（phases write/review/revise/finalize；args chapterPath/brief/chapterId/lorebookEntries/reviewRounds/revise；brief 与 chapterId 至少一个）+ 独立测试 3 用例。
2. **W2**：`assets/workspace/.nbook/agent/workflows/consistency-audit/workflow.ts`（phases collect/audit/merge；args chapterPaths/lorebookPaths/worldFacts/maxChapters；issue kind 六分类 + verdict 三态）+ 独立测试 3 用例。
3. **P3**：leader.default.profile.tsx L279 插 novel-guide Import；LEADER_SYSTEM_PROMPT 措辞改"按已注入的 novel-guide 路线图判断"；leader-default.md Skills 段例外条款。
4. **D4**：tutorials 七篇刷新（index 路线图 6 篇、01 重写目录与概念、02 全量 simulation 修正、03 补"第五步：初始化世界引擎"、04/05 口径修正、06 git mv 归档加横幅）；站内死链清理（docs/.vitepress/config.ts、agent/subject-rag-memory.md、profile/leader.md、profile/other-profiles.md）；模板 13 处修复。
5. **主会话**：expectedPhases 两条、全部测试与重编译、novel-guide workflow 表更新（两个新 workflow 入表、计划中只剩 book-deconstruct）、novel-writing phases/03 的 workflow 引导改写、PROJECT-STATUS（消 TODO + Recent Tasks 行）、本 walkthrough。

过程插曲：D4 期间再次遇到 stale `.git/index.lock`（44 分钟前、无 git 进程），按惯例清除后继续。

6. **审查轮补修**（主会话链路走查发现）：教程 05 结尾"下一节会…写前三章"在新 6 篇路线中成了倒指（05 是末篇），改为收尾指引；02 残留旧词"推进世界运行态"改 World Engine 口径；05 L78/L80 重复句收敛；`docs/README.md` 教程线描述"到第一次 RP"改"到前三章"。另确认：模板 index.md 的 `../../../reference/**` 外链是既有全模板惯例（10+ 处），非本批引入，未动。

## TODO / Follow-ups

- 真实模型冒烟：在真实会话里 `run_workflow` 跑 `chapter-write-review-revise`（准备好剧情事实与章节节点）与 `consistency-audit`（多章项目），观察 writer 落盘、评审 schema 命中率、审计误报率。
- 浏览器验收：leader 新会话确认 novel-guide 已入上下文、skill/workflow catalog 展示正常；tutorials 站点构建后走查。
- `book-deconstruct` workflow、novel-genre-research 实化、200 问 workflow 化（见 PROJECT-STATUS）。
- workflow 目录 12 个既有测试失败（vi API 不兼容/断言漂移）属 Task 111 未提交面，随该任务收口处理。
