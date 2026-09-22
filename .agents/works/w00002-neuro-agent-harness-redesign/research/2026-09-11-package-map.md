# 通用包蓝图（候选）：从 NeuroBook 抽出的领域无关能力

> 类型：候选蓝图（研究输入）；除标注「已定 / 已建」外均**未决策**，不是 Proposal/Spec/Task 合同。
> 日期：2026-09-11。来源：`t01` 的 `001` 证据、`004` 研究、两份 scout 取证；`t02`/`t03` 落地结果。

## 1. 现在到哪了（先回答"是否拆完"）

**没有拆完。** 已落地的只有：

- **已建的包（2 个）**：`@notnotype/agent-sse`（成员 `sse-writer`）、`@notnotype/agent-file-tools`（成员 `truncate`）。
- **已定的决定**：抽取源 = NeuroBook；粒度 = 领域级单包 + subpath；SSE 基线 = 独立包实现；bash = 单独成包（`@notnotype/agent-shell`）；测试治理 = `D-TEST-01`（TDD / 只测关键 / 每包 smoke / 真实 LLM 不 mock）。
- **未定**：完整包清单（下表全部为候选）、每个候选是否获批、以及各包的 API 形状。

## 2. 结构规则（已定部分的形态，新包沿用）

- 单包 + subpath 导出：`"." → ./src/index.ts`，成员走 `"./<member>" → ./src/<member>.ts`；**源码即导出**（无构建步骤）。
- 测试与被测源码同目录（`src/**/*.test.ts`）；每包一份 `vitest.config.ts`（显式 root/include + test-support setup/globalSetup）；包脚本 `test` / `typecheck`；每包 ≥1 条 smoke。
- 依赖方向单向：领域 harness → 通用包；通用包之间允许单向依赖、禁止环；不得依赖 `nbook/*`、产品 workspace/prisma、产品 DTO、`@earendil-works/pi-*`。
- CI：加入 `scripts/ci/workspace-package-matrix.ts` 条目 + `workspace-packages.yml` 路径；新包还要补 `code-baseline.yml` 与 `product-platforms.yml` 的路径（`workspace-workflows.test.ts` 合同强制）。
- 命名：`@notnotype/agent-<domain>`（暂定）；`private: true`，无运行时依赖（除明确声明的通用包）。

## 2.5 聚合结构与命名（2026-09-11；**已决定**：方案 A + `@notnotype/agent-kit`）

> 决定（2026-09-11）：采用方案 A（单包 + 命名空间）；包名 = **`@notnotype/agent-kit`**（"不是 harness，但可以组成 harness；领域无关，通常是算法库或工具库"）；已建的 `agent-sse`/`agent-file-tools` 迁移并入；领域 harness 目标名 = `@notnotype/neuro-agent-harness`，**待旧包退役后复用**（旧包当前冻结给 llmlint）。
> 下面的对照表与迁移步骤保留为决策过程记录。

开发者反馈：`@notnotype/agent-sse` 这种"每个领域一个包"偏散；倾向把 agent 相关能力聚合，或不拆包、按命名空间组织（LangChain 式）。

| 方案 | 形态 | 消费者写法 | 评价 |
| --- | --- | --- | --- |
| **A（建议）** | 单包 `@notnotype/agent` + 命名空间 subpath | `@notnotype/agent/sse`、`@notnotype/agent/file-tools` | 一个包、一个版本、一个 CI 条目、一份依赖集；成员用目录命名空间；将来某成员需要独立演进时再拆出去（升级路径保留） |
| B | 核心包 + 领域包（`@notnotype/agent-core` + `@notnotype/agent-<domain>`） | `@notnotype/agent-sse` | LangChain JS 实际是这种多包 scope；核心抽象独立，但仍是"散"的形态 |
| C | 维持现状（`agent-sse`、`agent-file-tools`…） | 同现状 | 只在各领域确有独立版本需求时才合理 |

**包名候选**：`@notnotype/agent`（推荐，聚合语义最直接）／`@notnotype/agent-core`（强调"核心"，但若它就是全部能力会名不副实）／`@notnotype/agent-kit`。

方案 A 的目录与导出形态：

```text
packages/agent/                    # @notnotype/agent
  package.json                     # exports: "." + 每个命名空间
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                       # 汇总入口（保守导出稳定符号）
    sse/          frame.ts · hub.ts · writer.ts   (+ 同目录测试)
    file-tools/   truncate.ts · patch.ts · tools.ts
    shell/        shell.ts · output.ts
    session/      log.ts · plan.ts · query.ts
    profile/      dsl/ · compiler/ · catalog/
```

```json
"exports": {
  ".": "./src/index.ts",
  "./sse": "./src/sse/index.ts",
  "./file-tools": "./src/file-tools/index.ts",
  "./shell": "./src/shell/index.ts",
  "./session": "./src/session/index.ts",
  "./profile": "./src/profile/index.ts"
}
```

**若采用 A 的迁移步骤**（机械操作，需开发者点头）：

1. 把已建的 `packages/agent-sse/src/sse-writer.ts` 与 `packages/agent-file-tools/src/truncate.ts`（含测试与 smoke）移入 `packages/agent/src/{sse,file-tools}/`，公共符号名不变；
2. root `workspaces`：两条换一条；`bun install` 同步 `bun.lock`；
3. CI：`scripts/ci/workspace-package-matrix.ts` 一条条目；三个工作流的路径改为 `packages/agent/**`（契约测试 `workspace-workflows.test.ts` 会强制）；
4. 复跑：两个成员既有测试 + 契约测试 + `docs:check`/`governance:check`/`diff-check`。

**代价与边界**：单包意味着统一版本——某成员需要独立版本/独立依赖时再拆（例如 `shell` 依赖 `@notnotype/owned-process`，会进入整包 dependencies；若不想背负，可把该依赖设计为可选或动态导入，或届时把 `shell` 拆出）。

**领域 harness 包名**（另一个待定）：旧包 `@notnotype/neuro-agent-harness` 仍冻结给 llmlint 使用；新建的领域 harness 可复用该名（待旧包退役后再接管）或另起新名，需一并决定。

## 3. 候选包蓝图

| 包 | 成员（subpath） | 来源（现实现） | 介绍 | 状态 |
| --- | --- | --- | --- | --- |
| `agent-sse` | `frame` | 独立包 `src/sse.ts`(54) + 前端 `app/utils/http/read-sse.ts`(170) | SSE 帧序列化/解析（纯函数；含 128KiB 上限、CRLF 等约定） | 候选（下一批） |
| | `hub` | 独立包 `src/events.ts`(557) + 产品 `events/session-event-hub.ts`(488) + `jobs/agent-job-event-hub.ts`（第三处同构） | 有界 replay/live 事件中心：双预算、cursor/epoch、超预算降级 `snapshot_required`、closeReason。**三处合一** | 候选（第二批，需先定 API 形状） |
| | `writer` | 产品 `events/agent-sse-writer.ts`(135) | Node backpressure 写帧（一次一帧、等 drain、close/abort 竞争） | **已建** |
| `agent-file-tools` | `truncate` | 产品 `tools/truncate.ts`(151) | 头/尾按行与字节截断（2000 行 / 50KiB 默认） | **已建** |
| | `patch` | 产品 `tools/apply-patch.ts`(511) | Codex patch 解析/规划（VirtualFileState）/跨文件逆序回滚；授权经 seam | 候选（下一批） |
| | `tools` | 产品 `tools/file-tools.ts`(863 的 read/write/edit) + `types.ts`(272) + `file-tool-utils.ts`(47) | read/write/edit 的 schema 与执行体；需注入授权/互斥/记账/附件/输出五类 seam | 候选（后期，需 port 设计） |
| `agent-shell` | `shell` | 产品 bash 分支 + git-bash/Scoop/Chocolatey 解析 + `owned-process` 调用 | 进程执行：cwd 授权 seam、超时/中止终态映射、后台 Job seam | 候选（已定归属） |
| | `output` | 产品 `tools/bash-output-store.ts`(325) + `output-accumulator.ts`(180) | 输出 lease/owner marker/TTL/容量回收 + 逻辑 locator（路径根参数化） | 候选（已定归属） |
| `agent-session` | `log` | 产品 `session/session-repo.ts`；独立包 `session.ts`、`storage/{jsonl,jsonl-lock,memory,reconcile-interrupted}.ts` | append-only 会话日志 + 可替换存储（JSONL 第一方实现）+ 中断尾修复 | 候选（中期） |
| | `plan` | 产品 `session/write-plan.ts` | SessionWriteExecutor：per-session 串行 durable append、batch/array admission、事件发布挂钩 | 候选（中期） |
| | `query` | 产品 `session/history-query.ts` | 历史分页/投影查询 | 候选（中期，可能并入 `log`） |
| `agent-profile` | `dsl` + `jsx-runtime` | 产品 `profiles/profile-dsl.ts`、`profiles/profile-dsl/jsx-runtime.ts` | `.profile.tsx` 提示词装配 DSL（`ProfilePrompt`/`System`/`HistorySet`/`AppendingSet`/`Reminder`…） | 候选（中期，体量大） |
| | `compiler` | 产品 `profiles/profile-artifact-compiler.ts`、`profile-compile-worker.ts`、`profile-artifact-store.ts`、`profile-artifact-gc.ts`、`profile-build-coordinator.ts` | 编译 worker、产物存储/回收、依赖门禁、热更新协调 | 候选（中期） |
| | `catalog` + `schema` | 产品 `profiles/catalog.ts`、`define-agent-profile.ts`、`define-agent-runtime.ts`、`types.ts` | 加载/覆盖（install/project/memory）、issue 归集、profile 定义与运行时 hook 合同 | 候选（中期） |
| `agent-attachments` | `policy` / `codec` | 产品 `agent/attachments/*` + `file-tool-utils` MIME 探测 | 附件策略（图片 MIME/大小上限）与存储 ref 编解码（sink 注入） | 候选（低优先） |
| `agent-approvals` | `approval` | 产品 `tools/approval.ts`(146) + 独立包 `approval.ts` 类型 | 审批挂起推导、resolution→toolResult 转换 | 候选（低优先、小） |
| `agent-messages` | `utils` / `presentation` | 产品 `agent/messages/*` | 消息文本提取、存储消息展示 | 候选（需评估领域耦合） |
| `agent-public-events` | `policy`（预算常量族） | 产品 `events/public-event-policy.ts`、`public-*.ts` 投影族 | 公开事件字节预算与 DTO 投影；projection 与产品 DTO 耦合重 | 候选（可能只抽 policy/预算，其余留领域） |
| `agent-jobs` | `event-hub` | 产品 `jobs/agent-job-event-hub.ts` | 全局 Job 事件中心 | **倾向并入 `agent-sse/hub`**，不单独成包 |

## 4. 不拆（留在领域 harness / 产品）

- `NeuroAgentHarness` 运行循环本体（`harness/neuro-agent-harness.ts`，8528 行）与其领域编排。
- 领域 profile 定义（`default-profile`/`summarizer`/`adhoc`/leader/writer 等）与 Low-Code Form 集成。
- 领域工具：`world-engine-tools`、`plot-tools`、`subject-memory-tools`、`workflow-tools`、`job-tools`、`task-tools`、`control-tools`、`sql-tool`、`agent-collaboration-tools`。
- 领域接缝：路径授权（`authorized-file-operation`）、Project 数据面互斥、写历史记账（`agent-file-recorder`）、workspace/prisma。
- 产品表面：DTO、HTTP/SSE 路由、前端 reducer 与 UI。
- 既有其它包（`nb-*`、`neuro-book-contracts`、`owned-process`、`file-snapshot-cache` 等）不属本次拆分。

## 5. 需要圈定的问题

1. 候选表中**批准哪些、暂缓哪些、明确不做哪些**（当前候选 8–10 个包，建议分批）。
2. `agent-sse/hub` 的参数化 API 形状（泛型 payload、`maxEventBytes`、`snapshot_required` 信号、订阅接口）。
3. `agent-session/plan` 与 `agent-sse/hub` 的关系（硬依赖还是回调 seam）。
4. 投影族（`public-*`）是否通用化，还是只抽 policy/预算常量。
5. 通用包是否需要版本/兼容承诺（目前全部 private、无发布流程）。

## 6. 建议起步顺序

1. **第一批**：`agent-sse/frame` + `agent-file-tools/patch`（小、稳、无需新决策）。
2. **第二批**：`agent-sse/hub`（先出 API 形状简报，再合并三处实现）。
3. **第三批**：`agent-shell`（新包：登记 + CI 接线 + TDD）。
4. **后续**：`agent-session`、`agent-profile`（体量大，各自值得单独一次决策）；其余候选按需。

## 7. 来源

- `t01`：`walkthroughs/001-host-evidence-and-observation.md`、`walkthroughs/004-generic-package-testing-research.md`、`evidences/2026-09-11-extraction-spike-report.md`、`walkthroughs/006-decision-record.md`。
- 只读取证：`agent://SseDomainScout`、`agent://WriteEditToolsScout`（逐文件清单与行数）。
- 落地结果：`t02`（两个包）、`t03`（CI 接线）。
