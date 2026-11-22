/**
 * 设置页的数据模块（docs/specs/models/settings-pages.md）：两页共用一份，持有服务端的快照、检测结果与写入，组件只是它的
 * 消费者。所有读写都经远程合同 `nbook.models/settings`；这里不翻译文字，失败交回码与详情，由组件按当前语言写原因。
 *
 * 寿命：浏览器入口激活时建，入口停用时 `dispose`。第一次显示任一页时 `start()` 订阅快照，之后一直订阅到入口停用；检测结果
 * 随之保留（换页面、关开设置窗口都在，刷新页面才没有）。
 */

import {computed, reactive, shallowRef, toRaw} from "vue";
import type {Ref} from "vue";

import type {CheckResult, ModelRow, ModelsSnapshot, Template} from "@notnotype/nb-models/contract";
import type {RemoteClient, RemoteResultFor, RemoteSubscription} from "@notnotype/nb-runtime/remote";

import type {modelsSettingsContract} from "../shared/contracts";
import {createSelectionData} from "../shared/selection";
import type {SelectionRemote, SelectionRow} from "../shared/selection";

type Contract = typeof modelsSettingsContract;
export type ModelsRemote = RemoteClient<Contract>;
type Methods = Contract["methods"];

/** 写入或读取的失败：`code` 是远程合同的业务码或运行时码（`unavailable`、`unknown-outcome` 等），`detail` 原样。 */
export interface ModelsFailure {
    readonly code: string;
    readonly detail: unknown;
}

export type ModelsResult<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly failure: ModelsFailure};

/**
 * 一个模型的检测状态；键是 `<服务商>/<模型>`。`unknown` 是发出后被取消、没等到结果的：服务商可能已经收到了请求（与从没发过的区分开，
 * 那些保持原样）。
 */
export type CheckState =
    | {readonly status: "running"}
    | {readonly status: "done"; readonly result: CheckResult; readonly at: number}
    | {readonly status: "unknown"; readonly at: number};

/** “检测全部”的进度：`done` 是已结算的个数（通过、失败、没检成都算），`total` 是确认要检测的个数。 */
export interface CheckRun {
    readonly done: number;
    readonly total: number;
}

/** “检测全部”同时在检测的个数：请求在客户端逐个发（服务端没有批量检测），取消只停领新项。 */
export const CHECK_CONCURRENCY = 4;
/** “检测全部”超过这么多个模型时先确认（每个都是一次真实调用）。 */
export const CHECK_CONFIRM_ABOVE = 20;

/** 一家模型行的读取状态（`providerModels` 按页读完，带首页的版本）。 */
export interface ProviderRows {
    readonly rows: readonly ModelRow[];
    /** 读到这些行时快照里这家的版本；比当前版本旧时调用方会再读。 */
    readonly revision: string | null;
    readonly loading: boolean;
    readonly failure: ModelsFailure | null;
}

export type RowScope = "listed" | "available";

/**
 * 选用数据（`shared/selection.ts`）在数据模块里的样子：响应式的量写成 Vue 的 `Ref`，Lab 场景的类型检查据此把 `store` 当成不能写进
 * 场景数据的对象（页面的 `store` 由夹具造，不是场景输入）。
 */
export interface StoreSelection {
    readonly rows: Readonly<Ref<readonly SelectionRow[]>>;
    readonly lookup: Readonly<Ref<ReadonlyMap<string, ModelRow | null>>>;
    readonly ready: Readonly<Ref<boolean>>;
    subscribe(listener: () => void): () => void;
    attach(snapshot: ModelsSnapshot): void;
    want(references: readonly string[]): void;
    dispose(): void;
}

export interface ModelsStore {
    /** 服务端的快照；第一次取到之前为 null。交出的是普通对象（不是只读代理），可以直接放进远程调用的载荷。 */
    readonly snapshot: Readonly<Ref<ModelsSnapshot | null>>;
    /** 远程合同可用；订阅失败、结束或数据模块释放后为假，两页据此只读（输出 17）。 */
    readonly available: Readonly<Ref<boolean>>;
    /** 模型的检测状态，键是 `<服务商>/<模型>`；服务商或模型从快照里消失时清掉。 */
    readonly checks: ReadonlyMap<string, CheckState>;
    /**
     * 按服务商记的“没检成”：远程调用本身失败（服务停了、服务商不在了、结果未知），不是模型的检测失败。这家下一次检测开始时清掉。
     */
    readonly checkErrors: ReadonlyMap<string, ModelsFailure>;
    /** 进行中的“检测全部”，按服务商；结束（含取消）后去掉。 */
    readonly checkRuns: ReadonlyMap<string, CheckRun>;
    /**
     * 选用数据：全部启用的模型（角色页的绑定下拉）与按引用取到的行（角色页的名字与档位）。服务商的行数多，不随快照整份带；
     * 设置页的服务商详情、管理模型与全部模型按家经 `loadRows` 读。
     */
    readonly selection: StoreSelection;
    /** 模板表（添加服务商、地区与协议的选项用）；还没读到时为 null。读一次，之后不变。 */
    readonly templates: Readonly<Ref<readonly Template[] | null>>;
    /** 读模板表（重复调用不重复读；失败后下次再读）。 */
    loadTemplates(): Promise<void>;
    /** 一家的模型行；第一次显示前、读失败时为空，`loading` 与 `failure` 说明原因。 */
    rowsOf(provider: string, scope?: RowScope): ProviderRows;
    /** 读这家的行（版本没变且已读过时不重读）；组件在看到 `modelsRevision` 变了时调用。 */
    loadRows(provider: string, scope?: RowScope): Promise<void>;
    /** 订阅快照；重复调用不重复订阅。 */
    start(): Promise<void>;
    call<Name extends keyof Methods>(name: Name, input: Parameters<ModelsRemote[Name]>[0], options?: {readonly signal?: AbortSignal}): Promise<ModelsResult<ResultValue<Name>>>;
    /** 检测一个模型；它正在检测（单独的或“检测全部”里的）时不重复发。 */
    check(provider: string, model: string): Promise<void>;
    /** “检测全部”会检测的模型：这家启用的模型（先读全这家的行）。界面拿它确认个数，再原样交给 `checkAll`。 */
    checkTargets(provider: string): Promise<readonly string[]>;
    /**
     * 逐个检测 `models`（确认过的那份，不在这里重算），同时至多 `CHECK_CONCURRENCY` 个，只把在检测的标成 `running`。这家已有
     * “检测全部”在跑时不重复发，正在单独检测的模型跳过。
     */
    checkAll(provider: string, models: readonly string[]): Promise<void>;
    /**
     * 取消这家进行中的检测（给了模型只取消它的单独检测）：已发出的标 `unknown`，还没领到的保持原样、不再发。中止句柄在数据模块里，
     * 换页面回来照样能取消。
     */
    cancel(provider: string, model?: string): void;
    dispose(): void;
}

type ResultValue<Name extends keyof Methods> = Extract<RemoteResultFor<Methods[Name]>, {readonly ok: true}>["value"];

export const checkKey = (provider: string, model: string): string => `${provider}/${model}`;

export function createModelsStore(remote: ModelsRemote, now: () => number = Date.now): ModelsStore {
    const snapshot = shallowRef<ModelsSnapshot | null>(null);
    const available = shallowRef(true);
    const templates = shallowRef<readonly Template[] | null>(null);
    let loadingTemplates: Promise<void> | null = null;
    const rowCache = reactive(new Map<string, {revision: string | null; rows: readonly ModelRow[]; loading: boolean; failure: ModelsFailure | null}>());
    // 选用数据的量用 `shallowRef` 造，所以可以当 `Ref` 交出（`StoreSelection` 的说明）。
    const selection = createSelectionData({
        remote: remote as unknown as SelectionRemote,
        ref: (initial) => shallowRef(initial),
        usable: false,
        // 只有角色页要选用数据：它订阅之前不读，打开“服务商与模型”不会把每家的模型都读一遍。
        lazy: true,
    }) as unknown as StoreSelection;
    const checks = reactive(new Map<string, CheckState>());
    const checkErrors = reactive(new Map<string, ModelsFailure>());
    const checkRuns = reactive(new Map<string, CheckRun>());
    /** 进行中的检测：单独检测按 `<服务商>/<模型>`，“检测全部”按服务商 id。 */
    const controllers = new Map<string, AbortController>();
    let started: Promise<void> | null = null;
    let subscription: RemoteSubscription | null = null;
    let disposed = false;

    /** 换上新快照，清掉已经不在的服务商与模型的检测结果（同 id 重新加回来时不带出旧结果）。 */
    const apply = (next: ModelsSnapshot): void => {
        snapshot.value = next;
        selection.attach(next);
        const providers = new Set(next.providers.map((provider) => provider.id));
        // 服务商不在了：它的检测结果与已读的行一起清掉。模型层面的清理在行重读之后（`loadRows`）。
        for (const key of [...checks.keys()]) {
            if (providers.has(key.slice(0, key.indexOf("/")))) continue;
            controllers.get(key)?.abort();
            checks.delete(key);
        }
        for (const [key, controller] of [...controllers]) if (!key.includes("/") && !providers.has(key)) controller.abort();
        for (const provider of [...checkErrors.keys()]) if (!providers.has(provider)) checkErrors.delete(provider);
        for (const key of [...rowCache.keys()]) if (!providers.has(key.slice(0, key.indexOf("\n")))) rowCache.delete(key);
    };

    const refresh = async (): Promise<void> => {
        const result = await remote.snapshot({});
        if (result.ok && !disposed) apply(result.value);
    };

    const loadTemplates = (): Promise<void> => {
        if (templates.value !== null) return Promise.resolve();
        loadingTemplates ??= (async () => {
            const result = await call("templates", {});
            if (result.ok && !disposed) templates.value = result.value;
        })().finally(() => {
            loadingTemplates = null;
        });
        return loadingTemplates;
    };
    const rowKey = (provider: string, scope: RowScope): string => `${provider}\n${scope}`;
    const NO_ROWS: ProviderRows = {rows: [], revision: null, loading: false, failure: null};
    const rowsOf = (provider: string, scope: RowScope = "listed"): ProviderRows => rowCache.get(rowKey(provider, scope)) ?? NO_ROWS;
    /** 同一家同一范围同时只有一个读在跑；读的过程中版本又变了，读完后再来一轮。 */
    const loading = new Map<string, Promise<void>>();
    const loadRows = (provider: string, scope: RowScope = "listed"): Promise<void> => {
        const key = rowKey(provider, scope);
        const running = loading.get(key);
        if (running !== undefined) return running;
        const run = (async (): Promise<void> => {
            for (let round = 0; round < 3 && !disposed; round += 1) {
                const target = snapshot.value?.providers.find((item) => item.id === provider);
                if (target === undefined) return;
                const known = rowCache.get(key);
                if (known?.revision === target.modelsRevision && known.failure === null) return;
                rowCache.set(key, {revision: known?.revision ?? null, rows: known?.rows ?? [], loading: true, failure: null});
                const collected: ModelRow[] = [];
                let pinned: string | undefined;
                let failure: ModelsFailure | null = null;
                for (let offset: number | null = 0; offset !== null && !disposed;) {
                    const page: ModelsResult<{rows: ModelRow[]; revision: string; nextOffset: number | null; total: number}> = await call("providerModels", {provider, scope, offset, limit: 200, ...(pinned === undefined ? {} : {revision: pinned})});
                    if (!page.ok) {
                        failure = page.failure;
                        break;
                    }
                    pinned = page.value.revision;
                    collected.push(...page.value.rows);
                    offset = page.value.nextOffset;
                }
                // 读的过程中这家换代了：整家重读（最多三轮）。
                if (failure?.code === "revision-changed") continue;
                if (failure !== null) {
                    rowCache.set(key, {revision: known?.revision ?? null, rows: known?.rows ?? [], loading: false, failure});
                    return;
                }
                rowCache.set(key, {revision: target.modelsRevision, rows: collected, loading: false, failure: null});
                if (scope === "listed") {
                    const present = new Set(collected.map((row) => checkKey(provider, row.id)));
                    for (const checkedKey of [...checks.keys()]) {
                        if (!checkedKey.startsWith(`${provider}/`) || present.has(checkedKey)) continue;
                        controllers.get(checkedKey)?.abort();
                        checks.delete(checkedKey);
                    }
                }
                if (snapshot.value?.providers.find((item) => item.id === provider)?.modelsRevision === target.modelsRevision) return;
            }
            // 三轮都撞上换代：不能停在“读取中”，交出失败让页面写原因、给“重试”。
            const left = rowCache.get(key);
            if (left?.loading === true) rowCache.set(key, {...left, loading: false, failure: {code: "revision-changed", detail: ""}});
        })().finally(() => {
            loading.delete(key);
        });
        loading.set(key, run);
        return run;
    };

    const start = (): Promise<void> => {
        if (disposed) return Promise.resolve();
        started ??= (async () => {
            let ended = false;
            const result = await remote.events.changed.subscribe({}, (payload) => {
                if (!disposed) apply(payload);
            }, {
                // 重连后订阅已重建：重取一次，补上断开期间的变化。
                onResync: () => void refresh(),
                onEnd: () => {
                    ended = true;
                    available.value = false;
                    // 下一次显示页面时重新订阅（服务端入口重启之后）。
                    started = null;
                    subscription = null;
                },
            });
            if (!result.ok) {
                available.value = false;
                started = null;
                return;
            }
            // 迟到的订阅：释放之后才回来，或者回来之前已经结束了。
            if (disposed || ended) {
                result.value.release();
                return;
            }
            subscription = result.value;
            available.value = true;
            void loadTemplates();
        })();
        return started;
    };

    const call = async <Name extends keyof Methods>(name: Name, input: Parameters<ModelsRemote[Name]>[0], options: {readonly signal?: AbortSignal} = {}): Promise<ModelsResult<ResultValue<Name>>> => {
        const method = remote[name] as (input: unknown, options?: {readonly signal?: AbortSignal}) => Promise<RemoteResultFor<Methods[Name]>>;
        const result = await method(input, options.signal === undefined ? undefined : {signal: options.signal});
        if (result.ok) return {ok: true, value: result.value as ResultValue<Name>};
        // 写请求发出后结果未知：可能已经写了，重取快照，界面以服务端为准（输出 15）。
        if (result.code === "unknown-outcome") void refresh();
        return {ok: false, failure: {code: result.code, detail: result.detail}};
    };

    /**
     * 把一批模型标成进行中，交回收尾函数：`settle(key, state)` 只在这个键仍是自己标的那个 `running` 时才改（别的检测或快照清理
     * 已经改过就不动），`state` 为 undefined 时回到开始之前。
     */
    const begin = (keys: readonly string[]) => {
        const marks = new Map(keys.map((key) => [key, {previous: checks.get(key), mark: {status: "running"} as CheckState}]));
        for (const [key, {mark}] of marks) checks.set(key, mark);
        return (key: string, state: CheckState | undefined): void => {
            const entry = marks.get(key);
            // `checks` 是响应式的 Map，`get` 交回代理：比原对象。
            const currentState = checks.get(key);
            if (entry === undefined || currentState === undefined || toRaw(currentState) !== entry.mark) return;
            const next = state ?? entry.previous;
            if (next === undefined) checks.delete(key);
            else checks.set(key, next);
        };
    };

    /** 发一个检测并结算它：中止的标 `unknown`；远程调用本身失败（没检成）回到原样，原因按服务商记。 */
    const runCheck = async (provider: string, model: string, signal: AbortSignal): Promise<void> => {
        const key = checkKey(provider, model);
        const settle = begin([key]);
        const result = await call("check", {provider, model}, {signal});
        if (signal.aborted) return settle(key, {status: "unknown", at: now()});
        if (!result.ok) {
            settle(key, undefined);
            checkErrors.set(provider, result.failure);
            return;
        }
        settle(key, {status: "done", at: now(), result: result.value});
    };

    const check = async (provider: string, model: string): Promise<void> => {
        const key = checkKey(provider, model);
        if (checks.get(key)?.status === "running") return;
        checkErrors.delete(provider);
        const controller = new AbortController();
        controllers.set(key, controller);
        await runCheck(provider, model, controller.signal);
        if (controllers.get(key) === controller) controllers.delete(key);
    };

    const checkTargets = async (provider: string): Promise<readonly string[]> => {
        await loadRows(provider);
        return rowsOf(provider).rows.filter((item) => item.enabled).map((item) => item.id);
    };

    const checkAll = async (provider: string, models: readonly string[]): Promise<void> => {
        if (controllers.has(provider) || models.length === 0) return;
        checkErrors.delete(provider);
        const controller = new AbortController();
        controllers.set(provider, controller);
        const pending = [...models];
        checkRuns.set(provider, {done: 0, total: pending.length});
        const tick = (): void => {
            const run = checkRuns.get(provider);
            if (run !== undefined && controllers.get(provider) === controller) checkRuns.set(provider, {...run, done: run.done + 1});
        };
        const worker = async (): Promise<void> => {
            for (let model = pending.shift(); model !== undefined && !controller.signal.aborted; model = pending.shift()) {
                // 跳过的也算进进度：正在单独检测的（它自己会结算）；名单是开始时定的，领到时读到的行里它已被停用或移出的（检测要
                // 几十秒，期间可能改过）不再发。还没读过行时照名单发。
                const rows = rowsOf(provider);
                const wanted = rows.revision === null || rows.rows.some((item) => item.id === model && item.enabled);
                if (wanted && checks.get(checkKey(provider, model))?.status !== "running") await runCheck(provider, model, controller.signal);
                tick();
            }
        };
        await Promise.all(Array.from({length: Math.min(CHECK_CONCURRENCY, pending.length)}, worker));
        if (controllers.get(provider) === controller) {
            controllers.delete(provider);
            checkRuns.delete(provider);
        }
    };

    const cancel = (provider: string, model?: string): void => {
        if (model !== undefined) {
            controllers.get(checkKey(provider, model))?.abort();
            return;
        }
        for (const [key, controller] of controllers) if (key === provider || key.startsWith(`${provider}/`)) controller.abort();
    };

    return {
        // 用 computed 交出原对象：`readonly()` 是深只读代理，放进载荷后 structuredClone 不了（Lab 的替身、进程内的传输）。
        snapshot: computed(() => snapshot.value),
        available: computed(() => available.value),
        selection,
        templates: computed(() => templates.value),
        loadTemplates,
        rowsOf,
        loadRows,
        checks,
        checkErrors,
        checkRuns,
        start,
        call,
        check,
        checkTargets,
        checkAll,
        cancel,
        dispose: () => {
            disposed = true;
            selection.dispose();
            available.value = false;
            for (const controller of controllers.values()) controller.abort();
            subscription?.release();
            subscription = null;
        },
    };
}

/** 业务失败的详情多是 `{detail: string}`；拿不到时给码本身。 */
export function detailText(detail: unknown): string {
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && detail !== null && "detail" in detail && typeof (detail as {detail: unknown}).detail === "string") return (detail as {detail: string}).detail;
    return "";
}
