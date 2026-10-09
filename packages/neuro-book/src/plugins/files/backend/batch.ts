/**
 * 批量移动、复制、删除（docs/specs/workspace/files.md 的“文件操作”：批量预处理、逐项结果、停止与取消、大小上限）。
 * 每一项的提交经 `commit.ts`，与单项操作同一份做法；这里只管预处理、逐项循环、停止与结果的大小。
 *
 * - 预处理在任何副作用之前：解析全部源，按目录项（父目录真实路径加名字）去重，被另一源目录覆盖的只做最外层。
 * - 每项开始前检查业务取消、内核传来的终止信号（调用方断线、调用方或提供入口停止、项目代次结束）与根身份；正在执行
 *   的项按实际结果结算，已完成的项不回滚。
 * - 结果要装进一条 RPC 消息：清单没改成的说明按清单去重放进一张表，项里只放下标；仍超过预算时依次省略范围里的路径、
 *   截短说明、省略清单表，每一步之后重新按编码字节核对。
 */

import {sep} from "node:path";

import type {BatchResult, ChangeSource, ItemResult, ManifestIssue} from "../shared/contracts";
import {encodedBytes, TEXT_BUDGET_BYTES} from "../shared/contracts";
import {createCommitter} from "./commit";
import type {ItemOutcome} from "./commit";
import type {EntryFailure} from "./entry-ops";
import type {Outcome} from "./files-service";
import type {ManifestContext} from "./manifests";
import type {ResolvedEntry, RootedFailure} from "./rooted";

/** 截短之后每条说明最多这么多字节（按 JSON 编码计）。 */
const SHORT_DETAIL_BYTES = 120;

export interface BatchOptions extends ManifestContext {
    /** 批量因终止信号停下时记一条诊断。 */
    readonly stopped: (operation: string, detail: string) => void;
}

/** 一次批量的停止标记：业务取消由 `cancel` 方法置上。 */
export interface BatchControl {
    readonly operation: string;
    cancelled: boolean;
    readonly signal: AbortSignal;
}

export type TransferItem = {readonly source: string; readonly target: string; readonly expected?: string};
export type DeleteItem = {readonly path: string; readonly expected?: string};

export interface Batch {
    transfer(kind: "move" | "copy", input: {readonly operation: string; readonly items: ReadonlyArray<TransferItem>}, origin: ChangeSource, control: BatchControl): Promise<Outcome<BatchResult>>;
    remove(input: {readonly operation: string; readonly items: ReadonlyArray<DeleteItem>}, origin: ChangeSource, control: BatchControl): Promise<Outcome<BatchResult>>;
}

type Fixed = Extract<ItemResult, {readonly status: "skipped" | "not-run" | "cancelled"}>;

/** 一项的中间结果：清单说明还是原文，最后统一放进表里。 */
type Settled = {readonly kind: "outcome"; readonly outcome: ItemOutcome} | {readonly kind: "fixed"; readonly result: Fixed};

type Prepared = {readonly kind: "ready"; readonly entry: ResolvedEntry} | {readonly kind: "settled"; readonly settled: Settled};

export function createBatch(options: BatchOptions): Batch {
    const {root} = options;
    const commit = createCommitter(options);
    const failure = (failed: RootedFailure): Settled => ({kind: "outcome", outcome: {ok: false, failure: failed, manifests: []}});

    /** 解析全部源并去重；解析失败的项直接结算为失败。 */
    const prepare = async (sources: ReadonlyArray<{readonly path: string; readonly expected?: string}>): Promise<Prepared[]> => {
        const prepared: Prepared[] = [];
        const seen = new Set<string>();
        for (const item of sources) {
            const entry = await root.resolveEntry(item.path);
            if ("ok" in entry) {
                // 冻结过的源不在了：旧意图失效（与 commit.ts 的复核同一判定）。
                const changed = item.expected !== undefined && entry.code === "not-found";
                prepared.push({kind: "settled", settled: failure(changed ? {ok: false, code: "source-changed", detail: `${item.path} 已被替换或移走`} : entry)});
                continue;
            }
            if (seen.has(entry.absolute)) {
                prepared.push({kind: "settled", settled: {kind: "fixed", result: {status: "skipped", reason: "duplicate"}}});
                continue;
            }
            seen.add(entry.absolute);
            prepared.push({kind: "ready", entry});
        }
        // 被另一个源覆盖的源只做最外层。源的位置都是真实路径，只有目录会是别的源的前缀（链接的路径下面没有真实路径）。
        const directories = prepared.flatMap((item) => (item.kind === "ready" ? [item.entry.absolute] : []));
        return prepared.map((item): Prepared => {
            if (item.kind !== "ready") return item;
            const covered = directories.some((directory) => item.entry.absolute.startsWith(directory + sep));
            return covered ? {kind: "settled", settled: {kind: "fixed", result: {status: "skipped", reason: "covered"}}} : item;
        });
    };

    /** 逐项执行；`run` 只处理通过预处理的项。 */
    const execute = async <T>(prepared: ReadonlyArray<Prepared>, inputs: ReadonlyArray<T>, control: BatchControl, run: (entry: ResolvedEntry, input: T) => Promise<ItemOutcome>): Promise<Settled[]> => {
        const results: Settled[] = [];
        let stop: Fixed | null = null;
        for (const [index, item] of prepared.entries()) {
            if (stop === null) {
                if (control.cancelled) stop = {status: "cancelled"};
                else if (control.signal.aborted) {
                    stop = {status: "not-run", reason: "stopped"};
                    options.stopped(control.operation, `批量在第 ${String(index + 1)} 项之前停下：${String(control.signal.reason)}`);
                } else {
                    const gone = await root.resolve("");
                    if ("ok" in gone && gone.code === "root-gone") stop = {status: "not-run", reason: "root-gone"};
                }
            }
            if (stop !== null) {
                const skipped = item.kind === "settled" && item.settled.kind === "fixed" && item.settled.result.status === "skipped";
                results.push(skipped ? item.settled : {kind: "fixed", result: stop});
                continue;
            }
            results.push(item.kind === "settled" ? item.settled : {kind: "outcome", outcome: await run(item.entry, inputs[index] as T)});
        }
        return results;
    };

    const tooLarge = (input: unknown): Outcome<never> | null => (encodedBytes(input) > TEXT_BUDGET_BYTES ? {ok: false, code: "too-large", detail: {detail: "批量的请求超过一次请求的上限"}} : null);

    return {
        transfer: async (kind, input, origin, control) => {
            const large = tooLarge(input);
            if (large !== null) return large;
            const prepared = await prepare(input.items.map((item) => ({path: item.source, ...(item.expected === undefined ? {} : {expected: item.expected})})));
            const settled = await execute(prepared, input.items, control, (entry, item) => (kind === "move" ? commit.move(item, entry, origin) : commit.copy(item, entry, origin)));
            return {ok: true, value: fitBudget(settled.map(toDraft))};
        },
        remove: async (input, origin, control) => {
            const large = tooLarge(input);
            if (large !== null) return large;
            const prepared = await prepare(input.items);
            const settled = await execute(prepared, input.items, control, (entry, item) => commit.remove(item, entry, origin));
            return {ok: true, value: fitBudget(settled.map(toDraft))};
        },
    };
}

/** 尚未放进表的一项：清单说明还是原文。 */
export type DraftItem =
    | Fixed
    | {readonly status: "done"; readonly manifests: ReadonlyArray<ManifestIssue>}
    | {readonly status: "failed"; readonly code: string; readonly detail: string; readonly partial?: Extract<ItemResult, {readonly status: "failed"}>["partial"]; readonly manifests: ReadonlyArray<ManifestIssue>};

function toDraft(settled: Settled): DraftItem {
    if (settled.kind === "fixed") return settled.result;
    const {outcome} = settled;
    if (outcome.ok) return {status: "done", manifests: outcome.manifests};
    const partial = (outcome.failure as EntryFailure).partial;
    return {
        status: "failed",
        code: outcome.failure.code,
        detail: outcome.failure.detail,
        ...(partial === undefined ? {} : {partial: {
            ...(partial.removed === undefined ? {} : {removed: {paths: [...partial.removed], truncated: false}}),
            ...(partial.residual === undefined ? {} : {residual: {paths: [...partial.residual], truncated: false}}),
        }}),
        manifests: outcome.manifests,
    };
}

/**
 * 把逐项结果放进合同的形状，并保证编码后不超过预算：清单说明按（路径，状态）去重放进表里；超过预算时依次省略范围里的
 * 路径（标 `truncated`）、把说明截到固定的字节数、省略清单表（标 `truncated`），每一步之后重新核对。最后一步之后每项
 * 只剩固定字段与截短的说明，1000 项一定装得下。
 */
export function fitBudget(drafts: ReadonlyArray<DraftItem>): BatchResult {
    const table: ManifestIssue[] = [];
    const index = new Map<string, number>();
    const refer = (issue: ManifestIssue): number => {
        const key = `${issue.status}\0${issue.path}`;
        const found = index.get(key);
        if (found !== undefined) return found;
        table.push(issue);
        index.set(key, table.length - 1);
        return table.length - 1;
    };
    let items: ItemResult[] = drafts.map((draft): ItemResult => {
        if (draft.status !== "done" && draft.status !== "failed") return draft;
        const refs = [...new Set(draft.manifests.map(refer))];
        const {manifests: _issues, ...rest} = draft;
        return refs.length === 0 ? rest : {...rest, manifests: refs};
    });
    let manifests: ManifestIssue[] = table;
    const fits = (): boolean => encodedBytes({items, manifests}) <= TEXT_BUDGET_BYTES;
    if (fits()) return {items, manifests};

    items = items.map((item): ItemResult => {
        if (item.status !== "failed" || item.partial === undefined) return item;
        const {removed, residual} = item.partial;
        return {...item, partial: {
            ...(removed === undefined ? {} : {removed: {paths: [], truncated: true}}),
            ...(residual === undefined ? {} : {residual: {paths: [], truncated: true}}),
        }};
    });
    if (fits()) return {items, manifests};

    items = items.map((item): ItemResult => (item.status === "failed" ? {...item, detail: clipBytes(item.detail, SHORT_DETAIL_BYTES)} : item));
    manifests = manifests.map((issue) => ({...issue, detail: clipBytes(issue.detail, SHORT_DETAIL_BYTES)}));
    if (fits()) return {items, manifests};

    // 清单路径本身就装不下：只说明有清单没改成，调用方重新列出核对。
    items = items.map((item): ItemResult => {
        if ((item.status !== "done" && item.status !== "failed") || item.manifests === undefined) return item;
        const {manifests: _refs, ...rest} = item;
        return rest;
    });
    return {items, manifests: [], truncated: true};
}

/** 截到 JSON 编码后不超过 `limit` 字节（控制字符编码成六个字节，不能按字数算）。 */
function clipBytes(text: string, limit: number): string {
    if (encodedBytes(text) <= limit) return text;
    let kept = "";
    for (const character of text) {
        if (encodedBytes(`${kept}${character}…`) > limit) break;
        kept += character;
    }
    return `${kept}…`;
}
