/**
 * `@notnotype/nb-harness/kernel`：harness 的新内核（提案 docs/proposals/agent-harness-event-model.md，ADR 0035）。
 * 迁移 Task 把 nb-story 与 nb-agent-ui 改到这里之后删掉旧的 `createHarness`，本目录整体上移一层。
 */

export * from "./contracts.js";
export {createJsonlStore, type JsonlStoreOptions} from "./log/jsonl-store.js";
export {createMemoryStore} from "./log/memory-store.js";
export {systemClock} from "./session/clock.js";
export {closeSession, createSession, openSession} from "./session/session.js";
export {ompCall, ompModelInfo, type OmpTarget} from "./model/omp.js";
export {finalOnly, opening, reminder, standardLayout, withoutEvents} from "./helpers/index.js";
