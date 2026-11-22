/**
 * 选用数据（docs/specs/models/settings-pages.md“选用数据”）：选择器、agent 标签、角色页与 Profile 页要的“哪些模型能选、绑着的模型叫什么”，
 * 按服务商分页读，不随快照整份带。纯 TS：响应式的量由调用方交进来的 `ref` 造（Vue 的 `shallowRef`），所以 `nbook.models` 与
 * `nbook.agent` 的浏览器入口各建一份，不新增服务键，models 入口仍然懒激活。
 *
 * 读法：
 * - 每次收到快照（`attach`），比对各家的 `modelsRevision`，只重读变了的那家；整批到齐后一次换掉 `rows`（只触发一次依赖它的刷新），
 *   到齐之前继续交出旧的。
 * - 一家分页读时带首页的 `revision`，中间这家变了服务端回 `revision-changed`，整家重读，最多重试 `RETRIES` 次。
 * - 又来了新快照：这一轮读到的结果作废，按新快照重来。
 * - `want` 登记要按引用取的模型（角色绑定的、Profile 指名的），按服务商版本缓存，一次不超过合同的上限。
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
}

export interface SelectionData {
    /** 当前能选的模型：按服务商在快照里的顺序、服务商内按系列、名称排。第一次读完之前为空。 */
    readonly rows: Cell<readonly SelectionRow[]>;
    /** `rows` 的版本：各家 `modelsRevision` 的拼接；读取期间的新旧交替靠它判断，调用方不解析。 */
    readonly revision: Cell<string>;
    /** 第一次读完（成功）之后为真。 */
    readonly ready: Cell<boolean>;
    /** 按引用取到的行；没有这个模型（服务商或模型不在、被移出）的值为 null。键是 `<服务商>/<模型>`。 */
    readonly lookup: Cell<ReadonlyMap<string, ModelRow | null>>;
    /** `rows` 或 `lookup` 换了之后调用（只在换引用的那一刻，不逐页）；返回取消函数。 */
    subscribe(listener: () => void): () => void;
    attach(snapshot: ModelsSnapshot): void;
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
    let disposed = false;

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

    const refresh = async (snapshot: ModelsSnapshot, mine: number): Promise<void> => {
        const present = new Set(snapshot.providers.map((provider) => provider.id));
        for (const id of [...cached.keys()]) if (!present.has(id)) cached.delete(id);
        const stale = snapshot.providers.filter((provider) => cached.get(provider.id)?.revision !== provider.modelsRevision);
        // 各家并行读：多家同时变（例如启动时）不排队。
        const results = await Promise.all(stale.map(async (provider) => [provider, await readProvider(provider.id)] as const));
        if (disposed || mine !== generation) return;
        // 读失败的那家保留旧结果与旧版本，下一份快照再试。
        // 记的是快照里这家的版本（不是分页响应里的，那是另一个量）：下一份快照的版本不同就重读。
        for (const [provider, result] of results) if (result !== null) cached.set(provider.id, {revision: provider.modelsRevision, rows: result});
        const combined = snapshot.providers.flatMap((provider) => cached.get(provider.id)?.rows ?? []);
        // 一次换引用：依赖 `rows` 的刷新（例如重读会话的模型）只触发一次。
        rows.value = combined;
        revision.value = snapshot.providers.map((provider) => `${provider.id}:${cached.get(provider.id)?.revision ?? ""}`).join("|");
        if (results.every(([, result]) => result !== null)) ready.value = true;
        notify();
        void refreshLookup(mine);
    };

    const refreshLookup = async (mine: number): Promise<void> => {
        const snapshot = latest;
        if (snapshot === null) return;
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
            if (disposed || mine !== generation) return;
            if (!result.ok) {
                options.onFailure?.(result.code);
                return;
            }
            for (const item of result.value) {
                const provider = splitReference(item.reference)?.provider;
                looked.set(item.reference, {revision: provider === undefined ? "" : revisions.get(provider) ?? "", row: item.row});
            }
        }
        lookup.value = new Map(wanted.map((reference) => [reference, looked.get(reference)?.row ?? null] as const));
        notify();
    };

    return {
        rows,
        revision,
        ready,
        lookup,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
        attach: (snapshot) => {
            if (disposed) return;
            latest = snapshot;
            generation += 1;
            void refresh(snapshot, generation);
        },
        want: (references) => {
            wanted = [...new Set(references)];
            if (disposed || latest === null) return;
            void refreshLookup(generation);
        },
        dispose: () => {
            disposed = true;
            listeners.clear();
        },
    };
}
