---
schema: nbook.task/v2
taskId: t04-profile-memory-init-and-permissions
status: planned
updated: 2026-11-17
---

# Profile 记忆目录初始化机制与修改默认放行

## 目标与范围

解决星璃等角色型 Profile 在使用 `profile://memory/` 自维护记忆时的两项基础设施问题：

1. **`profile://memory/` 文件夹的初始化机制**：
   - **现状**：[`packages/neuro-book/src/plugins/agent/backend/schemes.ts`](../../../../../packages/neuro-book/src/plugins/agent/backend/schemes.ts) 中 `profiles` 方案的 `mount(name)` 仅返回 `{create: true}`，初次挂载时只在 `<stateRoot>/agent/profiles/<profileKey>/` 创建空目录；当前实验需手动将 `.local/system_prompt/lyra/memory/` 拷入 `.dev-state/agent/profiles/user.lyra*/memory/`。
   - **待设计与实现**：支持 Profile（内置 Profile 或 `user://profiles/` 用户 Profile）声明初始记忆种子文件或初始化钩子，在首次创建/挂载该 Profile 的存储目录且目标文件不存在时，幂等地写入初始 `memory/INDEX.md`、`memory/master.md` 及设定手记（不覆盖用户后续演进的记忆），并提供重置/恢复初始记忆的清晰方式。
2. **`profile://memory/` 修改默认放行**：
   - **现状**：[`packages/neuro-book/src/plugins/agent/backend/resources.ts`](../../../../../packages/neuro-book/src/plugins/agent/backend/resources.ts) 的 `sessionLayout` 仅将 `scratch: ["session://", "tmp://"]` 列为免审草稿区，而 `profiles://<currentProfile>` 仅在 `classify` 中标为 `write: "allowed"`。在默认 `ask` 审批模式下，Agent 每次调用 `write` 或 `edit-replace` 更新 `profile://memory/master.md` 都会触发人工审批确认框，打断对话沉浸感。
   - **待设计与实现**：将当前会话所属 Profile 对自身 `profile://memory/`（或整个自身 `profile://`）的写入纳入默认免审放行范围（如归入 `sessionLayout.scratch` 或默认 `allow` 策略），使角色自主维护记忆无需每次弹窗询问用户。

合同：涉及 `docs/specs/agent/resources.md`、`docs/specs/agent/permissions.md`、`docs/specs/agent/contributions.md` 及对应后端实现。

## 当前状态

2026-11-17 经 nbdev 新建（`planned`），已记录现状代码位置与设计要点，待排期实现。

## 下一步

- 确定 Profile 初始文件种子的声明接口（静态目录映射 vs. `mount` 初始化回调）与 `profile://` 默认放行边界，更新 Spec 后实现。
