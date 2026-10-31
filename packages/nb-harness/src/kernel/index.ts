/**
 * `@notnotype/nb-harness/kernel`：harness 的新内核（提案 docs/proposals/agent-harness-event-model.md，ADR 0035）。
 * 迁移 Task 把 nb-story 与 nb-agent-ui 改到这里之后删掉旧的 `createHarness`，本目录整体上移一层。
 */

export * from "./contracts.js";
