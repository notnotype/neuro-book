/**
 * 这一轮带上 Skill（docs/specs/agent/skills.md 输出 9–15）：用户的话、插话、父 Agent 发来的话里有 `$` 标签时，认出 Skill、
 * 现读 `SKILL.md`，写对话事件 `skill`；认不出的写 `skillMissing`，模型看到一条 system-reminder，界面不另外标出。
 *
 * 位置由内核盖章（harness/runtime.md 的位置章）：`input` 引出的写在这一轮的附带内容里、排在用户的话前面，`steer` 引出的排在
 * 那句插话后面。“上一份还在上下文里”记在随压缩清空的 path 片里：回退、切分支跟着走，压缩之后再 `$` 会重新附全文。
 */

import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";

import {conv, defineExtension, slice} from "@notnotype/nb-harness/kernel";
import type {AnyExtension} from "@notnotype/nb-harness/kernel/contracts";
import {promptSkillTokens} from "@notnotype/nb-markdown/prompt-text";

import type {SkillMissingReason} from "../../shared/skills";
import type {SkillCatalog} from "./catalog";
import {SKILL_FILE, splitSkillFile} from "./package";

export const SKILLS_EXTENSION = "nbook.agent.skills";

/** 一个 Skill 的正文至多带这么多 token，超出截断并写明全文地址（skills.md 输出 9）。 */
export const SKILL_BODY_TOKENS = 20_000;
/** 与内核估算 token 的口径相同（`estimateTokens`：UTF-8 字节数除以 3）。 */
const BYTES_PER_TOKEN = 3;

export interface SkillEventData {
    readonly id: string;
    readonly name: string;
    readonly location: string;
    /** 没有正文的是“见前文”（`sameAs`）。 */
    readonly body?: string;
    readonly truncated?: boolean;
    readonly sameAs?: true;
}

export interface SkillMissingData {
    readonly token: string;
    readonly reason: SkillMissingReason;
}

const hashOf = (text: string): string => createHash("sha256").update(text).digest("hex");

/** 按 token 预算截断：在预算内最后一个换行处断开，一行就超出时按字符断。 */
export function truncateTokens(text: string, tokens: number): {readonly text: string; readonly truncated: boolean} {
    const limit = tokens * BYTES_PER_TOKEN;
    const encoder = new TextEncoder();
    if (encoder.encode(text).length <= limit) return {text, truncated: false};
    let bytes = 0;
    let end = 0;
    for (const char of text) {
        bytes += encoder.encode(char).length;
        if (bytes > limit) break;
        end += char.length;
    }
    const newline = text.lastIndexOf("\n", end);
    return {text: text.slice(0, newline > 0 ? newline : end), truncated: true};
}

/** 模型看到的样子（skills.md 输出 11、14）。 */
export function renderSkill(data: SkillEventData): string {
    const open = `<skill id="${data.id}" name="${data.name}" location="${data.location}">`;
    if (data.sameAs === true || data.body === undefined) return `${open}\nSkill「${data.name}」见前文。\n</skill>`;
    const notes = [
        `这个 Skill 的文件在 skills://${data.id}/，shell 里可以直接写这个地址；脚本里的相对路径按 Skill 目录算，shell 的工作目录不是 Skill 目录。`,
        ...(data.truncated === true ? [`正文太长，上面只是前一部分，全文在 ${data.location}。`] : []),
    ];
    return `${open}\n${data.body.trim()}\n</skill>\n${notes.join("\n")}`;
}

const MISSING_TEXT: Readonly<Record<SkillMissingReason, string>> = {
    "not-found": "没有这个 Skill",
    "not-allowed": "它不在当前 Profile 能用的 Skill 里",
    "ambiguous": "有不止一个同名的 Skill，要用 ${id} 的写法指定其中一个",
    "invalid": "这个 Skill 无效（SKILL.md 不合规）",
    "unreadable": "读不出它的 SKILL.md",
};

/** 没带上的 `$` 给模型看的样子（skills.md 输出 12）。 */
export function renderMissing(data: SkillMissingData): string {
    return `<system-reminder>\n用户写的 $${data.token} 没有作为 Skill 带上：${MISSING_TEXT[data.reason]}。\n</system-reminder>`;
}

export interface SkillsExtensionOptions {
    readonly catalog: Pick<SkillCatalog, "resolveToken">;
    /** 这个 Profile 的 Skill 白名单（合成之后）。 */
    readonly allowed: (profile: string) => ReadonlySet<string>;
}

export function skillsExtension(options: SkillsExtensionOptions): AnyExtension {
    return defineExtension({
        id: SKILLS_EXTENSION,
        // id → 已附的正文的哈希。压缩之后正文不在上下文里了，回到初值。
        state: {attached: slice.path<Readonly<Record<string, string>>>({}, {resetOnCompaction: true})},
        events: {
            skill: conv<SkillEventData>(),
            skillMissing: conv<SkillMissingData>(),
        },
        reduce: {
            skill: (event, {attached}) => (event.data.body === undefined ? undefined : {attached: {...attached, [event.data.id]: hashOf(event.data.body)}}),
        },
        render: {
            skill: (event) => renderSkill(event.data),
            skillMissing: (event) => renderMissing(event.data),
        },
        on: {
            input: async (event, ctx) => {
                for (const output of await collect(event.data.text, ctx.session.profile, ctx.state.attached, ctx.signal)) emitOutput(ctx, output);
            },
            steer: async (event, ctx) => {
                for (const output of await collect(event.data.text, ctx.session.profile, ctx.state.attached, ctx.signal)) emitOutput(ctx, output);
            },
        },
    });

    /** 一句话引出的输出，按标签出现的顺序。 */
    async function collect(text: string, profile: string, attached: Readonly<Record<string, string>>, signal: AbortSignal): Promise<SkillOutput[]> {
        const tokens = [...new Set(promptSkillTokens(text))];
        if (tokens.length === 0) return [];
        const allowed = options.allowed(profile);
        const outputs: SkillOutput[] = [];
        const seen = new Set<string>();
        for (const token of tokens) {
            const resolved = options.catalog.resolveToken(token, allowed);
            if (!resolved.ok) {
                outputs.push({name: "skillMissing", data: {token, reason: resolved.reason}});
                continue;
            }
            const {entry, directory} = resolved.item;
            // `$review` 与 `${user.review}` 认到同一个 Skill 时只带一次。
            if (seen.has(entry.id)) continue;
            seen.add(entry.id);
            let body: string;
            try {
                body = splitSkillFile(await readFile(join(directory, SKILL_FILE), {encoding: "utf8", signal})).body;
            } catch (error) {
                if (signal.aborted) throw error;
                outputs.push({name: "skillMissing", data: {token, reason: "unreadable"}});
                continue;
            }
            const base = {id: entry.id, name: entry.name, location: entry.location};
            const shown = truncateTokens(body, SKILL_BODY_TOKENS);
            outputs.push(attached[entry.id] === hashOf(shown.text)
                ? {name: "skill", data: {...base, sameAs: true}}
                : {name: "skill", data: {...base, body: shown.text, truncated: shown.truncated}});
        }
        return outputs;
    }
}

type SkillOutput = {readonly name: "skill"; readonly data: SkillEventData} | {readonly name: "skillMissing"; readonly data: SkillMissingData};

function emitOutput(ctx: {emit(name: "skill", data: SkillEventData): void; emit(name: "skillMissing", data: SkillMissingData): void}, output: SkillOutput): void {
    if (output.name === "skill") ctx.emit("skill", output.data);
    else ctx.emit("skillMissing", output.data);
}
