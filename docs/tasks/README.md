# Task

`docs/tasks/` 用来记录重大任务的持续过程。它不是一次性流水账，而是功能级、任务级的长期上下文。

## 何时创建或更新

- 会改变代码行为、架构决策、模块状态、goal 模式的任务，需要更新任务 walkthrough。
- 同一功能后续调节继续更新同一个任务目录，例如拆书功能继续写入 `docs/tasks/07-book-splitting/README.md`。
- 用户创建一个重要的讨论，或者架构设计
- walkthrough 的 TODO / Follow-ups 只记本任务实现级跟进；跨任务或产品级跟进开 GitHub Issue（见 `AGENTS.md`「Git 工作流」）。

## 命名

- Active task 使用 `{order}-{name}` 目录名，例如 `01-config-system`、`02-book-splitting`。
- `order` 从 `01` 开始递增，不足两位补零（`01`–`09`），超过 99 后自然使用三位（`100` 起）；active task 按 README 首次加入 git 的时间正序编号，缺少 git 记录时使用目录 LastWriteTime。
- 新建任务目录前必须先 `ls docs/tasks/ | tail` 确认编号未被占用，不要凭记忆推断下一个编号（历史上已发生过 `08`、`96`、`120` 三次撞号）。
- `name` 使用英文 kebab-case。
- 每个任务目录至少包含 `README.md`。
- 并不一定强制都把任务塞到 README.md 里，还可以在任务目录类放其他和任务有关的文档等资料，例如 notes.md, references.md
- 每一轮的实现报告放 walkthroughs 这一节

## 归档

- `docs/tasks/archived/` 存放已归档 task，目录保留原 slug，不加 active 编号。

## goal 模式工作流程

如果你正在持续推进某个任务，则按照这个流程循环进行：

调研/计划 -> 编码/实现 -> 测试 -> 浏览器测试 -> 代码审查 <-> 修复（回到代码审查） -> 调研/计划 或者 结束任务

最后可以进行一次验收测试，从用户的角度，跑一个实际的例子，评估这个系统的好用程度，bug。然后继续优化

注意：实现的过程中如果堵塞，可以尝试稍微绕道，但是每次绕道都必须记录

## 同步要求

重大任务结束时同时更新：

- 根目录 `PROJECT-STATUS.md`
- 对应 active `docs/tasks/<order>-<task-slug>/README.md` 或 archived `docs/tasks/archived/<task-slug>/README.md`

## 任务模板

以下是任务模板可供参考

```docs/tasks/{order}-{name}/README.md

# <Task Title>

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

## User Request / Topic

-

## Goal

A good Goal is more than a larger prompt. It is a compact contract for how Codex should work, what counts as success, and what should happen if success is not yet reachable.

The strongest Goals usually define six things:
* Outcome: what should be true when the work is done.
* Verification surface: the test, benchmark, report, artifact, command output, or source material that proves it.
* Constraints: what must not regress while Codex works.
* Boundaries: which files, tools, data, repositories, or resources Codex may use.
* Iteration policy: how Codex should decide what to try next after each attempt.
* Blocked stop condition: when Codex should stop and report that no defensible path remains under the current limits.

A useful pattern is:

```text
/goal <desired end state> verified by <specific evidence> while preserving <constraints>. Use <allowed inputs, tools, or boundaries>. Between iterations, <how Codex should choose the next best action>. If blocked or no valid paths remain, <what Codex should report and what would unlock progress>.
```

For example, this Goal is workable but still fairly thin:

```text
/goal Reduce p95 checkout latency below 120 ms without regressing correctness tests
```

A stronger version gives Codex a fuller operating contract:

```text
/goal Reduce p95 checkout latency below 120 ms, verified by the checkout benchmark, while keeping the correctness suite green. Use only the checkout service, benchmark fixtures, and related tests. Between iterations, record what changed, what the benchmark showed, and the next best experiment to try. If the benchmark cannot run or no valid paths remain, stop with the attempted paths, the evidence gathered, the blocker, and the next input needed.
```

## Current State

-

## ADR / Decisions / Discussion

-


## Verification / Test

-

## Implementation Walkthrough

你能直接把 Walkthrough 记录在这一节。如果任务量较重。把实现计划放到同目录下的 walkthroughs/ 文件夹

-

## TODO / Follow-ups

-
```