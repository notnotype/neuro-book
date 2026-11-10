/**
 * 宿主套件（`src/kit/`）几块共用的形状与常量，经 `@notnotype/nb-harness/kit/shapes` 交出。浏览器会加载它：只值导入 `typebox`，
 * 内核的类型只 `import type` 自 `kernel/contracts.js`（`kit/architecture.test.ts` 检查整条导入链）。
 */

/**
 * kit 按角色取模型时用的角色 id。宿主模型服务的角色表必须有这里的每个 id：没有时 kit 的摘要方法取不到模型，那次压缩以失败结束
 * （docs/specs/agent/compaction.md）。审批模型不在这里：它经模型端口的用途取，选哪个角色是宿主的事。
 */
export const MODEL_ROLES = {compaction: "compaction"} as const;
