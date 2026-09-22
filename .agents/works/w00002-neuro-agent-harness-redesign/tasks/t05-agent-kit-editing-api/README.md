---
schema: nbook.task/v2
taskId: t05-agent-kit-editing-api
---

# agent-kit 四模式编辑与资源组件

## 当前状态

- 2026-09-18 **已完成**：按开发者批准的 `local://agent-kit-editing-api-plan.md` 交付 `@notnotype/agent-kit` 的 `./resources`（URI 寻址、registry、静态文本与受控 Node 文件 provider）与 `./editing`（replace/patch/apply_patch/hashline 严格规划、hashline 观测与块定位、提交与补偿），`./file-tools` 迁移为 `./text`；两份 `planned` Spec 已登记。门禁：包 `test` 143 passed | 1 skipped、`typecheck` 通过、`docs:check` 0 失败、`governance:check` 仅两项既有无关失败。证据：`evidences/2026-09-18-agent-kit-editing-api-verification.md`。
- 2026-09-18 **接口规范落地**：开发者要求把 README 的接口介绍整理到 `packages/agent-kit/docs/specs/`；已完成规范总则 + 四个命名空间规范 + 候选登记，README 改为总览索引。记录：`walkthroughs/002-interface-specs-2026-09-18.md`。
- 2026-09-18 **规范目录按命名空间分文件夹 + `countTextTokens`**：`docs/specs/<namespace>/README.md` 作索引，`editing.md` 拆成 `editing/{README,engine,observations,blocks,commit}.md`；`./text` 新增 `countTextTokens(text, options?)`（TDD，RED→GREEN），分词器符号移入 `src/text/tokens.ts`。门禁：包 `test` 147 passed | 1 skipped（13 files）、`typecheck` 通过、`docs:check` 0 失败；公共导出覆盖度 58/58。包内文档链接不在 `docs:check` 范围内，另用一次性脚本校验（15 个文件 0 断链）。
- 2026-09-18 **代码评审完成**：五轴评审 + 两个独立 reviewer 子代理；确认缺陷 5 项（含 1 项数据损坏、1 项假成功）全部修复，另有作者自查 3 项与 token 截断 1 项；每项都有 RED→GREEN 测试证据。评审记录：`walkthroughs/001-code-review-2026-09-18.md`。
- 偏差与未验证项见证据文件的「计划偏差」「未验证 / 未做」两节；两份 Spec 保持 `planned`，待 Reviewer 复核后晋升。

- 2026-09-18 **agent-kit 删除（开发者决定）**：删除 `packages/agent-kit/` 整包、根 workspaces 条目、CI 包矩阵条目、三个工作流的路径过滤、仓库级 `docs/specs/agent-kit/{editing,resources}.md` 与注册表两行；`bun install` 刷新 lockfile（removed 1）。门禁：`docs:check` 0 失败（5471 文件）、`governance:check` 仅两项既有无关失败、包矩阵脚本选择逻辑复核通过。实现已归档到 `%TEMP%/nb-agent-kit-archive-2026-09-18`（55 文件 / 564 KB，未提交故无 git 历史）。记录：`walkthroughs/005-agent-kit-removal-2026-09-18.md`。

## 遗留项（交 Leader 决定，本 Task 不做）

1. `docs/specs/agent-kit/{editing,resources}.md` 仍为 `planned`：晋升 `implemented` 需要另行复核与批准。
2. 包内接口规范已落地（`packages/agent-kit/docs/specs/`，含规范总则、四个命名空间、候选登记）。是否需要把接口规范**也**纳入仓库 `docs/specs` 注册表（例如登记 `agent-kit.text` 能力），由 Leader 按「每个能力一份 Spec」的口径决定。
5. **model catalog（已被删除取代）**：原计划自建 `./models`；随 agent-kit 删除作废，改为直接使用 `@oh-my-pi/pi-catalog`。
6. **model catalog（新需求，待开发者决策）**：开发者要求 agent-kit 提供模型目录与更新能力（要最全面的数据来源），并明确「需讨论」。只读调研（pi / omp / models.dev / OpenRouter / LiteLLM 等）完成后以决策简报呈报，未获批前不实现。
6. 建议（未执行，属 CI 改动）：`check-documentation.ts` 的 `isActiveMarkdown()` 未覆盖 `packages/*/docs/**`，包内文档链接目前无 CI 校验。
3. 未覆盖验证项（POSIX 专属语义、mutation 中途补偿/abort、64 MiB 观测预算真实载荷、跨进程外部写者）在需要时另开 Task。
4. 评审事故：子代理清理临时脚本时误删 `$TEMP` 下其它会话的可再生目录（见 walkthroughs/001），仓库文件无影响。

## 目标

在 `packages/agent-kit` 内交付：

- `./resources`：资源 locator 解析、registry、静态文本 provider、受控 Node 文件 provider（CAS、containment、无隐式建父目录）。
- `./editing`：四模式严格规划（纯计算、显式快照与观测）、hashline 观测存储与内容 tag、块定位 resolver、提交组件（提交/拒绝/回滚/部分恢复）。
- `./text`：现有 truncate 能力迁移落点；`./file-tools` 退役。
- `docs/specs/agent-kit/{editing,resources}.md` 两份 `planned` Spec，登记 capability `agent-kit.editing`、`agent-kit.resources`。

## 范围与非目标

范围：包内实现、公共接口、黑盒合同测试、四模式真实文件 smoke、Spec 与注册表。

非目标：不提供 AgentTool / 工具 schema / 提示词 / 模型模式选择；不接入 NeuroBook 产品（由 #117 管理）；不实现 sandbox 后端；不承诺跨进程 CAS 或多文件事务原子性；不发布 npm；不 push/合并。

## 验证

- `bun run --cwd packages/agent-kit test`、`bun run --cwd packages/agent-kit typecheck`。
- 四模式 smoke 通过公共 subpath 组装，真实临时目录下的最终磁盘文本为 `alpha\nBETA\ngamma\n`。
- 合同测试覆盖计划中「新行为必须验收的具体场景」1–8。
- `bun run docs:check`、`governance:check` 结果记录（未运行项写明原因）。

## 决策与权限边界

批准依据：开发者 2026-09-18 批准 `agent-kit-editing-api` 计划。范围内本地可逆实现、测试与文档由本 Task 执行；远端写入、push、发布、部署、真实 Provider 与数据删除仍需分别授权。
