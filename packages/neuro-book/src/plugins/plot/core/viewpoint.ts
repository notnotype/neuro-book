/**
 * 按视角过滤的只读视图（docs/specs/plot/knowledge.md 输出 8、9）：给写手与角色看的世界。建在内核的视图令牌之上：位置上限、
 * 线、不开放的读取由内核管（`ViewedReads`），这里在它的结果上按看的人 V 的知情再挡一层。只开放四种读取：读一个条目、按名字找、
 * V 的经历、知情；别的读取根本不在剧情视图的接口里。
 *
 * 挡的规则：一个知识点 V 读不读得到内容，按它的保密档与 V 在上限处的有效知情（`readability`）。读不到的知识点，直接读它得到
 * 占位；别的条目里指向它的引用、以引用为键的列表里它的那一行，名字换成占位；挂在条目下面的不列；按名字找不到它。隐秘目标随它
 * 指向的知识点同样处理（goals.md 术语）。别的条目照常返回，但去掉知情命名空间（V 自己的除外）。
 * Spec 说“挂在下面的保密以上的知识点不列”“指向保密以上知识点的引用换成占位”；这里按“V 读不到内容的”挡：V 自己知道的
 * 保密知识点，在别处出现时照常显示（直接读它也读得到，挡了没有意义）。
 *
 * 每次返回了占位就经 `audit` 记一条（被挡的对象），与内核视图的拒绝记在同一份审计里。
 */

import type {CanonReadView, EntryView, ReadPosition, StoryChange, ViewedReads} from "@notnotype/nb-canon/schema";

import {DEFAULT_SECRECY, ENTRY_TYPES, type Secrecy} from "../shared/declarations";
import {KnowingIndex, presentChanges, type KnowingRow} from "./knowledge";

export interface ViewpointGrant {
    /** 看的人（条目 id）；写手的视图可以没有，这时保密以上的知识点一律读不到。 */
    readonly viewer: string | null;
    readonly until: ReadPosition;
}

/** V 对一个知识点：读得到内容、只读得到他以为的那句、或者只给占位。 */
export type Readability = {readonly kind: "content"} | {readonly kind: "belief"; readonly belief: string} | {readonly kind: "placeholder"};

export type ViewpointEntry =
    | {readonly kind: "entry"; readonly view: EntryView; readonly children: readonly {readonly id: string; readonly name: string; readonly type: string}[]}
    | {readonly kind: "placeholder"; readonly id: string; readonly text: string}
    | {readonly kind: "belief"; readonly id: string; readonly belief: string};

export interface ExperienceItem {
    readonly id: string;
    readonly at: StoryChange["at"];
    readonly text: string;
    /** 同时在场的人：没建条目的给 `label`；用了马甲而 V 不知道揭穿它的知识点时只给马甲（`who` 是马甲）。 */
    readonly cast: readonly ({readonly label: string} | {readonly who: string; readonly as?: string})[];
    /** 这条变更让 V 的有效知情起的变化。 */
    readonly knowing: readonly KnowingRow[];
}

export class Viewpoint {
    readonly #index: KnowingIndex;
    readonly #readability = new Map<string, Readability>();
    readonly #placeholder: string;

    constructor(
        readonly view: CanonReadView,
        readonly viewed: ViewedReads,
        readonly grant: ViewpointGrant,
        /** 返回了占位时记一条审计：哪个读取、挡掉了哪些对象。 */
        readonly audit: (method: string, blocked: readonly string[]) => void,
    ) {
        this.#index = new KnowingIndex(view, "actual", grant.until);
        const viewerName = grant.viewer === null ? null : this.#nameOf(grant.viewer);
        this.#placeholder = `一件${viewerName ?? "写手"}不知道的事`;
    }

    /** V 对一个知识点读不读得到内容（knowledge 输出 9）。不是知识点、也不是隐秘目标的条目都读得到。 */
    readability(entry: string): Readability {
        const cached = this.#readability.get(entry);
        if (cached !== undefined) return cached;
        const result = this.#computeReadability(entry);
        this.#readability.set(entry, result);
        return result;
    }

    #computeReadability(entry: string): Readability {
        const read = this.view.entry(entry, this.grant.until, "actual");
        if (read === null || read === "chapter-not-found") return {kind: "content"};
        const stored = this.view.object({kind: "entry", id: entry}) as {type?: string} | undefined;
        if (stored?.type === ENTRY_TYPES.goal) {
            const secret = (read.namespaces.goal?.fields.隐秘?.value as {ref?: unknown} | null | undefined)?.ref;
            if (typeof secret !== "string") return {kind: "content"};
            return this.readability(secret).kind === "content" ? {kind: "content"} : {kind: "placeholder"};
        }
        if (stored?.type !== ENTRY_TYPES.point) return {kind: "content"};
        const secrecy = (read.namespaces.point?.fields.保密?.value as Secrecy | null | undefined) ?? DEFAULT_SECRECY;
        if (secrecy === "common" || secrecy === "trade") return {kind: "content"};
        if (this.grant.viewer === null) return {kind: "placeholder"};
        const row = this.#index.effective(this.grant.viewer, entry);
        if (row?.程度 === "knows" || row?.程度 === "suspects") return {kind: "content"};
        if (row?.程度 === "misbelieves" && typeof row.他以为的 === "string" && row.他以为的 !== "") return {kind: "belief", belief: row.他以为的};
        return {kind: "placeholder"};
    }

    #hidden(entry: string): boolean {
        return this.readability(entry).kind !== "content";
    }

    #nameOf(entry: string): string | null {
        const read = this.view.entry(entry, this.grant.until, "actual");
        return read === null || read === "chapter-not-found" || read.deleted ? null : read.name;
    }

    /** 读一个条目（输出 9 的前两条）。 */
    entry(id: string): ViewpointEntry | "view-denied" | "not-found" {
        const readable = this.readability(id);
        if (readable.kind === "placeholder") {
            this.audit("viewpoint.entry", [id]);
            return {kind: "placeholder", id, text: this.#placeholder};
        }
        if (readable.kind === "belief") {
            this.audit("viewpoint.entry", [id]);
            return {kind: "belief", id, belief: readable.belief};
        }
        const read = this.viewed.entry(id, undefined, "actual");
        if (read === "view-denied") return read;
        if (read === "chapter-not-found" || read.view === null) return "not-found";
        const blocked = new Set<string>();
        const filtered = this.#filterEntry(read.view, blocked);
        const children = this.view.entries()
            .filter((child) => child.parent === id && child.deleted !== true)
            .flatMap((child) => {
                if (this.#hidden(child.id)) {
                    blocked.add(child.id);
                    return [];
                }
                const childView = this.view.entry(child.id, this.grant.until, "actual");
                if (childView === null || childView === "chapter-not-found" || !childView.appeared) return [];
                return [{id: child.id, name: childView.name, type: child.type}];
            });
        if (blocked.size > 0) this.audit("viewpoint.entry", [...blocked]);
        return {kind: "entry", view: filtered, children};
    }

    /** 去掉别人的知情命名空间；字段里指向 V 读不到的条目的引用与列表行换成占位。 */
    #filterEntry(entry: EntryView, blocked: Set<string>): EntryView {
        const namespaces: Record<string, EntryView["namespaces"][string]> = {};
        for (const [namespace, data] of Object.entries(entry.namespaces)) {
            if (namespace === "know" && entry.id !== this.grant.viewer) continue;
            const declarations = this.view.fields(entry.id, namespace) ?? [];
            const fields: Record<string, EntryView["namespaces"][string]["fields"][string]> = {};
            for (const [fieldId, state] of Object.entries(data.fields)) {
                const field = declarations.find((candidate) => candidate.id === fieldId);
                fields[fieldId] = field === undefined ? state : {...state, value: this.#maskValue(field, state.value, blocked)};
            }
            namespaces[namespace] = {...data, fields};
        }
        return {...entry, namespaces, upcoming: []};
    }

    #maskRef(value: unknown, blocked: Set<string>): unknown {
        const id = (value as {ref?: unknown} | null | undefined)?.ref;
        if (typeof id !== "string" || !this.#hidden(id)) return value;
        blocked.add(id);
        return {ref: null, label: this.#placeholder};
    }

    #maskValue(field: NonNullable<ReturnType<CanonReadView["fields"]>>[number], value: unknown, blocked: Set<string>): unknown {
        if (field.kind === "ref") return this.#maskRef(value, blocked);
        if (field.kind !== "list" || !Array.isArray(value)) return value;
        return (value as Array<Record<string, unknown>>).map((element) => {
            const masked: Record<string, unknown> = {...element};
            if (field.keyedBy === "ref" && typeof element.id === "string" && this.#hidden(element.id)) {
                blocked.add(element.id);
                // 只留 V 自己知情行的程度与他以为的那句（那是 V 自己的），别的子字段与 id 都不给。
                const own = field.id === "知情" ? {程度: element.程度, 他以为的: element.他以为的} : {};
                return {id: null, label: this.#placeholder, ...own};
            }
            for (const sub of field.item ?? []) if (sub.kind === "ref") masked[sub.id] = this.#maskRef(element[sub.id], blocked);
            return masked;
        });
    }

    /** 按名字找条目（输出 9 第三条）：V 读不到内容的知识点与隐秘目标不出现。 */
    lookup(names: readonly string[]): Readonly<Record<string, readonly string[]>> | "view-denied" {
        const found = this.viewed.lookup(names, undefined);
        if (typeof found === "string") return found === "view-denied" ? found : {};
        const blocked = new Set<string>();
        const result: Record<string, readonly string[]> = {};
        for (const [name, ids] of Object.entries(found.found)) {
            result[name] = ids.filter((id) => {
                if (!this.#hidden(id)) return true;
                blocked.add(id);
                return false;
            });
        }
        if (blocked.size > 0) this.audit("viewpoint.lookup", [...blocked]);
        return result;
    }

    /**
     * V 的经历（输出 8、9 第四条）：上限之前 V 在场的剧情变更（按先后），每条只给 id、安放、描述、同时在场的人、让 V 的知情起的变化；
     * 不给补丁、讲述、标注与别人的知情行。另给这段里没记参与者的变更数。
     */
    experience(): {readonly items: readonly ExperienceItem[]; readonly uncast: number} | "no-viewer" {
        const viewer = this.grant.viewer;
        if (viewer === null) return "no-viewer";
        const present = presentChanges(this.view, "actual", this.grant.until, viewer);
        const items = present.changes.map((change): ExperienceItem => ({
            id: change.id,
            at: change.at,
            text: change.text,
            cast: (change.cast ?? []).filter((member) => member.who !== viewer && member.as !== viewer).map((member) => {
                if (member.who === undefined) return {label: member.label ?? ""};
                if (member.as === undefined) return {who: member.who};
                // 用了马甲：V 知道揭穿这个马甲的知识点才给本体（与称谓表同一规则，brief.md 输出 7）。
                return this.#knowsUnmasking(member.as) ? {who: member.who, as: member.as} : {who: member.as};
            }),
            knowing: this.#index.changedBy(viewer, change.id),
        }));
        return {items, uncast: present.uncast};
    }

    #knowsUnmasking(alias: string): boolean {
        if (this.grant.viewer === null) return false;
        for (const point of this.view.entries()) {
            if (point.deleted === true || point.type !== ENTRY_TYPES.point) continue;
            const read = this.view.entry(point.id, this.grant.until, "actual");
            if (read === null || read === "chapter-not-found") continue;
            const unmasks = (read.namespaces.point?.fields.揭穿?.value as {ref?: unknown} | null | undefined)?.ref;
            if (unmasks !== alias) continue;
            const row = this.#index.effective(this.grant.viewer, point.id);
            if (row?.程度 === "knows" || row?.程度 === "suspects") return true;
        }
        return false;
    }

    /**
     * 知情（输出 9 第四条）：问 V 自己给全部有效知情；问别人，只给 V 自己也知道或怀疑的、`common` 或 `trade` 的知识点那几行。
     */
    knowing(who: string): readonly KnowingRow[] | "no-viewer" {
        const viewer = this.grant.viewer;
        if (viewer === null) return "no-viewer";
        if (who === viewer) return this.#index.all(viewer);
        return this.#index.all(who).filter((row) => {
            const own = this.#index.effective(viewer, row.point);
            if (own?.程度 !== "knows" && own?.程度 !== "suspects") return false;
            const read = this.view.entry(row.point, this.grant.until, "actual");
            const secrecy = read === null || read === "chapter-not-found" ? DEFAULT_SECRECY : ((read.namespaces.point?.fields.保密?.value as Secrecy | null | undefined) ?? DEFAULT_SECRECY);
            return secrecy === "common" || secrecy === "trade";
        });
    }
}
