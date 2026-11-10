/**
 * 宿主套件（`src/kit/`）几块共用的形状与常量，经 `@notnotype/nb-harness/kit/shapes` 交出。浏览器会加载它：只值导入 `typebox`，
 * 内核的类型只 `import type` 自 `kernel/contracts.js`（`kit/architecture.test.ts` 检查整条导入链）。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

/**
 * 权限规则的存储形状（docs/specs/agent/permissions.md）：宿主的设置与项目规则文件共用，求值在 `approval/`。匹配器不进 schema：
 * 写错一个 `type` 不该让整份设置作废、把别的拒绝规则也带走；求值时算不出来，走“偏向收紧”。
 */
export const RuleSchema = Type.Object({
    tool: Type.String({minLength: 1}),
    when: Type.Optional(Type.Unknown()),
    action: Type.Union([Type.Literal("allow"), Type.Literal("ask"), Type.Literal("deny")]),
    reason: Type.Optional(Type.String()),
}, {additionalProperties: false});
export const RulesSchema = Type.Array(RuleSchema);
export type Rule = Static<typeof RuleSchema>;
export type RuleAction = Rule["action"];

/**
 * kit 按角色取模型时用的角色 id。宿主模型服务的角色表必须有这里的每个 id：没有时 kit 的摘要方法取不到模型，那次压缩以失败结束
 * （docs/specs/agent/compaction.md）。审批模型不在这里：它经模型端口的用途取，选哪个角色是宿主的事。
 */
export const MODEL_ROLES = {compaction: "compaction"} as const;

/** 工具交给审批规则看的东西：路径、命令、别的（docs/specs/agent/permissions.md）。路径可以写单数地址，判定时展开。 */
export type ToolSubject =
    | {readonly kind: "command"; readonly dialect: string; readonly text: string}
    | {readonly kind: "path"; readonly access: "read" | "write"; readonly address: string}
    | {readonly kind: string; readonly value: string};

/** 审批预览（docs/specs/agent/builtin-tools.md 输出 26）：按文件分组，算出了改前改后、太大不算，或算不出来。 */
export type FilePreview = {readonly files: ReadonlyArray<{readonly address: string; readonly kind: "diff"; readonly before: string; readonly after: string} | {readonly address: string; readonly kind: "too-large"; readonly bytes: number} | {readonly address: string; readonly kind: "failed"; readonly code: string}>};
