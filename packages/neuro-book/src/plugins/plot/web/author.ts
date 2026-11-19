/**
 * 浏览器里调 `nbook.plot/author`（docs/specs/plot/author-ui.md 的“输入与前置条件”）：远程的结果换成 canon 读取层收的形状
 * （`CanonResult`），剧情的失败码从 `detail.code` 取出来放到 `failure.code`（读取层与界面按它判断，例如 `cursor-stale`）。
 * 各方法的结果类型在这里，取自 `core/author/` 的类型。
 */

import type {DelegatedRemoteAccess} from "@notnotype/nb-runtime/plugins";

import type {CanonResult} from "nbook/plugins/canon/shared/contracts";

import type {AuthorExperienceItem} from "../core/author/experience";
import type {AuthorAttitude, AuthorGoal, AuthorHolder} from "../core/author/goals";
import type {AuthorKnowing, AuthorName, PointRelated} from "../core/author/knowing";
import type {AuthorLedgerRow, LedgerSegment} from "../core/author/ledger";
import type {SecretRow, SecretSegment} from "../core/author/secrets";
import {plotAuthorContract} from "../shared/author";
import type {PlotAuthorInput, PlotAuthorMethod} from "../shared/author";

/** 每个结果都带的：读取输入、实际读的线、名字表。 */
export interface AuthorStamp {
    readonly version: number;
    readonly inputDigest: string;
    readonly line: string;
    readonly names: Readonly<Record<string, AuthorName>>;
}

/** 分页的结果：这一页的项与下一页的游标（没有是最后一页）。 */
export interface AuthorPage<Item> extends AuthorStamp {
    readonly items: readonly Item[];
    readonly cursor?: string;
}

export interface AuthorOutputs {
    readonly person: AuthorStamp & {readonly person: string; readonly secrets: readonly AuthorKnowing[]; readonly others: readonly AuthorKnowing[]; readonly goals: readonly AuthorGoal[]; readonly attitudes: readonly AuthorAttitude[]};
    readonly point: AuthorStamp & {
        readonly point: string;
        readonly secrecy: string;
        readonly people: readonly (AuthorKnowing & {readonly person: string})[];
        readonly peopleTotal: number;
        readonly rest: {readonly count: number; readonly unaware: boolean};
        readonly reader: {readonly degree: "knows" | "suspects" | "unaware"; readonly suspects: {readonly chapter: string | null; readonly paragraph: number | null; readonly excerpt: string} | null; readonly knows: {readonly chapter: string | null; readonly paragraph: number | null; readonly excerpt: string} | null};
        readonly related: PointRelated;
        /** “和它有关的”各列表截之前的条数（每个列表至多列 50 条）。 */
        readonly relatedTotals: Readonly<Record<keyof PointRelated, number>>;
    };
    readonly secrets: AuthorPage<SecretRow & {readonly plansMore: number}> & {readonly counts: Readonly<Record<SecretSegment, number>>; readonly candidates: readonly string[]; readonly main: readonly string[]; readonly people: readonly string[]};
    readonly plotLines: AuthorStamp & {readonly items: readonly string[]};
    readonly goals: AuthorPage<AuthorHolder>;
    readonly ledger: AuthorPage<AuthorLedgerRow> & {readonly counts: Readonly<Record<LedgerSegment, number>>};
    readonly experience: AuthorPage<AuthorExperienceItem> & {readonly uncast: number};
}

export interface PlotAuthorClient {
    call<M extends PlotAuthorMethod>(method: M, input: PlotAuthorInput<M>): Promise<CanonResult<AuthorOutputs[M]>>;
}

type Raw = {readonly ok: true; readonly value: unknown} | {readonly ok: false; readonly code: string; readonly detail?: unknown};

/** `access` 每次调用时取：调用方身份要等门面签发完才能用。 */
export function createPlotAuthorClient(access: () => DelegatedRemoteAccess): PlotAuthorClient {
    return {
        call: async (method, input) => {
            const invoke = access().use(plotAuthorContract)[method] as (input: unknown) => Promise<Raw>;
            const raw = await invoke(input);
            if (raw.ok) return {ok: true, value: raw.value as never};
            const inner = (raw.detail as {readonly code?: unknown} | undefined)?.code;
            return {ok: false, failure: {code: typeof inner === "string" ? inner : raw.code, ...(raw.detail === undefined ? {} : {detail: raw.detail})}};
        },
    };
}
