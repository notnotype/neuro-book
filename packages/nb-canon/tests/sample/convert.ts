/**
 * 把 t16 原型里星瑕样本的写入草稿换成 nb-canon 的写入请求（canon.project 场景 1）。原型与 Spec 第三版的形状差别：
 *
 * - Component 类型：原型按命名空间 `ns` 登记，这里给每个类型一个 id `sample.<ns>`；`max: {field}` 写成字段 id。
 * - 条目的数据块要带类型与版本；`initTold` 改名 `retold`；未决问题挂在字段上时 `about.kind` 是 `address`。
 * - 新建对象用 `tmp:<原型 id>`，发布后按 id 对照记下原型 id 对应的世界 id；之后的写入、对象里的 id 字段与主 MDX 里的
 *   `ref("…")`、`<Ref id>` 都换成世界 id。正文建议的 `cause` 是修订 id，按原型修订的先后换成世界的修订 id。
 * - `splitFrom` 要带 `by`（兑现原计划的那条已写变更），原型没有，按“哪条已写变更兑现了原计划”补上。
 * - 原型的还原是一次普通写入（把对象改回去）；这里交给世界服务的 `revert`，由 `reverts` 认出。
 * 不含断言。
 */

import type {ComponentDeclaration, FieldDeclaration, WriteRequest} from "../../src/index";

export interface PrototypeSample {
    readonly componentTypes: ReadonlyArray<{readonly ns: string; readonly label: string; readonly version: number; readonly fields: ReadonlyArray<Record<string, unknown>>}>;
    readonly chapters: ReadonlyArray<{readonly id: string; readonly title: string; readonly outline: string; readonly text: string}>;
    readonly items: ReadonlyArray<{readonly label: string; readonly files?: Readonly<Record<string, {readonly text?: string; readonly outline?: string}>>; readonly draft: Draft}>;
    readonly reductions: ReadonlyArray<{readonly text: string; readonly inputs: readonly string[]}>;
    readonly results: ReadonlyArray<{readonly position: unknown; readonly entries: Readonly<Record<string, {readonly appeared: boolean; readonly state: PrototypeState}>>; readonly diagnostics: readonly unknown[]}>;
    readonly pending: readonly unknown[];
}

export interface PrototypeState {
    readonly name: string;
    readonly aliases: readonly string[];
    readonly summary: string;
    readonly text: ReadonlyArray<{readonly id: string; readonly source: string}>;
    readonly data: Readonly<Record<string, {readonly enabled: boolean; readonly fields: Readonly<Record<string, unknown>>}>>;
}

interface Draft {
    readonly by: WriteRequest["by"];
    readonly what: WriteRequest["what"];
    readonly title: string;
    readonly chapter?: string;
    readonly notes?: unknown;
    readonly reverts?: string;
    readonly puts: ReadonlyArray<{readonly ref: {readonly kind: "entry" | "change" | "check" | "question" | "suggestion"; readonly id: string}; readonly after: unknown}>;
}

export const typeId = (ns: string): string => `sample.${ns}`;

export function componentDeclarations(sample: PrototypeSample): ComponentDeclaration[] {
    return sample.componentTypes.map((type) => ({
        id: typeId(type.ns),
        label: type.label,
        namespace: type.ns,
        version: type.version,
        fields: type.fields.map((field) => {
            const {max, ...rest} = field as Record<string, unknown> & {max?: number | {field: string}};
            return {...rest, ...(max === undefined ? {} : {max: typeof max === "number" ? max : max.field})} as unknown as FieldDeclaration;
        }),
    }));
}

/** 原型 id 与世界 id 的对照，随发布逐步补上。 */
export class IdMap {
    readonly #ids = new Map<string, string>();
    readonly #revisions: string[] = [];

    has(id: string): boolean {
        return this.#ids.has(id);
    }

    get(id: string): string {
        const mapped = this.#ids.get(id);
        if (mapped === undefined) throw new Error(`原型 id ${id} 还没有对应的世界 id`);
        return mapped;
    }

    /** 记下一次发布的对照（`tmp:<原型 id>` → 世界 id）与它对应的原型修订。 */
    learn(ids: Readonly<Record<string, string>>, revision: string): void {
        for (const [temp, id] of Object.entries(ids)) this.#ids.set(temp.slice("tmp:".length), id);
        this.#revisions.push(revision);
    }

    /** 原型的第 n 次修订（`r<n>`）对应的世界修订 id。 */
    revision(prototype: string): string {
        const index = Number(prototype.slice(1)) - 1;
        const mapped = this.#revisions[index];
        if (mapped === undefined) throw new Error(`原型修订 ${prototype} 还没有对应的世界修订`);
        return mapped;
    }

    /** 本次写入里引用到的原型 id：已经发布过的换成世界 id，本次新建的写成 `tmp:`。 */
    ref(id: string, creating: ReadonlySet<string>): string {
        if (creating.has(id)) return `tmp:${id}`;
        return this.get(id);
    }
}

/** 值是对象 id 的键（条目、计划、兑现变更、核对点）；`id` 不在其中：列表元素与块的 id 是局部的，不换。 */
const ENTRY_KEYS = ["parent", "sameAs", "entry", "plan", "by", "check"] as const;

/** 换掉一个对象里所有指向别的对象的 id，与主 MDX 里的条目引用。 */
function remap(value: unknown, map: (id: string) => string, key?: string): unknown {
    if (typeof value === "string") {
        if (key === "source") return value.replace(/ref\("([^"]+)"\)/gu, (_whole, id: string) => `ref("${map(id)}")`).replace(/<Ref id="([^"]+)"/gu, (_whole, id: string) => `<Ref id="${map(id)}"`);
        if (key !== undefined && (ENTRY_KEYS as readonly string[]).includes(key)) return map(value);
        return value;
    }
    if (Array.isArray(value)) return value.map((item) => (key === "involves" || key === "lines" || key === "suspects" ? map(item as string) : remap(item, map)));
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([inner, item]) => [inner, remap(item, map, inner)]));
}

/**
 * 原型的讲述没有锚点：细纲、作者消息、界面的讲述按 canon.model 的“讲述”表必有锚点（细纲还要章），这里补一个
 * 指明“来自样本”的锚点，章取这条记录所在的章。
 */
function anchored(telling: {source: string; chapter?: string; anchor?: string}, chapter: string | undefined): unknown {
    if (telling.anchor !== undefined || !["outline", "message", "ui"].includes(telling.source)) return telling;
    const withChapter = telling.source === "outline" && telling.chapter === undefined && chapter !== undefined ? {chapter} : {};
    return {...telling, ...withChapter, anchor: `sample:${telling.source}`};
}

/** 原型对象换成 Spec 第三版的形状（不含 id 的替换）。 */
function reshape(kind: Draft["puts"][number]["ref"]["kind"], after: Record<string, unknown>, sample: PrototypeSample, written: ReadonlyMap<string, string>): Record<string, unknown> {
    if (kind === "entry") {
        const {initTold, init, ...rest} = after as {initTold?: unknown; init: PrototypeState};
        const version = (ns: string) => sample.componentTypes.find((type) => type.ns === ns)?.version ?? 1;
        const data = Object.fromEntries(Object.entries(init.data).map(([ns, block]) => [ns, {type: typeId(ns), version: version(ns), enabled: block.enabled, fields: block.fields}]));
        return {...rest, init: {...init, data}, ...(initTold === undefined ? {} : {retold: initTold})};
    }
    if (kind === "question") {
        // 原型的未决问题 → 决策（canon.model 输出 31、32）：挂的对象改成列表；样本里答过的问题都是 Agent 答的，
        // Agent 没有作者授权不能定，记成带建议的待定决策。
        const {about: original, status, answer, ...rest} = after as {about?: {kind: string; at?: unknown; id?: string}; status: string; answer?: string};
        const about = original === undefined ? [] : [original.kind === "field" ? {kind: "address", at: original.at} : original];
        const suggestion = status === "answered" && answer !== undefined ? {suggestion: {conclusion: answer, by: {kind: "agent", session: "样本"}}} : {};
        // 放弃要作者来源（model.md 的决策转换表），样本没有签发方，一律记成待定。
        return {...rest, about, status: "pending", ...suggestion};
    }
    if (kind === "change") {
        const links = (after.links as Array<{kind: string; plan: string; by?: string}>).map((link) => {
            if (link.kind !== "splitFrom" || link.by !== undefined) return link;
            const by = written.get(link.plan);
            if (by === undefined) throw new Error(`拆出的计划 ${String(after.id)} 找不到兑现原计划 ${link.plan} 的已写变更`);
            return {...link, by};
        });
        const at = after.at as {kind: string; chapter?: string};
        const told = (after.told as Array<{source: string; chapter?: string}>).map((telling) => anchored(telling, at.chapter));
        return {...after, links, told};
    }
    return after;
}

/**
 * 原型草稿 → 写入请求。`written` 是“计划 id → 兑现它的已写变更的原型 id”，由调用方随发布维护（本次草稿里的也算）。
 */
export function toRequest(draft: Draft, index: number, ids: IdMap, sample: PrototypeSample, baseVersion: number, written: Map<string, string>): WriteRequest {
    const creating = new Set(draft.puts.filter((put) => !ids.has(put.ref.id)).map((put) => put.ref.id));
    for (const put of draft.puts) {
        if (put.ref.kind !== "change" || put.after === null) continue;
        const change = put.after as {id: string; kind: string; links: Array<{kind: string; plan: string}>};
        if (change.kind === "written") for (const link of change.links) if (link.kind === "fulfills") written.set(link.plan, change.id);
    }
    const map = (id: string) => ids.ref(id, creating);
    const puts = draft.puts.map((put) => {
        const id = map(put.ref.id);
        if (put.after === null) return {ref: {kind: put.ref.kind, id}, after: null};
        const shaped = reshape(put.ref.kind, put.after as Record<string, unknown>, sample, written);
        const remapped = remap(shaped, map) as Record<string, unknown>;
        const cause = put.ref.kind === "suggestion" ? {cause: ids.revision(String(shaped.cause))} : {};
        // 决策挂在条目或变更上时，`about[].id` 是对象 id。
        const about = remapped.about as Array<{kind: string; id?: string}> | undefined;
        const aboutIds = put.ref.kind === "question" && about !== undefined ? {about: about.map((item) => (item.id === undefined ? item : {...item, id: map(item.id)}))} : {};
        const kind = put.ref.kind === "question" ? "decision" : put.ref.kind;
        return {ref: {kind, id}, after: {...remapped, ...cause, ...aboutIds, id}};
    });
    return {
        requestId: `xingxia-${String(index + 1)}`,
        by: draft.by,
        what: draft.what,
        title: draft.title,
        baseVersion,
        ...(draft.chapter === undefined ? {} : {chapter: draft.chapter}),
        puts,
    } as WriteRequest;
}
