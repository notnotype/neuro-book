/**
 * 内置方法 soft：本地模型摘要，直接包 OMP 的 prepareCompaction 与 compact，关闭远程与服务方原生压缩
 * （docs/specs/harness/compaction.md 输出 7、8）。
 */

import {compact, prepareCompaction} from "@oh-my-pi/pi-agent-core";
import type {CompactionSettings as OmpCompactionSettings} from "@oh-my-pi/pi-agent-core";
import type {CompactionMethod, CompactionSettings, CompleteImpl, JsonValue, MethodInput} from "./types";

const NOTHING = "没有可压缩的历史";

export function ompSettings(settings: CompactionSettings): OmpCompactionSettings {
    return {
        enabled: true,
        keepRecentTokens: settings.keepRecentTokens,
        ...(settings.reserveTokens === undefined ? {} : {reserveTokens: settings.reserveTokens}),
        remoteEnabled: false,
        remoteStreamingV2Enabled: false,
    };
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 条目是冻结的、OMP 的签名要可变数组：交浅副本（OMP 不改写条目，session 输出 23）。 */
const prepare = (input: MethodInput) => prepareCompaction([...input.entries], ompSettings(input.settings), input.model);

export function createSoftCompaction(options: {completeImpl?: CompleteImpl} = {}): CompactionMethod {
    const summaryOptions = options.completeImpl === undefined ? {} : {completeImpl: options.completeImpl};
    return Object.freeze({
        id: "soft",
        applicable(input: MethodInput) {
            if (input.model.contextWindow === null || !(input.model.contextWindow > 0)) return {ok: false as const, detail: "模型没有正的 contextWindow"};
            return prepare(input) === undefined ? {ok: false as const, detail: NOTHING} : {ok: true as const};
        },
        async run(input: MethodInput, signal: AbortSignal) {
            const preparation = prepare(input);
            if (preparation === undefined) return {ok: false as const, detail: NOTHING};
            let result;
            try {
                result = await compact(preparation, input.model, input.apiKey, input.settings.instructions, signal, summaryOptions);
            } catch (error) {
                return {ok: false as const, detail: errorText(error)};
            }
            // OMP 的本地摘要在中止时不抛出：回复 stopReason 为 aborted、文本为空，拼出来的“摘要”只剩分隔符，所以以 signal 为准
            if (signal.aborted) return {ok: false as const, detail: "aborted"};
            if (result.summary === "") return {ok: false as const, detail: "摘要为空"};
            return {
                ok: true as const,
                value: {
                    summary: result.summary,
                    firstKeptEntryId: result.firstKeptEntryId,
                    tokensBefore: result.tokensBefore,
                    ...(result.shortSummary === undefined ? {} : {shortSummary: result.shortSummary}),
                    // OMP 的 details 是 {readFiles, modifiedFiles} 两个字符串数组，能被 JSON 如实表示
                    ...(result.details === undefined ? {} : {details: result.details as JsonValue}),
                    ...(result.preserveData === undefined ? {} : {preserveData: result.preserveData as {[key: string]: JsonValue}}),
                },
            };
        },
    });
}

export const softCompaction: CompactionMethod = createSoftCompaction();
