/**
 * 一个服务商的模型成员（docs/specs/models/service.md 输出 22）：来源模型（模板在打包目录里的对话模型）与手加的模型，合上设置里
 * 的覆盖。纯函数，只读配置与打包目录；设置里只记覆盖、移出与冻结，目录新出的模型自动出现。
 *
 * 成员关系：
 * - 开着“自动加入”（`followSource`）：目录里的全部对话模型，去掉 `excluded`；`models` 里的条目只是覆盖（启用与否、改过的字段）。
 * - 关着：目录模型只有 `models` 里有条目的在列表里（v1 的目录服务商就是这样，关掉自动加入时也给当时的成员补了条目）。
 * - 条目的 id 不在目录里：来历是 `manual` 就是手加的模型；是 `source` 就是目录漂移（目录里已经没了，状态 `missing`）。
 * - 手加的条目优先：目录后来有了同 id 的模型，这一行仍是手加的（不借目录的能力、移出时删掉而不是进 `excluded`）。
 */

import {chatModels, unsendableReason} from "@notnotype/nb-harness/models";
import type {CatalogModel} from "@notnotype/nb-harness/models";

import type {ModelConfig, ProviderConfig} from "../config/shapes";
import {isBlankTemplate} from "../config/shapes";

export interface MemberRow {
    readonly id: string;
    /** 目录里的行；手加的、目录漂移的没有。 */
    readonly source: CatalogModel | undefined;
    /** 设置里的条目（覆盖与启用）；没有条目时一切取目录值、启用。 */
    readonly entry: ModelConfig | undefined;
    readonly origin: "source" | "manual";
    /** 来源条目在目录里有行、但不能当对话模型发（不是对话类、传输不走 HTTP 请求）；能发或目录里没有为 null。 */
    readonly unsendable: "not-chat" | "transport" | null;
}

/** 目录里没有对话行的来源条目：查一下它是根本没有了，还是有但发不了。 */
const unsendableOf = (template: string, id: string, origin: "source" | "manual", source: CatalogModel | undefined): MemberRow["unsendable"] => (origin === "source" && source === undefined && !isBlankTemplate(template) ? unsendableReason(template, id) : null);

const sourceCache = new Map<string, ReadonlyMap<string, CatalogModel>>();

/** 模板的来源模型（按 id）；空白模板没有。 */
export function sourceModels(template: string): ReadonlyMap<string, CatalogModel> {
    if (isBlankTemplate(template)) return new Map();
    let found = sourceCache.get(template);
    if (found === undefined) {
        found = new Map(chatModels(template).map((model) => [model.id, model]));
        sourceCache.set(template, found);
    }
    return found;
}

/** 在列表里的成员（含未启用的）。顺序：目录模型按目录顺序，然后是条目里的其余模型。 */
export function listedMembers(provider: ProviderConfig): MemberRow[] {
    const sources = sourceModels(provider.template);
    const excluded = new Set(provider.excluded);
    const entries = new Map(provider.models.map((entry) => [entry.id, entry]));
    const rows: MemberRow[] = [];
    for (const source of sources.values()) {
        if (excluded.has(source.id)) continue;
        const entry = entries.get(source.id);
        if (entry?.origin === "manual") continue;
        if (!provider.followSource && entry === undefined) continue;
        rows.push({id: source.id, source, entry, origin: "source", unsendable: null});
    }
    for (const entry of provider.models) {
        if ((sources.has(entry.id) && entry.origin !== "manual") || excluded.has(entry.id)) continue;
        const origin = entry.origin === "source" ? "source" : "manual";
        rows.push({id: entry.id, source: undefined, entry, origin, unsendable: unsendableOf(provider.template, entry.id, origin, undefined)});
    }
    return rows;
}

/** 目录里有、不在列表里的模型：被移出的，或没开自动加入时没加过的。 */
export function availableMembers(provider: ProviderConfig): MemberRow[] {
    const listed = new Set(listedMembers(provider).map((row) => row.id));
    return [...sourceModels(provider.template).values()].filter((source) => !listed.has(source.id)).map((source) => ({id: source.id, source, entry: undefined, origin: "source" as const, unsendable: null}));
}

export function findMember(provider: ProviderConfig, id: string): MemberRow | undefined {
    const entry = provider.models.find((item) => item.id === id);
    const source = entry?.origin === "manual" ? undefined : sourceModels(provider.template).get(id);
    if (provider.excluded.includes(id)) return undefined;
    if (source !== undefined) return provider.followSource || entry !== undefined ? {id, source, entry, origin: "source", unsendable: null} : undefined;
    if (entry === undefined) return undefined;
    const origin = entry.origin === "source" ? "source" : "manual";
    return {id, source: undefined, entry, origin, unsendable: unsendableOf(provider.template, id, origin, undefined)};
}

/** 这一行当前的有效上下文窗口：用户填的，否则目录的。 */
export const windowOf = (row: Pick<MemberRow, "source" | "entry">): number | null => row.entry?.contextWindow ?? row.source?.contextWindow ?? null;
