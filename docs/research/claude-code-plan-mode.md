# Claude Code Plan Mode 机制分析

基于 `claude-code-analysis` 仓库逆向分析。

## 概述

Plan Mode 是 Claude Code 的一种受限运行模式。进入后模型**只能只读操作**，唯一可编辑的是 plan file。退出时需要用户审批 plan 后才能恢复完整能力。

---

## 源码位置


| 文件                                        | 作用                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/utils/messages.ts`                     | Plan Mode 指令文本（5 阶段 / interview / sparse / subagent / re-entry / exit）                      |
| `src/utils/attachments.ts`                  | Plan Mode attachment 注入逻辑（收集、节流、full/sparse 循环、exit/re-entry 检测）                   |
| `src/utils/plans.ts`                        | Plan file 路径生成（slug、目录、路径、resume 时恢复）                                               |
| `src/utils/planModeV2.ts`                   | Feature flag 控制（agent 数量、interview phase、pewter ledger 实验）                                |
| `src/tools/EnterPlanModeTool/`              | EnterPlanMode 工具定义                                                                              |
| `src/tools/ExitPlanModeTool/`               | ExitPlanMode 工具定义                                                                               |
| `src/tools/AgentTool/built-in/planAgent.ts` | 内置 Plan agent 的 system prompt                                                                    |
| `src/commands/plan/`                        | `/plan` CLI 命令                                                                                    |
| `src/bootstrap/state.ts`                    | 全局状态（planSlugCache、hasExitedPlanMode、needsPlanModeExitAttachment、handlePlanModeTransition） |

---

## 进入 Plan Mode 的三种方式


| 方式                                      | 入口                                               |
| ----------------------------------------- | -------------------------------------------------- |
| 模型调用`EnterPlanMode` 工具              | `src/tools/EnterPlanModeTool/EnterPlanModeTool.ts` |
| 用户输入`/plan` 命令                      | `src/commands/plan/plan.tsx`                       |
| 系统自动注入 attachment（维持已进入状态） | `src/utils/attachments.ts`                         |

---

## system-reminder 注入内容

### 注入频率

由 `TURNS_BETWEEN_ATTACHMENTS = 5` 和 `FULL_REMINDER_EVERY_N_ATTACHMENTS = 5` 控制。


| Turn              | 注入内容                   |
| ----------------- | -------------------------- |
| 进入 Plan Mode 时 | **完整版**（~2000 tokens） |
| Turn 5            | 精简版（~100 tokens）      |
| Turn 10           | 精简版                     |
| Turn 15           | 精简版                     |
| Turn 20           | 精简版                     |
| Turn 25           | **完整版**                 |
| ...               | 以此类推                   |

退出后的 re-entry 会重置计数器。

### 四种变体


| 变体        | 函数                                  | 行号              | 出现时机                                   |
| ----------- | ------------------------------------- | ----------------- | ------------------------------------------ |
| 完整 5 阶段 | `getPlanModeV2Instructions()`         | messages.ts ~3207 | 首次进入 / 每 25 turn                      |
| 精简提醒    | `getPlanModeV2SparseInstructions()`   | messages.ts ~3385 | 后续 turn（每 5 turn）                     |
| 迭代访谈    | `getPlanModeInterviewInstructions()`  | messages.ts ~3323 | 由`isPlanModeInterviewPhaseEnabled()` 控制 |
| 子 Agent    | `getPlanModeV2SubAgentInstructions()` | messages.ts ~3399 | 子 agent 上下文                            |

### 精简版全文

```
Plan mode still active (see full instructions earlier in conversation).
Read-only except plan file ({path}).
Follow 5-phase workflow.
End turns with AskUserQuestion (for clarifications) or ExitPlanMode (for plan approval).
Never ask about plan approval via text or AskUserQuestion.
```

---

## Plan Mode 生命周期

```
默认模式 ──EnterPlanMode──→ Plan Mode
                              ├─ 首次注入: plan_mode (full)
                              │  每 5 turn: plan_mode (sparse)
                              │  每 25 turn: plan_mode (full)
                              │
                              └─ ExitPlanMode ──→ 默认模式
                                                    └─ plan_mode_exit (一次性)

                              ── 再次 EnterPlanMode ──→ Plan Mode
                                                         ├─ plan_mode_reentry (一次性)
                                                         └─ plan_mode (full, 计数器从 exit 重置)
```

### 退出时注入

一次性，由 `needsPlanModeExitAttachment` flag 控制：

```
## Exited Plan Mode

You have exited plan mode. You can now make edits, run tools, and take actions.
```

### Re-entry 时注入

一次性，由 `hasExitedPlanMode` flag 控制。先注入 re-entry 提醒，再注入完整 instructions。re-entry 提醒会建议模型先读旧 plan file、评估是否相关，再决定覆盖还是继续编辑。

---

## 5 阶段工作流

**注意**：5 阶段工作流只是提示词中的文本指南，并非程序化状态机。没有任何代码强制 Agent 处于"Phase 2"或"Phase 3"。真正的硬约束只有：
- `permissionContext.mode === 'plan'` 限制了工具权限（只读 + 仅写 plan file）
- turn 结束时只能 `AskUserQuestion` 或 `ExitPlanMode`

### Phase 1: Initial Understanding

- 只读探索代码库
- 启动 Explore agent（最多 3 个并行）
- 复用已有实现，避免重新发明

### Phase 2: Design

- 启动 Plan agent 设计方案
- 提供 Phase 1 的上下文和文件路径
- 默认至少 1 个 Plan agent

### Phase 3: Review

- 读关键文件确认 Plan agent 的建议
- 用 `AskUserQuestion` 跟用户确认模糊点

### Phase 4: Final Plan

- 写 plan file（唯一可编辑的文件）
- 结构：Context → Approach → Files → Verification
- 4 种实验变体（control / trim / cut / cap），由 `tengu_pewter_ledger` feature flag 控制

### Phase 5: ExitPlanMode

- turn 必须以 `AskUserQuestion` 或 `ExitPlanMode` 结束
- 不允许用文字或 AskUserQuestion 问 "plan 可以吗"

---

## 执行阶段：Agent 如何知道当前计划

退出 Plan Mode 后，Agent **不会自动知道**计划内容。依赖两个来源：

| 来源 | 时机 | 持久性 |
|---|---|---|
| `ExitPlanMode` 的 `tool_result` 返回 `Approved Plan` 全文 | 退出 plan mode 时 | 在消息历史中，可能被 compaction 清除 |
| plan file 磁盘文件 | 退出时写入 | 持久存在 |

如消息历史被 compaction 清除，Agent 需要自己 `Read` plan file 来恢复上下文。

### Verify Plan Reminder

**源码**：`src/utils/attachments.ts` ~983
**频率**：每 10 turn

实施阶段提醒 Agent 对照 plan 检查进度，但不会注入 plan 全文。

---

## EnterPlanMode / ExitPlanMode 交互时序

```
Agent 调用 EnterPlanMode
  → 弹确认框给用户
    → 用户同意
      → call() 切 mode 为 'plan'
        → tool_result 返回指引文本
          → system-reminder: plan_mode (full) 注入
            → 提示词约束：只读 + 仅写 plan file

Agent 调用 ExitPlanMode
  → 弹确认框给用户
    → 用户同意
      → call() 读 plan file
        → 切 mode 回 prePlanMode（通常是 'default'）
          → setHasExitedPlanMode(true)
          → setNeedsPlanModeExitAttachment(true)
            → system-reminder: plan_mode_exit（一次性）
              → tool_result: Approved Plan + plan 全文
```

---

## 外部版 vs 内部版

`getEnterPlanModeToolPrompt()` 按用户类型分叉：

```ts
return process.env.USER_TYPE === 'ant'
  ? getEnterPlanModeToolPromptAnt()    // Anthropic 内部
  : getEnterPlanModeToolPromptExternal() // 公开版
```

| | 外部版 | 内部版 (Ant) |
|---|---|---|
| 态度 | **鼓励**用 EnterPlanMode | **劝退** EnterPlanMode |
| 触发条件 | 7 种（包括多文件改动、用户偏好不明） | 3 种（仅重大架构歧义、需求不明、高风险重构） |
| 核心理念 | "when unsure, err on the side of planning" | "when in doubt, prefer starting work"

---

## Plan File 路径生成

`src/utils/plans.ts`：

- `getPlanSlug()` → 随机词组合（如 `swift-hugging-fern`），会话内缓存
- `getPlanFilePath()` → `~/.claude/plans/{slug}.md`
- 子 agent：`~/.claude/plans/{slug}-agent-{agentId}.md`
- 路径通过 attachment 传入 prompt

---

## 关键 Feature Flag


| Flag                      | 作用                                                                   |
| ------------------------- | ---------------------------------------------------------------------- |
| `tengu_chair_sermon`      | 控制`<system-reminder>` 标签包裹                                       |
| `tengu_pewter_ledger`     | 控制 Phase 4 plan file 结构实验（control/trim/cut/cap）                |
| Plan Mode Interview Phase | 切换为迭代访谈模式（Explore → 问用户 → 写计划 → 循环），替代 5 阶段 |
| Agent Count               | 控制 Phase 2 的 Plan agent 数量（标准用户 1，Max/Enterprise 3）        |
