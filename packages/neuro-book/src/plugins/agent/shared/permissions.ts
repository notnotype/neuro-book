/**
 * 权限规则的存储形状（docs/specs/agent/permissions.md）：设置与项目规则文件共用，求值在 `backend/permissions`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

/** 匹配器不进 schema：写错一个 `type` 不该让整份设置作废、把别的拒绝规则也带走。求值时算不出来，走“偏向收紧”。 */
export const RuleSchema = Type.Object({
    tool: Type.String({minLength: 1}),
    when: Type.Optional(Type.Unknown()),
    action: Type.Union([Type.Literal("allow"), Type.Literal("ask"), Type.Literal("deny")]),
    reason: Type.Optional(Type.String()),
}, {additionalProperties: false});
export const RulesSchema = Type.Array(RuleSchema);
export type Rule = Static<typeof RuleSchema>;
export type RuleAction = Rule["action"];
