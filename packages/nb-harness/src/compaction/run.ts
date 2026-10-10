/**
 * 按方法顺序尝试压缩并写入（docs/specs/harness/compaction.md 输出 2–5）。
 * 任何失败路径都不写入；成功只 append 一次，压缩条目与种子同一批。
 */

import type {EntryInput, SessionEntry} from "../session/session";
import type {Attempt, CompactInput, Compacted, CompactionMethod, CompactionOutput, CompactionResult, MethodInput, MethodResult} from "./types";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const CANCELLED: CompactionResult<never> = {ok: false, code: "cancelled", detail: "调用方已中止"};

/** 能被 JSON 如实表示：没有 undefined、函数、NaN、循环引用，对象只是普通对象。 */
function jsonProblem(value: unknown, path: string, seen = new Set<object>()): string | null {
    switch (typeof value) {
        case "string":
        case "boolean":
            return null;
        case "number":
            return Number.isFinite(value) ? null : `${path}：${String(value)} 不能用 JSON 表示`;
        case "object": {
            if (value === null) return null;
            if (seen.has(value)) return `${path}：循环引用`;
            seen.add(value);
            if (Array.isArray(value)) {
                for (let index = 0; index < value.length; index += 1) {
                    const problem = index in value ? jsonProblem(value[index], `${path}[${index}]`, seen) : `${path}[${index}]：数组有空洞`;
                    if (problem !== null) return problem;
                }
                return null;
            }
            const prototype = Object.getPrototypeOf(value) as object | null;
            if (prototype !== Object.prototype && prototype !== null) return `${path}：只允许普通对象`;
            for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
                const problem = jsonProblem(item, `${path}.${key}`, seen);
                if (problem !== null) return problem;
            }
            return null;
        }
        default:
            return `${path}：${typeof value} 不能用 JSON 表示`;
    }
}

/** 胜出方法的结果还要能写成 compaction 条目：形状对、切点在输入条目里、摘要非空、details 与 preserveData 能如实表示（输出 4）。 */
function outputProblem(output: unknown, entries: readonly SessionEntry[]): string | null {
    if (typeof output !== "object" || output === null) return "结果不是对象";
    const {summary, firstKeptEntryId, tokensBefore, shortSummary, details, preserveData} = output as Partial<CompactionOutput>;
    if (typeof summary !== "string" || summary === "") return "summary 必须是非空字符串";
    if (typeof firstKeptEntryId !== "string" || !entries.some((entry) => entry.id === firstKeptEntryId)) return "firstKeptEntryId 不是输入条目的 id";
    if (typeof tokensBefore !== "number" || !Number.isFinite(tokensBefore) || tokensBefore < 0) return "tokensBefore 必须是非负数";
    if (shortSummary !== undefined && typeof shortSummary !== "string") return "shortSummary 必须是字符串";
    if (details !== undefined) {
        const problem = jsonProblem(details, "details");
        if (problem !== null) return problem;
    }
    if (preserveData !== undefined) {
        if (typeof preserveData !== "object" || preserveData === null || Array.isArray(preserveData)) return "preserveData 必须是对象";
        const problem = jsonProblem(preserveData, "preserveData");
        if (problem !== null) return problem;
    }
    return null;
}

function compactionEntry(output: CompactionOutput): EntryInput {
    return {
        type: "compaction",
        summary: output.summary,
        firstKeptEntryId: output.firstKeptEntryId,
        tokensBefore: output.tokensBefore,
        ...(output.shortSummary === undefined ? {} : {shortSummary: output.shortSummary}),
        ...(output.details === undefined ? {} : {details: output.details}),
        ...(output.preserveData === undefined ? {} : {preserveData: output.preserveData}),
    };
}

async function attempt(method: CompactionMethod, input: MethodInput, signal: AbortSignal): Promise<MethodResult | {ok: false; detail: string; inapplicable: true}> {
    try {
        const applicable = method.applicable(input);
        if (!applicable.ok) return {ok: false, detail: applicable.detail, inapplicable: true};
        return await method.run(input, signal);
    } catch (error) {
        return {ok: false, detail: errorText(error)};
    }
}

export async function compactSession(input: CompactInput): Promise<CompactionResult<Compacted>> {
    const order = input.methods ?? input.settings.methods;
    const methods: CompactionMethod[] = [];
    for (const id of order) {
        const method = input.registry.get(id);
        if (method === undefined) return {ok: false, code: "unknown-method", detail: `方法 ${id} 未注册`};
        methods.push(method);
    }
    const signal = input.signal ?? new AbortController().signal;
    if (signal.aborted) return CANCELLED;

    const entries = input.log.entries;
    const methodInput: MethodInput = {entries, model: input.model, apiKey: input.apiKey, settings: input.settings};
    const attempts: Attempt[] = [];
    let anyFailed = false;
    for (const method of methods) {
        const result = await attempt(method, methodInput, signal);
        if (signal.aborted) return CANCELLED;
        if (!result.ok) {
            const inapplicable = "inapplicable" in result;
            anyFailed ||= !inapplicable;
            attempts.push({method: method.id, detail: inapplicable ? `不适用：${result.detail}` : `失败：${result.detail}`});
            continue;
        }
        const problem = outputProblem(result.value, entries);
        if (problem !== null) {
            anyFailed = true;
            attempts.push({method: method.id, detail: `失败：结果不合规（${problem}）`});
            continue;
        }
        const appended = await input.log.append([compactionEntry(result.value), ...(input.seeds ?? [])]);
        if (!appended.ok) return {ok: false, code: "log-failed", detail: `${appended.code}：${appended.detail}`};
        return {ok: true, value: {method: method.id, output: result.value, entries: appended.value}};
    }
    const detail = attempts.map((item) => `${item.method}：${item.detail}`).join("；");
    return {ok: false, code: anyFailed ? "compaction-failed" : "nothing-to-compact", detail: detail === "" ? "没有方法可用" : detail, attempts};
}
