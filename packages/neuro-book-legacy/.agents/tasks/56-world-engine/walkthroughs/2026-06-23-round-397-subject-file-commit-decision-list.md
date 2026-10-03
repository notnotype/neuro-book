# Round 397 - Subject File Commit Decision List

## Summary

本轮不写运行时代码，专门审查 P1：是否要把 World Engine 的 `Subject file proposals` 从“复制建议”推进到“显式 commit / 追加六文件”。

结论先行：P0 suggestion surface 已经够作者手动落地，但 P1 不是“把复制按钮改成写文件”。它会触及六文件权威语义、去重、memory 合并、state.md patch、RAG dirty 状态和可恢复性。建议先做一个最小垂直切片：**只对单个 proposal 的 `events.jsonl` 做显式追加 commit**，其它目标继续保持 copy/review。

## Current Evidence

当前实现：

- `buildWorldWorkbenchSubjectFileProposals()` 只生成建议，不写文件。
- 每个 proposal 包含：
  - `eventJsonLine`：`{"text":"...","time":"..."}`
  - `memoryJsonLines`：按 `memory.* / relationship.*` mutation 生成候选行。
  - `stateReviewReasons`：按 attr root 提示检查 `state.md` 区块。
  - `sliceId / sliceTime / sliceTitle / sliceKind / sourceLabel`：用于人工审查。
- Inspector 支持：
  - 复制全部 / 复制建议。
  - 精确复制 `events.jsonl` 行。
  - 精确复制 `memory.jsonl` 候选行。
  - 复制 `state.md` 审查提示。
  - 复制并打开目标文件。

六文件契约：

- `events.jsonl`：append-only episodic memory，记录“我经历了什么 / 我当时怎么想”。
- `memory.jsonl`：editable stable memory，按 `topic` 表示当前认知，可能追加或改写。
- `state.md`：当前可见状态，Markdown 自由文本 / 表格，需要按区块人工维护。

真实 `ming-ding-zhi-shi-2` 现状：

- `simulation/subjects/player/events.jsonl` 已有多条历史经历，格式与 proposal 候选兼容。
- `memory.jsonl` 已出现 topic 语义错误风险：例如 `topic:"哑火"` 的 view 内容实际在描述眼镜女生，说明自动追加 memory 很容易积累坏 topic。
- `state.md` 是人工整理的 Markdown 区块，不能安全地只靠 attr 名做机械 patch。

## Decisions Needed

### 1. Commit 的最小单位是什么？

选项：

- A. 单个 proposal 单个目标文件。
- B. 单个 proposal 全部文件。
- C. 当前 slice 全部 proposals。

建议：先选 A。

理由：作者最常用、最安全的第一步是把一个角色的一条经历追加到 `events.jsonl`。`memory.jsonl` 和 `state.md` 都需要更强审查；多主体批量 commit 更容易把错误口吻或错误 topic 扩散。

### 2. events.jsonl 是否需要来源锚点？

当前行只有：

```json
{"text":"...","time":"..."}
```

P1 commit 需要防止重复点击追加同一条经历。可选方案：

- A. 保持现有格式，只用 `time + text` 去重。
- B. 扩展可选字段，例如 `sourceSliceId` / `sourceKind`。
- C. 不改 JSONL 行，把 commit 记录存在 Project SQLite / `.nbook` sidecar。

建议：先选 A，后续再评估 C。

理由：`events.jsonl` 当前契约和真实数据都很轻；贸然扩展字段可能影响下游 RAG 或提示词预期。第一版可以用 `time + text` 做保守去重，重复时提示“已存在相同经历”。如果后续需要审计 / 撤销，再设计 sidecar commit log。

需要用户决策：是否允许 `events.jsonl` 行扩展可选 provenance 字段。

### 3. memory.jsonl 是追加还是改写？

六文件契约明确 `memory.jsonl` 是当前认知快照，不是纯历史日志；同 topic 应该经常改写。

风险：

- proposal 的 `memoryProposalTopic()` 现在由 attr path 或 slice title 推断，可能不准。
- 真实数据里已经能看到 topic / view 偏移的例子。
- 直接追加会让同一 topic 多版本并存，RAG 可能检索到过期认知。

建议：P1 第一版不自动 commit memory。

后续若做，应先设计 `topic` 冲突 UI：

- topic 不存在：可追加。
- topic 已存在：显示旧 view / 新 view diff，作者选择替换、追加为新 topic、或取消。
- topic 为空或由 slice title 推断：必须人工编辑 topic 后才能 commit。

需要用户决策：memory 是否进入 P1，还是等 events commit 稳定后再做。

### 4. state.md 能否自动 patch？

当前 proposal 只生成 `stateReviewReasons`，例如“检查 state.md「当前位置」...”。这不是可直接写入的 patch。

风险：

- `state.md` 是 Markdown 区块和表格混合，不同 subject 文件结构可能不同。
- attr 到区块的映射只是启发式。
- 直接替换区块会覆盖人工写法和叙事细节。

建议：P1 第一版不自动 patch `state.md`。

后续如果做，先从“打开 state.md + 高亮/定位区块 + 复制审查提示”升级，不直接写文件。真正 patch 需要结构化 state 文件或专门 parser。

需要用户决策：是否接受 `state.md` 在 P1 仍只做审查提示。

### 5. commit 后如何反馈和避免重复？

最小 P1 events commit 应有：

- 二次确认：明确目标 path、slice title、subject、将追加的 JSONL 行。
- 成功反馈：显示“已追加到 events.jsonl”。
- 重复检测：若目标文件已有相同 `time + text`，不追加，提示已存在。
- 文件打开入口：commit 后保留“打开 events.jsonl”。

不建议第一版做复杂撤销。`events.jsonl` append 是普通文件写入；撤销需要记录行号 / 原文件 hash / 并发冲突策略。

### 6. 写文件后是否触发 RAG dirty / reindex？

真实主体摘要里存在 `events:dirty / memory:dirty` 状态。P1 commit 如果写 `events.jsonl`，至少应保证后续 RAG 状态能发现文件变更。

待确认：

- 当前 RAG overview 的 dirty 判断是否基于文件 mtime / hash。
- 是否已有统一 API 写 Project Workspace 文件并触发索引状态刷新。

建议：第一版只写 Project Workspace 文件，不主动 rebuild RAG；写完后刷新 RAG overview / Workbench subject summary，若显示 dirty，提示作者后续由现有 RAG 流程处理。

需要用户决策：commit events 后是否要自动触发 RAG reindex。我的建议是不自动，避免一次写世界切片顺手启动重任务。

### 7. commit 入口放在哪里？

建议入口：

- `events.jsonl draft` 区新增 `追加到 events.jsonl`。
- 只在单个 proposal 内显示。
- 与现有 `复制行`、`复制并打开` 并列。
- 按钮需要应用内 Dialog 确认，不用原生 `window.confirm`。

不建议：

- 顶部“一键提交全部”。
- timeline card 上直接提交。
- 保存 slice 后自动提交。

### 8. API 应该怎么走？

候选：

- A. 前端复用现有 Project Workspace 文件打开 / 编辑能力，直接写文件。
- B. 新增专用 HTTP API：`POST /api/projects/world-engine/subject-file-proposals/events/commit`。
- C. Agent tool commit。

建议：优先 B。

理由：commit 需要读文件、去重、追加、返回状态，并且后续可能刷新 RAG overview。把逻辑放专用 API 比前端直接拼文件更稳，也能测试最常见的去重和追加行为。

建议 DTO 草案：

```ts
type CommitSubjectEventProposalBody = {
    projectPath: string;
    subjectId: string;
    eventsPath: string;
    sliceId: string;
    line: {
        text: string;
        time: string;
    };
};

type CommitSubjectEventProposalResult = {
    status: "appended" | "already-exists";
    path: string;
    line: string;
};
```

注意：`eventsPath` 必须校验在当前 Project Workspace 内，并且应匹配 `simulation/subjects/{subjectId}/events.jsonl`，避免任意文件追加。

## Recommended Next Slice

我建议下一轮实现前先请用户确认以下决策：

1. P1 第一版是否只做 `events.jsonl` 单条显式追加 commit？
2. `events.jsonl` 是否保持 `{text,time}`，先用 `time + text` 去重？
3. `memory.jsonl` 和 `state.md` 是否暂不自动写，只保留 copy / review？
4. commit 后是否不自动 RAG reindex，只刷新状态并提示 dirty？

如果以上都同意，最小实现计划：

1. 新增后端 API：校验 Project path、subject id、events path，读取 JSONL，按 `time + text` 去重，追加一行。
2. Inspector 的 `events.jsonl draft` 增加 `追加` 按钮，应用内 Dialog 展示目标 path 和 JSONL 行。
3. 成功后刷新 RAG overview / Workbench subject summaries，显示 appended / already-exists notice。
4. 只补最小测试：API 追加、重复不追加、非法 path 拒绝；前端静态契约覆盖按钮和确认。
5. 浏览器验收只跑 `ming-ding-zhi-shi-2` 单条 proposal 的取消分支和 already-exists 分支；真实追加分支需用户明确允许写六文件。

## Non-goals

- 不自动写 `memory.jsonl`。
- 不自动 patch `state.md`。
- 不批量提交全部 proposals。
- 不做撤销 / 回收站。
- 不自动 RAG rebuild。
- 不改变 World Engine slice 数据。
