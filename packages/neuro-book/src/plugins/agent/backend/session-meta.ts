/**
 * 会话标题与说明在 NeuroBook 一侧的接线（docs/specs/agent/builtin-profiles.md 输出 6–13）：扩展 id 与标签、标题 Profile、给标题
 * 模型的材料怎么写。生成本身在宿主套件（`@notnotype/nb-harness/kit/sessions` 的 `SessionMeta`）。
 */

import type {ContributionDeclaration} from "@notnotype/nb-runtime/plugins";

import type {SessionMetaOptions} from "@notnotype/nb-harness/kit/sessions";

import {EXTENSIONS_POINT} from "../shared/points";
import type {AgentExtensionDeclaration} from "../shared/points";

import {SESSION_META_TAG} from "./builtin/profiles/session-title";

export const SESSION_META_EXTENSION = "nbook.agent.session-meta";
export const SESSION_META_CONTRIBUTION: ContributionDeclaration<AgentExtensionDeclaration> = {capability: EXTENSIONS_POINT, id: SESSION_META_EXTENSION, declaration: {tags: [SESSION_META_TAG]}};

/** 给标题模型的那条消息：第一轮的对话，或压缩后的摘要（标题照旧也要交）。 */
export const SESSION_META_MATERIAL: SessionMetaOptions["material"] = {
    turn: (input, reply) => `<conversation>\n用户：${input}\n\n助手：${reply}\n</conversation>`,
    compaction: (title, summary) => `这段对话已经写过摘要，请按摘要写说明（标题照旧也要交）。当前标题：${title ?? "（没有）"}\n\n<conversation>\n${summary}\n</conversation>`,
};
