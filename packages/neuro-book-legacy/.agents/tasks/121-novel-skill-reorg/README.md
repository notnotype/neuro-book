# 121 写作 Skill 体系重组（novel-workflow → novel）

## Relative documents refs

- `reference/agent/novel-writing-workflow.md`：写作模式主协作链 reference（本次同步更新）。
- `assets/workspace/.nbook/agent/skills/novel-guide/SKILL.md`：新的写作流程唯一路线图。
- `docs/archived/skills/`：legacy emulation skill 归档位置。

## User Request / Topic

- Task 110/111 后 "workflow" 已专指脚本编排（`run_workflow` + 内置 workflow），`novel-workflow-*` skill 前缀撞名。
- 15 个写作 skill 缺少统一总览，agent 只能靠各自 frontmatter 判断什么时候用什么。
- 用户拍板的目标结构：三层（工具支持 / 随时可用 / 创作流程）+ 总览 skill；setup 四合一、writing 三合一；开局黄金三章作为 writing 循环的首轮特化（不放 setup）；05/06 emulation 移到 archived；新 workflow（consistency-audit / book-deconstruct / 章级写-评-修）本次只占位。

## Goal

写作 skill 从 15 个收敛为 9 个 novel skill + 1 个 guide，目录名（= skill key）全部去掉 `novel-workflow` 前缀；`novel-guide` 成为唯一全局路线图，各 skill frontmatter 只保留触发词；全仓（除归档与构建产物）无 `novel-workflow` 活引用；skill-catalog 与 profile 测试全绿。

## Current State

Implemented（2026-07-26），测试验证见下。

## ADR / Decisions / Discussion

- **命名分层**：`novel-import-*`（工具支持）/ `novel-idea-exploration`、`novel-genre-research`、`novel-technique-*`（随时可用）/ `novel-setup`、`novel-writing`、`novel-writer-execution`（创作流程）/ `novel-guide`（总览）。
- **novel-setup 四合一**：原 02 project-bootstrap + 03 lorebook-bootstrap + 04 character-design + world-engine-init 合并为一个 skill，主 SKILL.md 做入口分流（新开 / 导入 / 续写并入导入）与阶段总控，细节拆 `phases/01..04-*.md` 按需读取（防超大单文件 + 渐进加载）。
- **novel-writing 三合一**：原 08 plot-planning + 09 chapter-writing + 10 revision 合并为主循环（剧情设计 → 拍板落库 → 正文/评审/修订），原 07 opening-plot-design 降为其中的「开局模式」phase——开局本质是剧情设计+写作的首轮特化，依赖 World Engine 已初始化，单独成步会割裂流程。拍板落库环节显式覆盖三真相源：World Engine（状态）、Plot Workbench（结构/Promise/Decision）、lorebook（新稳定设定回填）。
- **workflow 接入**：skill 中引用现有内置 workflow——`parallel-brainstorm`（剧情/灵感脑暴）、`write-review-loop`（轻量非章节文本，明确不用于正式章节）、`split-book`（拆书）。新 workflow 只记 TODO 不实现（用户拍板）。
- **05/06 归档**：移到 `docs/archived/skills/`（脱离 catalog 扫描目录），文件头加归档说明（用户拍板选归档而非删除，照顾 legacy RP 项目）。
- **悬空引用清理**：原 07 引用的 `novel-technique-commercial-rhythm` skill 实际不存在，迁移时删除该引用。
- **测试夹具改名**：profile-dsl / leader-assets 两个测试用 `novel-workflow-09-chapter-writing` 作白名单排除夹具，改用真实新 key `novel-writing`。

## Verification / Test

- `bun test server/agent/skills/skill-catalog.test.ts`：预期列表已更新为新 9 skill。
- `bun test server/agent/profiles/profile-dsl.test.ts`：单跑 34/34 绿（含改名后的白名单夹具）。改 profile tsx 后需先 `bun run profile:metadata` 重编译（已执行，14 profiles）。
- `bun test server/agent/profiles/leader-assets-profile.test.ts`：13/15。**2 个失败是既有漂移，非本任务引入**：①「leader.default v3 工具名」期望的 rootToolKeys 缺 Task 111 未提交改动新增的 `run_workflow`/`list_workflows`/`list_jobs`；②「Project home 默认人设」期望的字符串「不引入 RP 小屋、万华镜」在全仓源码中不存在（未完成的前期改动）。另外两文件同跑会出 `PROJECT_PLOT_WORLD_MODULE_TOKEN` 报错（测试间模块缓存问题，单跑无此错）。
- 全仓 grep `novel-workflow`：仅剩 `docs/tasks/**`（历史 walkthrough）、`docs/archived/**`（归档本体与 PROJECT-STATUS 归档说明）、`templates/archived/**`、`product/.output/**` 与 `.compiled`（构建产物）。
- 浏览器验收（skill catalog 列表、agent 实际调用新 skill）留给用户。

## Implementation Walkthrough

1. **新结构**（`assets/workspace/.nbook/agent/skills/`）：
   - 新建 `novel-guide`（总览：三层结构表、典型旅程、内置 workflow 一览、阶段判断速查）。
   - 新建 `novel-setup`（总控 + `phases/01-project-bootstrap.md` / `02-lorebook-bootstrap.md` / `03-character-design.md` / `04-world-engine-init.md`，内容从原 02/03/04/world-engine-init 迁移，交叉引用改为阶段与新 skill 名）。
   - 新建 `novel-writing`（总控含意图判断表 + `phases/01-plot-design.md`（原 08 讨论方法 + brainstorm workflow）/ `02-canon-commit.md`（原 08 Phase 3-8 + Plot Workbench 段）/ `03-chapter-loop.md`（原 09 全文 + 评审步骤扩展 + 原 10 修订）/ `04-opening-mode.md`（原 07 + 开局评审加严「第三章弃书」检验））。
   - `novel-workflow-01-idea-exploration` → `novel-idea-exploration`（引用更新）；`novel-workflow-writer-execution` → `novel-writer-execution`（仅改 frontmatter name）。
   - 新建 `novel-genre-research` 占位（当前能做：tomato 导入 + split-book 拆书 + 题材惯例讨论；TODO：novel-api 榜单、book-deconstruct）。
2. **归档与删除**：05/06 `git mv` 到 `docs/archived/skills/` 并加归档头；`git rm` 旧 01/02/03/04/07/08/09/10/world-engine-init/writer-execution 十个目录。过程中清理了 7-21 遗留的 stale `.git/index.lock`。
3. **引用同步**：`writer.profile.tsx`（Import 路径 + 2 处文字）、`leader.default.profile.tsx`（L394 指向 novel-setup/novel-guide）、`leader.assets.profile.tsx`（注释）、`novel-technique-character-card-workshop`（4 处）、`novel-import-silly-tavern-card` SKILL.md + `scripts/silly-tavern-card.ts`（报告文案）、`RP模式`（emulation 归档说明）、`reference/agent/novel-writing-workflow.md`（Standard Flow + skill 表整体重写为三层）、`server/agent/skills/skill-catalog.test.ts`、`server/agent/profiles/profile-dsl.test.ts` / `leader-assets-profile.test.ts`、`docs/tutorials/02/03/04 + index.md`（顺带把 04 指向已归档 emulation 的段落改为 World Engine 口径）、`PROJECT-STATUS.md`（Hidden Legacy Systems 行）。

## TODO / Follow-ups

- ~~内置 workflow 第二批：`consistency-audit`、章级 `chapter-write-review-revise`~~ → **已在 [Task 122](../122-writing-pipeline-batch2/README.md) 落地**；`book-deconstruct` 仍占位。
- `novel-genre-research` 实化：接入 novel-api 榜单数据。
- 200 问角色深挖 workflow 化（低优先）。
- ~~tutorials 整体刷新~~ → **已在 Task 122 完成**（含 06 归档与模板 simulation 残留修复）。
- 浏览器验收待用户执行（profile 重编译 `profile:metadata` 已在验证环节跑过，14 profiles 全部重编译成功）。
- 用户 Workspace Root 侧的旧 skill 受管副本会在下次 user-assets 同步时按现有规则处理（未手改清理、手改保留冲突）；浏览器验收时顺带确认旧 `novel-workflow-*` 目录已从用户侧 catalog 消失。
