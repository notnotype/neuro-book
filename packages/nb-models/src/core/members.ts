/**
 * 一个服务商的模型成员（docs/specs/models/service.md 输出 22 与“模型来源”）：来源模型（`sources.ts` 交来的列表、或模板在目录里的对话
 * 模型）与手加的模型，合上设置里的覆盖。纯函数：来源由调用方算好交进来；设置里只记覆盖、移出与冻结，来源新出的模型自动出现。
 *
 * 成员关系：
 * - 开着“自动加入”（`followSource`）：来源里标了 `auto` 的模型，去掉 `excluded`；`models` 里的条目只是覆盖（启用与否、改过的字段）。
 *   没标 `auto` 的（类型不明、不自动启用的）只在有条目时进列表。
 * - 关着：来源模型只有 `models` 里有条目的在列表里（v1 的目录服务商就是这样，关掉自动加入时也给当时的成员补了条目）。
 * - 条目的 id 不在来源里：来历是 `manual` 就是手加的模型；是 `source` 就是来源漂移（来源里已经没了，状态 `missing`）。服务商的列表
 *   没有、目录里有的配置过的模型不算漂移：服务核心把它当来源模型交进来，带 `unlisted`。
 * - 手加的条目优先：来源后来有了同 id 的模型，这一行仍是手加的（不借来源的能力、移出时删掉而不是进 `excluded`）。
 */

import type {CatalogModel, CatalogRow} from "@notnotype/nb-harness/models";

import type {ModelConfig, ProviderConfig} from "../config/shapes";

/** 一个来源模型：目录或列表给的能力字段（形状同目录的只读视图），加上类型、是否自动加入与物化用的目录行。 */
export interface SourceModel extends CatalogModel {
    readonly kind: "chat" | "unknown";
    /** 开着“自动加入”时直接进列表；为假时只出现在可加的模型里。 */
    readonly auto: boolean;
    /** 目录里的同 id 行（打包或在线），物化时用；只来自列表、目录里没有的为 undefined。 */
    readonly row?: Pick<CatalogRow, "model" | "priceKnown">;
    /**
     * 服务商的列表里没有、但用户配置过（设置里有条目或被角色绑着）且目录里有的：照用，行上标出来（开发者 2026-11-23 定：列表可能
     * 不全，用户明确用着的模型不因列表少了它就不能用；账号真用不了时调用以服务商的错误失败）。
     */
    readonly unlisted?: true;
}

/** 一家此刻的来源：模型按 id，加上“来源里没有的条目在目录里是不是有、只是发不了”。 */
export interface MemberSources {
    readonly models: ReadonlyMap<string, SourceModel>;
    readonly unsendable: (id: string) => "not-chat" | "transport" | null;
}

export interface MemberRow {
    readonly id: string;
    /** 来源里的行；手加的、来源漂移的没有。 */
    readonly source: SourceModel | undefined;
    /** 设置里的条目（覆盖与启用）；没有条目时一切取来源值、启用。 */
    readonly entry: ModelConfig | undefined;
    readonly origin: "source" | "manual";
    /** 来源条目在目录里有行、但不能当对话模型发（不是对话类、传输不走 HTTP 请求）；能发或目录里没有为 null。 */
    readonly unsendable: "not-chat" | "transport" | null;
}

const unsendableOf = (sources: MemberSources, id: string, origin: "source" | "manual"): MemberRow["unsendable"] => (origin === "source" ? sources.unsendable(id) : null);

/** 在列表里的成员（含未启用的）。顺序：来源模型按来源顺序，然后是条目里的其余模型。 */
export function listedMembers(provider: ProviderConfig, sources: MemberSources): MemberRow[] {
    const excluded = new Set(provider.excluded);
    const entries = new Map(provider.models.map((entry) => [entry.id, entry]));
    const rows: MemberRow[] = [];
    for (const source of sources.models.values()) {
        if (excluded.has(source.id)) continue;
        const entry = entries.get(source.id);
        if (entry?.origin === "manual") continue;
        if (entry === undefined && !(provider.followSource && source.auto)) continue;
        rows.push({id: source.id, source, entry, origin: "source", unsendable: null});
    }
    for (const entry of provider.models) {
        if ((sources.models.has(entry.id) && entry.origin !== "manual") || excluded.has(entry.id)) continue;
        const origin = entry.origin === "source" ? "source" : "manual";
        rows.push({id: entry.id, source: undefined, entry, origin, unsendable: unsendableOf(sources, entry.id, origin)});
    }
    return rows;
}

/** 来源里有、不在列表里的模型：被移出的、没开自动加入时没加过的、不自动加入的。 */
export function availableMembers(provider: ProviderConfig, sources: MemberSources): MemberRow[] {
    const listed = new Set(listedMembers(provider, sources).map((row) => row.id));
    return [...sources.models.values()].filter((source) => !listed.has(source.id)).map((source) => ({id: source.id, source, entry: undefined, origin: "source" as const, unsendable: null}));
}

export function findMember(provider: ProviderConfig, sources: MemberSources, id: string): MemberRow | undefined {
    const entry = provider.models.find((item) => item.id === id);
    const source = entry?.origin === "manual" ? undefined : sources.models.get(id);
    if (provider.excluded.includes(id)) return undefined;
    if (source !== undefined) return (provider.followSource && source.auto) || entry !== undefined ? {id, source, entry, origin: "source", unsendable: null} : undefined;
    if (entry === undefined) return undefined;
    const origin = entry.origin === "source" ? "source" : "manual";
    return {id, source: undefined, entry, origin, unsendable: unsendableOf(sources, id, origin)};
}

/** 这一行当前的有效上下文窗口：用户填的，否则来源的。 */
export const windowOf = (row: Pick<MemberRow, "source" | "entry">): number | null => row.entry?.contextWindow ?? row.source?.contextWindow ?? null;

/**
 * 启用与否：条目写了的照它；没有条目的来源模型启用，缺上下文窗口的除外（来源没给窗口、用户也没填：列出来待补字段，补上之前不启用，
 * 决定 27）。
 */
export const enabledOf = (row: Pick<MemberRow, "source" | "entry">): boolean => row.entry?.enabled ?? windowOf(row) !== null;
