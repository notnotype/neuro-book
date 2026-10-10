/** 压缩模块的公开类型，逐字对应 docs/specs/harness/compaction.md 的“输入与前置条件”。 */

import type {SummaryOptions} from "@oh-my-pi/pi-agent-core";
import type {Model} from "@oh-my-pi/pi-catalog";
import type {EntryInput, JsonValue, SessionEntry, SessionLog} from "../session/session";

export type {JsonValue, Model};

/** OMP 给宿主替换摘要调用传输的接口（SummaryOptions.completeImpl）。 */
export type CompleteImpl = NonNullable<SummaryOptions["completeImpl"]>;

export type CompactionSettings = {
    methods: string[];
    keepRecentTokens: number;
    reserveTokens?: number;
    threshold: {tokens: number} | {percent: number};
    instructions?: string;
};

export type MethodInput = {entries: readonly SessionEntry[]; model: Model; apiKey: string; settings: CompactionSettings};
export type CompactionOutput = {
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    shortSummary?: string;
    details?: JsonValue;
    preserveData?: {[key: string]: JsonValue};
};
export type MethodResult = {ok: true; value: CompactionOutput} | {ok: false; detail: string};

export type CompactionMethod = {
    id: string;
    applicable(input: MethodInput): {ok: true} | {ok: false; detail: string};
    run(input: MethodInput, signal: AbortSignal): Promise<MethodResult>;
};

export interface CompactionRegistry {
    register(method: CompactionMethod): CompactionResult<{dispose(): void}>;
    get(id: string): CompactionMethod | undefined;
    list(): string[];
}

export type CompactInput = {
    log: SessionLog;
    registry: CompactionRegistry;
    methods?: readonly string[];
    model: Model;
    apiKey: string;
    settings: CompactionSettings;
    seeds?: readonly EntryInput[];
    signal?: AbortSignal;
};
export type Compacted = {method: string; output: CompactionOutput; entries: readonly SessionEntry[]};

export type TriggerDecision = {compact: boolean; contextTokens: number | null; thresholdTokens: number};

export type CompactionFailure = "invalid-method" | "duplicate-method" | "unknown-method" | "nothing-to-compact" | "compaction-failed" | "cancelled" | "log-failed";
export type Attempt = {method: string; detail: string};
export type CompactionResult<T> = {ok: true; value: T} | {ok: false; code: CompactionFailure; detail: string; attempts?: Attempt[]};
