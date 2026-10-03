# Simulation Rollback Mechanism

## Relative Documents Refs

- [reference/content/simulation.md](../../../reference/content/simulation.md)
- [reference/agent/sse.md](../../../reference/agent/sse.md)
- [docs/tasks/36-agent-prompt-engineering-simulation-director/README.md](../36-agent-prompt-engineering-simulation-director/README.md)
- [docs/tasks/23-agent-sidecar-profile-pass/README.md](../23-agent-sidecar-profile-pass/README.md)

## User Request / Topic

- 用户和 NeuroBook leader 讨论后确认：回滚机制和 RAG 机制拆成两个 task。
- 本 task 只记录回滚机制初步实现方案。
- RAG 是独立任务，本 task 不展开 RAG 设计。
- Plot 不做回滚。第一版只处理 `simulation/` 文件、subject 状态文件，以及 `simulator.actor` 相关 Agent Session 的 active leaf 回滚。

## Goal

实现一个可验证的 simulation tick 回滚机制：在 RP / writing simulation 过程中，可以把 `simulation/` 下的运行态文件恢复到某个 tick checkpoint，并把相关 `simulator.actor` session 的 active leaf 移回对应 checkpoint 前的 entry，同时保留旧文件历史和旧 session 分支用于审计。第一版不回滚 Plot System、不裁剪 JSONL、不删除历史分支。

成功标准：

- 每个 tick 开始前能记录一个文件 checkpoint，范围限定在当前 Project Workspace 的 `simulation/`。
- rollback 能把 `simulation/subjects/`、`simulation/entities/`、`simulation/runs/` 恢复到指定 checkpoint。
- rollback 能把参与该 tick 的 `simulator.actor` session 移动到指定 entry / leaf，不修改或裁剪 session JSONL。
- rollback 报告清楚列出：文件回滚目标、影响的 subject / entity / run 文件、移动的 actor session、跳过的 Plot 回滚。
- 回滚期间如果相关 session 仍有 active invocation，应拒绝执行或要求先 abort，避免新事件写入旧分支。

## Current State

- 当前稳定 simulation 目录只保存 runtime state：
  - `simulation/subjects/{subject-id}/subject.md`
  - `simulation/subjects/{subject-id}/memory-seed.md`
  - `simulation/subjects/{subject-id}/events.jsonl`
  - `simulation/subjects/{subject-id}/memory.jsonl`
  - `simulation/subjects/{subject-id}/mind.md`
  - `simulation/subjects/{subject-id}/state.md`
  - `simulation/entities/**`
  - `simulation/runs/**`
- `simulator.leader` 是 RP / writing simulation 共用入口，负责裁决世界、维护 `simulation/`、调度 `simulator.actor`。
- `simulator.actor` 主 run 不直接写文件；`actor.memory-save` sidecar 在 settle 阶段维护 subject-facing `events.jsonl`、`memory.jsonl`、`mind.md`。
- Agent Session 已是 append-only tree。编辑、retry、rollback、fallback 不应原地覆盖旧历史，而是移动 active leaf 后追加新分支。
- 现有 `SessionWritePlan.moveLeaf` / `JsonlSessionRepository.moveLeaf()` 可以表达 active leaf 移动；`activePathRevision` 用于让前端在 active path rewrite 后重建 snapshot。
- Plot System 存在于 Project SQLite。第一版明确不回滚 Plot，也不 checkout `.nbook/project.sqlite`。

## Decisions / Discussion

- 回滚单位使用 `simulation tick`，不是单个文件、单个 subject 或单条消息。tick 是用户可理解的 RP / simulation 事务边界。
- 回滚是非破坏性操作：文件历史保留在 checkpoint 存储中，session 历史保留在 JSONL 中。
- 文件层可依赖 git，但不要污染用户项目根仓库，也不要要求 Project Workspace 本身被用户 git 管理。
- 建议使用 internal git store：

```text
{project}/
|-- .nbook/
|   `-- simulation-history.git/
`-- simulation/
    |-- subjects/
    |-- entities/
    `-- runs/
```

实际命令使用 `--git-dir .nbook/simulation-history.git --work-tree .`，并且所有 add / restore / diff 都限制 pathspec `simulation/`。

- checkpoint label 建议使用 `tick/{tickId}/pre` 和 `tick/{tickId}/post`。
- 第一版必须至少有 `pre` checkpoint；`post` checkpoint 用于审计和 diff，可以后续补。
- `simulation/runs/ticks/{id}-{slug}/report.md` 和 `prose.md` 属于 tick 产物，应随 `simulation/` 一起回滚。
- `agent-context/`、`lorebook/`、`manuscript/`、`reference/` 不参与本机制。
- `simulator.actor` session 回滚只移动 active leaf；不删除被回滚掉的 actor 回复、tool result、sidecar runtime 投影或错误记录。
- Plot 不参与 rollback。rollback report 需要明确写出 `Plot rollback: skipped by design`。

## Initial Implementation Plan

### 1. Tick Checkpoint Metadata

新增 tick checkpoint 元数据，用来把文件 checkpoint 和 actor session leaf 对齐。

建议位置：

```text
simulation/runs/ticks/{tick-id}-{slug}/rollback.json
```

草案结构：

```json
{
    "version": 1,
    "tickId": "000005",
    "projectPath": "ming-ding-zhi-shi",
    "createdAt": "2026-06-07T00:00:00+08:00",
    "fileCheckpoint": {
        "preRef": "tick/000005/pre",
        "postRef": null
    },
    "actorSessions": [
        {
            "subjectId": "erina",
            "sessionId": 123,
            "preLeafId": "entry-before-actor-run",
            "postLeafId": "entry-after-actor-run"
        }
    ],
    "plotRollback": "skipped"
}
```

`rollback.json` 本身在 `simulation/` 下，因此也会被文件 checkpoint 管理。实现时需要注意：如果回滚到 pre checkpoint 导致当前 tick 目录消失，CLI 应先从工作区或 checkpoint store 读取 rollback metadata，再执行 restore。

### 2. File Checkpoint Service

新增内部服务，负责初始化和操作 `.nbook/simulation-history.git`。

职责：

- 检查 Project Workspace 根目录和 `project.yaml`。
- 初始化 internal git store。
- 配置必要 git 参数，例如禁用外部 hooks。
- 只 add / restore `simulation/`。
- 生成 checkpoint commit / ref。
- 输出 checkpoint diff summary。

第一版不要处理 `lorebook/`、`manuscript/`、`agent-context/` 或 `.nbook/project.sqlite`。

### 3. Session Rollback Service

新增 session 回滚服务，复用现有 session repository / write executor。

职责：

- 根据 `rollback.json` 找到参与 tick 的 actor session。
- 检查相关 session 是否 idle；如果 running / waiting，拒绝回滚并提示先 abort。
- 对每个 session 执行 `moveLeaf(preLeafId)`。
- 发布 session events，让前端通过 `activePathRevision` 触发 active path snapshot rebuild。
- 不裁剪 JSONL，不重写历史，不删除 session entry。

如果第一版 CLI 还没有统一 live state provider，可以先实现 repository-level moveLeaf 并在报告里注明事件发布待接入；进入产品入口前必须接入 `SessionWriteExecutor`。

### 4. CLI Shape

初步 CLI 草图：

```bash
workspace node simulation rollback init --project ming-ding-zhi-shi
workspace node simulation rollback checkpoint --project ming-ding-zhi-shi --tick 000005 --phase pre
workspace node simulation rollback record-session --project ming-ding-zhi-shi --tick 000005 --subject erina --session 123 --pre-leaf <id> --post-leaf <id>
workspace node simulation rollback restore --project ming-ding-zhi-shi --tick 000005 --phase pre
```

后续可提供更顺手的 tick 命令别名：

```bash
workspace node simulation tick checkpoint --project ming-ding-zhi-shi --tick 000005
workspace node simulation tick rollback --project ming-ding-zhi-shi --tick 000005
```

### 5. Simulator Integration

第一阶段可以先提供手动 CLI，由 `simulator.leader` 在运行协议中显式调用。

后续自动化边界：

1. tick 开始前，`simulator.leader` 创建 `pre` checkpoint。
2. 调用每个 `simulator.actor` 前，记录 actor session 当前 leaf。
3. actor 返回并经过 `actor.memory-save` 后，记录 actor session post leaf。
4. tick 完成后写入 rollback metadata 和 tick report。
5. 用户要求 reroll / rollback 时，调用 restore。

这里不要求 `simulator.actor` 感知 checkpoint。actor 仍只关心 subject-facing packet 和自己的 sidecar memory save。

## Verification / Test

第一版建议的验证面：

- 单元测试：internal git store 只 checkpoint / restore `simulation/`，不会修改 `lorebook/`、`manuscript/`、`agent-context/`。
- 单元测试：rollback metadata 能记录多个 subject 的 actor session leaf。
- Harness 级测试：构造一个 actor session，追加几条消息后执行 rollback，确认 active leaf 移到 `preLeafId`，旧 entry 仍存在。
- Harness 级测试：session running / waiting 时 rollback 被拒绝。
- CLI 测试：在临时 Project Workspace 中写入 `simulation/subjects/foo/events.jsonl`，checkpoint 后修改，再 rollback，文件内容恢复。
- 回归检查：Plot SQLite 不被 checkout、不被修改。

## Walkthrough

- 2026-06-07：根据用户确认拆分两个 task。本 task 只记录回滚机制；RAG 先不写。初步实现范围收窄为 `simulation/` 文件、subject 文件和 `simulator.actor` session active leaf，Plot 明确不做回滚。
- 2026-06-08：同步 Subject RAG Memory hard cut 后的 subject 文件合同：回滚范围仍是整个 `simulation/`，但 subject memory 文件已从 `events.md` / `knowledge.md` 切到 `events.jsonl` / `memory.jsonl`，并新增初始化用 `memory-seed.md`。

## TODO / Follow-ups

- 确认 internal git store 的具体路径和 ref 命名是否采用 `.nbook/simulation-history.git` / `tick/{id}/pre`。
- 确认 `rollback.json` 是否放在 tick 目录，或改放 `.nbook/simulation-rollback/{tickId}.json` 以避免被文件 restore 覆盖。
- 确认 CLI 是挂在 `workspace node simulation rollback ...`，还是统一挂到 `workspace node simulation tick ...`。
- 设计 `simulator.leader` 自动 checkpoint 的调用点。
- 接入正式 session live-state 检查和 `SessionWriteExecutor` 事件发布。
- RAG 机制另建 task，不在本 task 展开。
