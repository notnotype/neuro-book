# 124 写作产品线第三批（拆书 / novel-api 集成 / 200 问批量 / 真实验收）

## Relative documents refs

- [122 写作链路第二批](../122-writing-pipeline-batch2/README.md)：前置任务（chapter-write-review-revise / consistency-audit）。
- `assets/workspace/.nbook/agent/skills/novel-guide/SKILL.md`：写作路线图（本任务更新 workflow 表与 genre-research 描述）。
- sibling 仓 `../novel-api`（NovelScope API）：榜单服务真相源（`docs/API.md`）。

## User Request / Topic

Task 122 后用户要求制定系统性计划（不留技术债/不过度设计/不脱离实际/不 hack），覆盖：整条写作产品线路线图 + 第三批能力 + 真实验收体系。当时拍板 novel-api 走 server 集成（非 Skill）；该小说数据决策已被 2026-07-27 的 Skill 硬切替代。200 问继续做成可选 workflow（默认仍逐题交互）；冒烟前提 = dev server 已起 + 现成测试项目路径（避开 Task 118 在途 projects API 变动）。

## Goal

拆书与 200 问 workflow 可被 catalog 加载且 mock 控制流全绿；novel-api 数据经 config→client→leader 只读工具→skill 全链可用（含设置面板）；真模型冒烟脚本对 dev server 干跑通过；路线图后续批次登记 PROJECT-STATUS。

## Current State

Implemented（2026-07-26；小说数据入口于 2026-07-27 硬切为 Skill）。真实模型冒烟（需用户起 dev server + 提供已打开的测试项目）与浏览器验收待用户，走查清单见下。

## ADR / Decisions / Discussion

- **已废止的 novel-api 分层（历史决策）**：当时由 `NovelDataClient` 和 Agent 工具直连服务，并把 HTTP 代理/浏览面板延后；2026-07-27 已由文末的 `novel-data` Skill 硬切完整替代，不再保留该路线图。
- **config 空串语义**：`novelData.baseUrl` 未写 → 默认 `http://localhost:3000`；显式空串 → 保留空串（=未配置，工具报设置引导）。`redactGlobalConfig` 显式字面量必须加段（history 曾被静默丢，已留警示注释）。
- **book-deconstruct 输入形态**：`book` 目录（番茄导入产物，读 metadata.json+full.md）或单 .md；只按一级标题切章（`\n(?=# )`，h2/h3 不切）；书名页判定=标题等于 metadata.book_name 或正文 <50 字；采样=开头 5 + 结尾 2 + 中段居中均匀（纯整数运算保证 replay 确定性）；汇总输入用逐章字段级摘要而非完整 JSON（控长）。split-book 保留为轻量单文件版。
- **character-qa-fanout**：批量模式是**可选项**，workshop skill 默认逐题交互不变（用户拍板）；题目由 leader 从 skill references 题库摘出经 args 传入（workflow 读不到系统资产目录）；答案册由代码按题号拼装，汇总员只产 notes/conflicts；题号解析防误伤（`Q[\w-]*\d[\w-]*` 整 token；裸数字须跟标点才算序号）。
- **冒烟脚本前提**：dev server + 现成项目路径；HTTP 触发的 run `deliver:"none"`，完成态只能轮询 **job** 端点（不是 run-state）；cancel 断言轮询终态而非信任 cancel 响应；`--project` 本地文件检查只在默认 State Root 下与服务端一致（文件头已声明）。
- 测试独立文件 + expectedPhases 主会话统一加（沿用 122 决策，避免并行编辑冲突）。

## Verification / Test

- workflow 六文件（catalog + builtins + 4 个独立测试）：21/21 绿；expectedPhases 已含 7 个内置 workflow。
- 当前小说数据 Skill 面：`novel-data` CLI 外部临时目录 frozen install、SkillCatalog 版本、旧工具不存在 smoke 与 validator 均有自动化覆盖；旧 novel-data tool/config 测试已随硬切删除。
- `bun run profile:metadata`：14 profiles（leader.default 的工具面改动已由 dev server 自动编译覆盖，重跑 0 stale）。
- leader-assets 保持 13/15 基线（2 失败仍为 Task 111 未提交漂移，无新增）。
- A2 全仓 typecheck：本批文件零错误（llmlint.test.ts 既有漂移与本批无关，Task 123 已记录测试套件不稳定基线）。
- 冒烟脚本干跑：`--help`/参数错误/项目不存在/探活失败四条 gate 路径 + 对真实 dev server 得到 409 PROJECT_NOT_OPEN（HTTP/轮询/错误链路端到端验证）；真实模型全场景未跑（需用户前提）。

## Implementation Walkthrough

四个并行子 agent + 主会话收口：

1. **A1**：`assets/workspace/.nbook/agent/workflows/book-deconstruct/workflow.ts`（phases collect/analyze/synthesize）+ `server/agent/workflow/book-deconstruct.workflow.test.ts`（3 用例：目录正常路径含 8 采 6 构成断言 / 单 .md / 缺失早 throw）。
2. **A2**：config 段六处 + redact 坑修 + `server/novel-data/novel-data-client.ts` + `server/agent/tools/novel-data-tools.ts`（novel_rankings / novel_book_detail，双轨返回，stale 首行标注）+ 注册链（index.ts / profile-tools / leader.default toolset / builtin-tools-smoke）+ `NovelIdeNovelDataSettingsPanel.vue` + SettingsDialog 6 处接线 + i18n 双语 + `novel-genre-research/SKILL.md` 重写为五步实流程 + novel-data-tools 测试（ofetch createFetch 注入 mock；注意 ofetch GET 默认重试一次）。
3. **A3**：`character-qa-fanout/workflow.ts` + 测试 + workshop skill 增「批量候选模式（可选）」节。
4. **B**：`scripts/smoke/writing-workflow-smoke.ts`（~420 行：探活 gate → consistency-audit → chapter-write-review-revise（含落盘文件断言）→ cancel 场景；jobs 端点轮询；场景独立 try/catch 汇总；exitCode 惯例）。
5. **主会话**：expectedPhases 两条 + novel-guide workflow 表（7 行齐 + split-book 标注轻量版 + genre-research 描述更新）+ 全部测试与重编译 + PROJECT-STATUS（路线图后续批次三项 + Recent Tasks 行）+ 本 README + memory。

## 走查清单（待用户）

### 清单 A：skill 对话链路走查（授权 `$playwright-cli` 后执行）

novel-setup 四阶段：
1. 阶段一：`lorebook/note/story-concept/index.md` 存在且明显长于 synopsis（不是同文复制）；有未答问题时 `PROJECT-STATUS.md` 出现 Pending Questions。
2. 阶段二：`lorebook/` 出现推导链产生的 rule/faction/location 节点，至少一个是占位（仅 summary 或 `status: pending`）；任挑一条能回答"够用阈值"中一项。
3. 阶段三：主角 `lorebook/character/{slug}/index.md` 用"角色定义/动机与矛盾"标题而非 `character.*` frontmatter；需追踪角色有同级 `state.md` 且与 index 不重叠。
4. 阶段四：`world-engine/calendar.ts` 时间格式与用户确认一致；`schema/index.ts` 已按 lorebook 映射定制属性（非模板原样）；问"现在世界状态"能看到 world + 至少一个角色 subject 与开局切面。

novel-writing 开局一轮：
5. 设计：开局五要素（处境/压力/选择/爽点/钩子）被确认，候选未当定案。
6. 落库：World Engine 出现开局时间点 slice，时间用项目日历字符串非 raw instant，只有确认事实入库。
7. 写章：目标 `index.md` 有正文；leader 汇报过"开局评审加严"（主动选择 / 弃书风险）而非普通评审收尾。

### 清单 B：novel-data Skill 走查

1. 首次运行前确认 Skill 根目录依赖门执行成功；缺少 `node_modules` 时必须用该 Skill 自带的 frozen lockfile 安装，安装失败立即停止。
2. 通过 `novel-data rankings --platform qidian --ranking monthly-ticket` 查询榜单，结果包含榜单名、`fetchedAt`、`expiresAt` 与排名；对用户说明快照时间，不说成实时数据。
3. 通过 `novel-data book-detail --platform <platform> --book-id <id>` 查询详情；命中 `stale=true` 时明确说明缓存可能过期。
4. 把 `--base-url` 指向未运行地址，确认 CLI 把连接错误写入 stderr 并返回非零退出码，不输出伪造结果。

### 冒烟脚本执行（待用户前提）

```
bun run dev   # 起 dev server，UI 中打开测试项目
bun scripts/smoke/writing-workflow-smoke.ts --project workspace/<slug> --chapters manuscript/001-volume/001-chapter/index.md --write-chapter manuscript/001-volume/002-chapter/index.md
```

## TODO / Follow-ups

- 真实模型冒烟执行 + 走查清单 A/B（待用户）；跑出的 bug 按惯例回灌 mock 回归测试并标注来源。
- 后续批次（已登记 PROJECT-STATUS）：dogfooding 轮；Task 116 剩余真 provider 挂账。小说数据不再规划技术设置面板或 NeuroBook HTTP 代理路由。
- Task 123 发现的全仓测试套件不稳定基线（41-53 文件失败）优先级高于写作线后续批次，修复归 123。

## 2026-07-27：小说数据从 Agent 工具硬切为 Skill

- 本节替代上文“novel-api 走 server 集成（非 Skill）”决策；上文实现清单仅保留历史记录，不再代表当前架构。
- 删除 `novel_rankings`、`novel_book_detail`、Leader 注册链、`NovelDataClient`、Global Config `novelData`、设置面板和旧工具测试，不保留兼容层。
- 新增 bundled `novel-data` Skill `1.0.0`，自带 `package.json`、`bun.lock` 和 `commander` 依赖，CLI 提供 `rankings` / `book-detail` 两个只读命令。服务地址优先级固定为 `--base-url`、`NOVEL_DATA_BASE_URL`、`http://localhost:3000`；缺少 `node_modules` 时先在 Skill 根目录执行 frozen install。
- `novel-genre-research` 改为先读取 `novel-data` Skill，再通过 `bash` 调 CLI；结论必须说明 `fetchedAt`，并在 `stale=true` 时明确提示缓存可能过期。
- 本地 NovelScope 仍负责缓存和采集，Skill 不触发刷新；官网没有小说数据 API，两条能力保持独立。
- 自动化只复制发布文件到仓库外临时目录，在该目录 frozen install 后覆盖地址优先级、URL 编码、空快照、stale/时间字段、404、502 和连接失败，证明 CLI 不借用仓库根或用户目录依赖；Skill 目录通过 validator。
