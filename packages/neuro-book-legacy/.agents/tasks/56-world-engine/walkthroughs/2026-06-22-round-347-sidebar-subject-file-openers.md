# Round 347 - Sidebar Subject File Openers

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- 主体系统同步边界已经说清楚，但作者在左栏看到某个 `simulation/subjects` 主体时，还需要快速确认它的六文件内容。

## Finding

- 左栏 subject 卡片已显示主体系统状态、events/memory 计数、kind、controlledBy。
- 但卡片不能直接打开 `subject.md / events.jsonl / memory.jsonl / state.md`。
- 作者要确认待接入主体是谁、或写 slice 后检查六文件，需要绕回文件树。

## Implementation Walkthrough

- `WorldEngineWorkbenchPreviewSidebar.vue`
  - 新增 `subjectSystemFilePath()`，从 subject system summary 解析常见文件路径。
  - 新增 `openSubjectSystemFile()`，复用已有 `openWorkspacePath` 事件。
  - 把 subject 卡片外层从单个 `<button>` 改为普通容器，内部保留 subject 选择按钮，避免嵌套 button。
  - 在主体系统摘要下方增加 `subject / events / memory / state` 四个小按钮。

## Boundaries

- 只打开文件，不读取或写入六文件内容。
- 不改变主体系统同步行为。
- busy 时文件按钮禁用，保持 Workbench 上下文切换保护一致。

## Verification / Test

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-ide-entry.test.ts` 通过。
- `bun run typecheck` 未通过，但阻塞仍来自无关 `server/agent/tools/control-tools.test.ts` 测试类型漂移；未出现本轮 Sidebar / World Engine 新错误。

## Result

- 作者可以从左栏 subject 卡片直接打开主体系统常用文件，减少“看到了待接入主体但还要去文件树里找”的停顿。
