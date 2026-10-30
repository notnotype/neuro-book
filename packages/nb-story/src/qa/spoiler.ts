/**
 * 问答过程里给人看的搜索词与对象名不剧透（docs/specs/story/qa.md 输出 12、viewer.md 输出 42）。
 *
 * 模型会凭自己读过这本书的记忆，用阅读位置之后才出现的人名、事件去搜索。回答守得住阅读位置，但过程（命令行的进度、网页的
 * 工具步骤与思考）把这些词原样显示给人，人在过程里就已经被剧透了。判据由程序给，不靠提示词要求模型自觉：一个词在阅读位置
 * 之前搜得到（`search`，对象、说法、原文都算），说明用户读到过，原样显示；搜不到就不显示原词。
 *
 * 只改给人看的那一份：会话日志与续问交回模型的内容不变（续问要原样的参数）；这里的所有函数都返回新值，不改入参。
 * 阅读位置已经在能到达的最后一段（没设位置的默认）时没有可剧透的内容，一律原样。
 */

import type {BookSession} from "../core/api";
import {searchTerms} from "../core/queries/search";
import type {JsonValue, SessionEntry} from "@notnotype/nb-session";
import type {Reach} from "./reach";
import type {QaAgentEvent} from "./web-events";

/** 整个值换成它：这个词在阅读位置之前没有结果。 */
export const HIDDEN_VALUE = "（阅读位置之前没有结果）";
/** 结果文字里回显了被隐藏的词时，那个词换成它。 */
const HIDDEN_WORD = "（…）";
/** 工具参数里会显示给人的词。`entity` 等也可能是对象编号，编号不是自然语言，原样显示。 */
const SUBJECT_KEYS = ["entity", "other", "query", "track", "perspective"] as const;
const ID_LIKE = /^(?:[a-z]\d+(?:-\d+)?|\d+(?:\.\d+)?)$/u;

type Loose = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Loose => typeof value === "object" && value !== null && !Array.isArray(value);

export interface Visibility {
    /** 工具参数：显示给人的词里有阅读位置之前搜不到的，整个值换成 `HIDDEN_VALUE`。`callId` 给了就记下被隐藏的词，供 `result` 用。 */
    args(args: Record<string, unknown>, callId?: string): Promise<Record<string, unknown>>;
    /** 一条模型消息（assistant）：工具调用的参数同 `args`，思考块去掉；其它消息原样。 */
    message<T>(message: T): Promise<T>;
    /** 工具结果文字里回显了这次调用被隐藏的词时，把词换掉。 */
    result(callId: string, text: string): string;
    /** 会话日志条目：assistant 消息同 `message`，工具结果同 `result`。要按日志的先后顺序逐条传，工具结果依赖前面记下的词。 */
    entry(entry: SessionEntry): Promise<SessionEntry>;
    /** 推给网页的运行事件。 */
    event(event: QaAgentEvent): Promise<QaAgentEvent>;
}

/** 阅读位置之前能不能搜到每个词的判断；`reach` 是这一问能到达的范围。 */
export function createVisibility(book: Pick<BookSession, "call">, reach: Reach): Visibility {
    const last = reach.paragraphs.length;
    const bounded = reach.at.chapter < last || reach.at.paragraph < (reach.paragraphs[last - 1] ?? 0);
    // 查询失败（位置不在图里等）按搜不到算：宁可多隐藏。
    const seen = new Map<string, Promise<boolean>>();
    const visible = (token: string): Promise<boolean> => {
        let known = seen.get(token);
        if (known === undefined) {
            known = book.call("search", {query: token, at: reach.graphAt, limit: 1}).then(outcome => outcome.ok && outcome.value.items.length > 0);
            seen.set(token, known);
        }
        return known;
    };
    /** 一个值里搜不到的词；都搜得到（或没有可搜的词）返回空。 */
    async function hiddenTokens(value: string): Promise<string[]> {
        const tokens = searchTerms(value).filter(token => !ID_LIKE.test(token));
        const checks = await Promise.all(tokens.map(visible));
        return tokens.filter((_, index) => !checks[index]);
    }

    const hiddenByCall = new Map<string, string[]>();

    async function args(input: Record<string, unknown>, callId?: string): Promise<Record<string, unknown>> {
        if (!bounded) return input;
        const output: Record<string, unknown> = {...input};
        const hidden: string[] = [];
        for (const key of SUBJECT_KEYS) {
            const value = input[key];
            if (typeof value !== "string") continue;
            const tokens = await hiddenTokens(value);
            if (tokens.length === 0) continue;
            output[key] = HIDDEN_VALUE;
            hidden.push(...tokens);
        }
        if (callId !== undefined && hidden.length > 0) hiddenByCall.set(callId, [...(hiddenByCall.get(callId) ?? []), ...hidden]);
        return output;
    }

    async function messageOf<T>(input: T): Promise<T> {
        if (!bounded || !isRecord(input) || input.role !== "assistant" || !Array.isArray(input.content)) return input;
        const content: unknown[] = [];
        for (const block of input.content) {
            if (isRecord(block) && block.type === "thinking") continue;
            if (isRecord(block) && block.type === "toolCall" && isRecord(block.arguments)) {
                const callId = typeof block.id === "string" ? block.id : undefined;
                // 流式的半截调用还带着一份原始的参数文字（`partialArgs`），换不掉就不带：只留视图用得到的几项。
                content.push({type: block.type, id: block.id, name: block.name, arguments: await args({...block.arguments}, callId)});
                continue;
            }
            content.push(block);
        }
        return {...input, content} as T;
    }

    function result(callId: string, text: string): string {
        const hidden = hiddenByCall.get(callId);
        return hidden === undefined ? text : hidden.reduce((shown, token) => shown.split(token).join(HIDDEN_WORD), text);
    }

    function scrubContent(callId: string, content: unknown): unknown {
        if (!Array.isArray(content)) return content;
        return content.map(block => (isRecord(block) && typeof block.text === "string" ? {...block, text: result(callId, block.text)} : block));
    }

    async function entry(input: SessionEntry): Promise<SessionEntry> {
        if (!bounded || input.kind !== "agent_message" || !isRecord(input.message)) return input;
        const message = input.message as Loose;
        if (message.role === "assistant") return {...input, message: (await messageOf(message)) as JsonValue} as SessionEntry;
        if (message.role === "toolResult" && typeof message.toolCallId === "string") {
            return {...input, message: {...message, content: scrubContent(message.toolCallId, message.content)} as unknown as JsonValue} as SessionEntry;
        }
        return input;
    }
    async function event(input: QaAgentEvent): Promise<QaAgentEvent> {
        if (!bounded) return input;
        if (input.type === "message_start" || input.type === "message_update") return {...input, message: await messageOf(input.message)};
        if (input.type === "tool_execution_end") return {...input, result: {content: scrubContent(input.toolCallId, input.result.content) as typeof input.result.content}};
        return input;
    }

    return {args, message: messageOf, result, entry, event};
}
