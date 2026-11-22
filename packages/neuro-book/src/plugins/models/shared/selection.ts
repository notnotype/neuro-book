/**
 * 选用数据（docs/specs/models/settings-pages.md“选用数据”）：选择器、agent 标签、角色页与 Profile 页要的“哪些模型能选、绑着的模型叫什么”，
 * 按服务商分页读，不随快照整份带。纯 TS：响应式的量由调用方交进来的 `ref` 造（Vue 的 `shallowRef`），所以 `nbook.models` 与
 * `nbook.agent` 的浏览器入口各建一份，不新增服务键，models 入口仍然懒激活。
 *
 * 读法：
 * - 每次收到快照（`attach`），比对各家的 `modelsRevision`，只重读变了的那家；整批到齐后一次换掉 `rows`（只触发一次依赖它的刷新），
 *   到齐之前继续交出旧的。内容没变（没有要重读的、服务商的集合与顺序也没变）时不换引用、不通知。
 * - 一家分页读时带首页的 `revision`，中间这家变了服务端回 `revision-changed`，整家重读，最多重试 `RETRIES` 次。
 * - 又来了新快照：在途的这一轮不再换 `rows`，但已经读完的那几家照样记进缓存（按它们被读时快照里的版本），新的一轮只重读剩下的；
 *   快照来得比读取快时也会逐步到齐。
 * - 第一轮读完（读失败的那家按没有行算，下一份快照再试）`ready` 就为真：一家读不到不该让选择器一直空着。
 * - `want` 登记要按引用取的模型（角色绑定的、Profile 指名的），按服务商版本缓存，一次不超过合同的上限。`lookup` 里只有已经取到的
 *   引用：没有这个键是还在取，值为 null 才是确认没有这个模型。
 * - `lazy`：有人 `subscribe` 之前不读（设置页的数据模块一直跟着快照，但只有角色页要选用数据）。
 */

import type {ModelRow, ModelsSnapshot} from "@notnotype/nb-models/contract";
import {MODEL_PAGE_SIZE, MODEL_REFERENCES_MAX} from "@notnotype/nb-models/contract";
import {splitReference} from "@notnotype/nb-models/config";

/** 响应式量的最小形状：Vue 的 `shallowRef` 满足它。 */
export interface Cell<T> {
    value: T;
}

export interface SelectionRow extends ModelRow {
    readonly provider: string;
}

/** 选用数据要的远程方法（合同 `nbook.models/settings` 的子集）。 */
export interface SelectionRemote {
    enabledModels(input: {providers?: string[]; usable?: boolean; offset: number; limit: number; revision?: string}): Promise<
        {readonly ok: true; readonly value: {readonly rows: readonly SelectionRow[]; readonly revision: string; readonly nextOffset: number | null; readonly total: number}} | {readonly ok: false; readonly code: string}
    >;
    modelsByReference(input: {references: string[]}): Promise<
        {readonly ok: true; readonly value: ReadonlyArray<{readonly reference: string; readonly provider: string | null; readonly row: ModelRow | null}>} | {readonly ok: false; readonly code: string}
    >;
}

export interface SelectionOptions {
    readonly remote: SelectionRemote;
    readonly ref: <T>(initial: T) => Cell<T>;
    /** 只要有凭据的服务商里可用的模型（选择器、agent 标签）；不给时是全部启用的模型（角色页、Profile 页）。 */
    readonly usable: boolean;
    /** 读失败（不是业务上的版本换代）时通知；缺省不报。 */
    readonly onFailure?: (code: string) => void;
    /** 第一次 `subscribe` 之前只记快照、不读；缺省 false。 */
    readonly lazy?: boolean;
}

export interface SelectionData {
    /** 当前能选的模型：按服务商在快照里的顺序、服务商内按系列、名称排。第一次读完之前为空。 */
    readonly rows: Cell<readonly SelectionRow[]>;
    /** `rows` 的版本：各家 `modelsRevision` 的拼接；读取期间的新旧交替靠它判断，调用方不解析。 */
    readonly revision: Cell<string>;
    /** 第一轮读完之后为真（读失败的服务商按没有行算）。 */
    readonly ready: Cell<boolean>;
    /** 按引用取到的行；值为 null 是没有这个模型（服务商或模型不在、被移出）。键是 `<服务商>/<模型>`；登记了、还没取到的引用不在里面。 */
    readonly lookup: Cell<ReadonlyMap<string, ModelRow | null>>;
    /** `rows` 或 `lookup` 换了之后调用（只在换引用的那一刻，不逐页）；返回取消函数。 */
    subscribe(listener: () => void): () => void;
    /** 换上新快照；返回这份快照是否要重读行（为真时 `rows` 稍后会换，调用方可以等那次通知再刷新依赖 `rows` 的东西）。 */
    attach(snapshot: ModelsSnapshot): boolean;
    /** 登记要按引用取的模型（替换上一次登记的）。 */
    want(references: readonly string[]): void;
    dispose(): void;
}

const RETRIES = 3;

export function createSelectionData(options: SelectionOptions): SelectionData {
    const rows = options.ref<readonly SelectionRow[]>([]);
    const revision = options.ref("");
    const ready = options.ref(false);
    const lookup = options.ref<ReadonlyMap<string, ModelRow | null>>(new Map());
    /** 各家已经读到的行与对应的版本。 */
    const cached = new Map<string, {readonly revision: string; readonly rows: readonly SelectionRow[]}>();
    /** 引用的缓存：服务商的版本变了就作废。 */
    const looked = new Map<string, {readonly revision: string; readonly row: ModelRow | null}>();
    const listeners = new Set<() => void>();
    const notify = (): void => {
        for (const listener of [...listeners]) listener();
    };
    let latest: ModelsSnapshot | null = null;
    let wanted: readonly string[] = [];
    let generation = 0;
    /** 登记引用与新快照都让在途的取引用不再换 `lookup`（取到的照样进缓存，由后来的那一轮换）。 */
    let lookupGeneration = 0;
    let disposed = false;
    let active = options.lazy !== true;
    /** 两份行是否逐项是同一个对象：相同就不换引用。 */
    const sameRows = (a: readonly SelectionRow[], b: readonly SelectionRow[]): boolean => a.length === b.length && a.every((row, index) => row === b[index]);
    const staleOf = (snapshot: ModelsSnapshot) => snapshot.providers.filter((provider) => cached.get(provider.id)?.revision !== provider.modelsRevision);

    const readProvider = async (id: string): Promise<SelectionRow[] | null> => {
        for (let attempt = 0; attempt < RETRIES; attempt += 1) {
            const collected: SelectionRow[] = [];
            let pinned: string | undefined;
            let again = false;
            for (let offset: number | null = 0; offset !== null && !disposed;) {
                const page = await options.remote.enabledModels({providers: [id], usable: options.usable, offset, limit: MODEL_PAGE_SIZE, ...(pinned === undefined ? {} : {revision: pinned})});
                if (!page.ok) {
                    if (page.code === "revision-changed") {
                        again = true;
                        break;
                    }
                    options.onFailure?.(page.code);
                    return null;
                }
                pinned = page.value.revision;
                collected.push(...page.value.rows);
                offset = page.value.nextOffset;
            }
            if (!again) return collected;
        }
        options.onFailure?.("revision-changed");
        return null;
    };

    /** 在途的读，按服务商：同一家同一版本只读一次（读到一半来了新快照，新的一轮接着等它，不再发一遍）。 */
    const inflight = new Map<string, {readonly revision: string; readonly done: Promise<void>}>();
    const readOnce = (id: string, version: string): Promise<void> => {
        const running = inflight.get(id);
        if (running?.revision === version) return running.done;
        const done = readProvider(id).then((result) => {
            // 期间这家已经按更新的版本另发了一次：旧的晚到不能盖掉新的。
            const newer = inflight.get(id)?.revision ?? version;
            if (result !== null && !disposed && newer === version) cached.set(id, {revision: version, rows: result});
        }).finally(() => {
            if (inflight.get(id)?.done === done) inflight.delete(id);
        });
        inflight.set(id, {revision: version, done});
        return done;
    };

    const refresh = async (snapshot: ModelsSnapshot, mine: number): Promise<void> => {
        const present = new Set(snapshot.providers.map((provider) => provider.id));
        for (const id of [...cached.keys()]) if (!present.has(id)) cached.delete(id);
        // 各家并行读：多家同时变（例如启动时）不排队。每家读完就记进缓存，不管期间有没有新快照；读失败的那家保留旧结果与旧版本，
        // 下一份快照再试。记的是快照里这家的版本（不是分页响应里的，那是另一个量）：下一份快照的版本不同就重读。
        await Promise.all(staleOf(snapshot).map((provider) => readOnce(provider.id, provider.modelsRevision)));
        if (disposed || mine !== generation) return;
        const combined = snapshot.providers.flatMap((provider) => cached.get(provider.id)?.rows ?? []);
        const changed = !sameRows(rows.value, combined);
        // 一次换引用：依赖 `rows` 的刷新（例如重读会话的模型）只触发一次；内容没变就不换。
        if (changed) rows.value = combined;
        revision.value = snapshot.providers.map((provider) => `${provider.id}:${cached.get(provider.id)?.revision ?? ""}`).join("|");
        const first = !ready.value;
        ready.value = true;
        if (changed || first) notify();
        void refreshLookup();
    };

    const refreshLookup = async (): Promise<void> => {
        const snapshot = latest;
        if (snapshot === null) return;
        lookupGeneration += 1;
        const mine = lookupGeneration;
        const revisions = new Map(snapshot.providers.map((provider) => [provider.id, provider.modelsRevision] as const));
        const keep = new Set(wanted);
        for (const key of [...looked.keys()]) if (!keep.has(key)) looked.delete(key);
        const missing = wanted.filter((reference) => {
            const provider = splitReference(reference)?.provider;
            const known = looked.get(reference);
            return known === undefined || (provider !== undefined && revisions.get(provider) !== known.revision);
        });
        for (let at = 0; at < missing.length; at += MODEL_REFERENCES_MAX) {
            const chunk = missing.slice(at, at + MODEL_REFERENCES_MAX);
            const result = await options.remote.modelsByReference({references: chunk});
            if (disposed) return;
            if (!result.ok) {
                options.onFailure?.(result.code);
                return;
            }
            for (const item of result.value) {
                const provider = splitReference(item.reference)?.provider;
                looked.set(item.reference, {revision: provider === undefined ? "" : revisions.get(provider) ?? "", row: item.row});
            }
            if (mine !== lookupGeneration) return;
        }
        const next = new Map(wanted.flatMap((reference) => {
            const known = looked.get(reference);
            return known === undefined ? [] : [[reference, known.row] as const];
        }));
        const previous = lookup.value;
        if (next.size === previous.size && [...next].every(([key, row]) => previous.has(key) && previous.get(key) === row)) return;
        lookup.value = next;
        notify();
    };

    return {
        rows,
        revision,
        ready,
        lookup,
        subscribe: (listener) => {
            listeners.add(listener);
            if (!active && !disposed) {
                active = true;
                if (latest !== null) {
                    generation += 1;
                    void refresh(latest, generation);
                }
            }
            return () => void listeners.delete(listener);
        },
        attach: (snapshot) => {
            if (disposed) return false;
            latest = snapshot;
            if (!active) return false;
            generation += 1;
            const rereads = staleOf(snapshot).length > 0;
            void refresh(snapshot, generation);
            return rereads;
        },
        want: (references) => {
            wanted = [...new Set(references)];
            if (disposed || latest === null || !active) return;
            void refreshLookup();
        },
        dispose: () => {
            disposed = true;
            listeners.clear();
        },
    };
}
