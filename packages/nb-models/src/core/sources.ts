/**
 * 模型来源（docs/specs/models/service.md“模型来源”）：每家服务商的列表缓存、在线目录，以及何时去拉、拉到的什么时候算数。服务核心
 * 按这里交出的列表与目录视图算成员（`members.ts`），这里不碰配置的写入。
 *
 * 有效性分两层：
 * - **部署**（`uid`、列表的协议与变体、有效地址）：缓存只给同一个部署用；换了地址或协议，旧列表不用，成员退回目录。
 * - **凭据**（密钥与生效的请求头的 HMAC）：换了账号旧列表照用，状态标 `changed`，等用户重新拉取（设密钥时自动拉）。
 *
 * 时序：每个 `uid` 一个代次。拉取的结果只在代次没变、且此刻实例的部署与凭据仍与发出时相同时才提交；同一 `uid` 的写盘排成一串。
 * `close()` 先让代次全部作废、取消在途请求，限时等它们收尾，再等写盘。
 */

import type {CatalogView, ListedModel, ListingFlavor} from "@notnotype/nb-harness/models";
import {createCatalogView, fetchOnlineCatalog, listModels, OnlineCatalogError, parseOnlineCatalog} from "@notnotype/nb-harness/models";
import type {OnlineCatalog} from "@notnotype/nb-harness/models";
import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {ProviderConfig} from "../config/shapes";
import type {ListingState} from "../contract/shapes";

/** 一次列表请求的截止（从受理起算，覆盖连接、读体与解析）。 */
const LISTING_TIMEOUT_MS = 30_000;
const CATALOG_TIMEOUT_MS = 60_000;
/** 自动更新的间隔：列表与在线目录超过这么久没拉成功（或没试过）就在后台再拉。 */
export const SOURCE_STALE_MS = 24 * 60 * 60 * 1000;
/** 检查是否过期的周期。 */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** 停止时等在途请求收尾的上限。 */
const CLOSE_WAIT_MS = 2_000;

/**
 * 来源文件的存放（应用给：状态根下的目录）。`read` 没有这个文件时交回 null；读坏了、写失败抛错。`write` 要原子（同目录暂存再改名），
 * 崩溃时不留下半个文件。
 */
export interface SourceStore {
    read(uid: string): Promise<unknown>;
    write(uid: string, value: unknown): Promise<void>;
    remove(uid: string): Promise<void>;
    /** 现有的缓存文件对应的 `uid`。 */
    list(): Promise<readonly string[]>;
    readCatalog(): Promise<unknown>;
    writeCatalog(value: unknown): Promise<void>;
}

const ListedRowSchema = Type.Object({
    id: Type.String({minLength: 1, maxLength: 256}),
    name: Type.Optional(Type.String({maxLength: 512})),
    kind: Type.Union([Type.Literal("chat"), Type.Literal("other"), Type.Literal("unknown")]),
    contextWindow: Type.Optional(Type.Integer({minimum: 1})),
    maxOutput: Type.Optional(Type.Integer({minimum: 1})),
    vision: Type.Optional(Type.Boolean()),
}, {additionalProperties: false});

/** 一家的列表缓存，版本 1。只存列表原生的字段；目录补值、物化在读的时候按当前部署现算。 */
const SourceCacheSchema = Type.Object({
    version: Type.Literal(1),
    uid: Type.String({minLength: 1}),
    deployment: Type.String({minLength: 1}),
    credential: Type.String({minLength: 1}),
    checkedAt: Type.Integer({minimum: 0}),
    rows: Type.Array(ListedRowSchema, {maxItems: 5000}),
}, {additionalProperties: false});
type SourceCache = Static<typeof SourceCacheSchema>;

/** 在线目录的本地副本：取到的原字节（base64）与 ETag，验证过才写。 */
const CatalogCacheSchema = Type.Object({
    version: Type.Literal(1),
    etag: Type.Union([Type.String(), Type.Null()]),
    fetchedAt: Type.Integer({minimum: 0}),
    bytes: Type.String({maxLength: 12 * 1024 * 1024}),
}, {additionalProperties: false});
type CatalogCache = Static<typeof CatalogCacheSchema>;

/** 一个实例此刻的部署与凭据身份，以及发列表请求要的东西（没有可用凭据时 `request` 为 null）。 */
export interface SourceDeployment {
    readonly deployment: string;
    readonly credential: string;
    readonly request: {readonly flavor: ListingFlavor; readonly baseUrl: string; readonly headers: Readonly<Record<string, string>>} | null;
}

export interface SourcesDeps {
    /** 不给时只在内存里（测试、没有状态根的宿主）。 */
    readonly store?: SourceStore;
    readonly now: () => number;
    readonly record: (level: "info" | "warn", event: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
    /** `catalogAutoUpdate` 设置项；每次现读。 */
    readonly autoUpdate: () => boolean;
    readonly providers: () => readonly ProviderConfig[];
    /** 服务商设置此刻可读、可写（`editable()` 为 ok）：只有这时“不在配置里”才算确认删除，才回收缓存文件。 */
    readonly confirmed: () => boolean;
    /** 协议或地址缺了（发不了）时为 null。 */
    readonly deploymentOf: (provider: ProviderConfig) => SourceDeployment | null;
    /** 列表、状态或目录变了：服务核心作废快照。 */
    readonly changed: () => void;
    /** 在线目录的地址；缺省用 stencil 的。 */
    readonly catalogUrl?: string;
}

/** `user`：用户点了重新拉取，任何时候都受理。`implicit`：添加服务商、设密钥之后跟着拉，只在 `start()` 之后。 */
export type RefreshCause = "user" | "implicit";

export interface Sources {
    /** 读缓存与在线目录、回收孤立文件，自动更新开着时排后台拉取。服务核心交出服务之前等它。 */
    start(): Promise<void>;
    /** 当前的目录视图（打包目录加上在线目录）。 */
    view(): CatalogView;
    /** 这家此刻可用的列表（同一部署的缓存）；没有时为 null，成员退回目录。 */
    listing(provider: ProviderConfig): readonly ListedModel[] | null;
    state(provider: ProviderConfig): ListingState;
    /** 这家的列表或目录视图换过就变：模型行的版本号带上它。 */
    rowsVersion(provider: ProviderConfig): string;
    refresh(provider: ProviderConfig, cause: RefreshCause): "accepted" | "no-credentials";
    /** 删服务商之后回收它的缓存文件。 */
    collect(): Promise<void>;
    /** 自动更新的设置变了：开着就看一遍有没有过期的。 */
    autoUpdateChanged(): void;
    close(): Promise<void>;
}

interface Inflight {
    readonly key: string;
    readonly controller: AbortController;
    readonly done: Promise<void>;
}

interface Entry {
    cache: SourceCache | null;
    rows: number;
    generation: number;
    inflight: Inflight | null;
    error: ListingState["error"];
    /** 最近一次发出拉取的时间（内存里；重启后重新算）。失败的也算，免得一家坏掉的端点每小时被打一次。 */
    attemptedAt: number | null;
    writes: Promise<void>;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createSources(deps: SourcesDeps): Sources {
    const entries = new Map<string, Entry>();
    let started = false;
    let closed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let catalog: {cache: CatalogCache; parsed: OnlineCatalog} | null = null;
    let view = createCatalogView();
    let catalogVersion = 0;
    let catalogAttemptedAt: number | null = null;
    let catalogInflight: {controller: AbortController; done: Promise<void>} | null = null;
    let catalogWrites: Promise<void> = Promise.resolve();

    const entryOf = (uid: string): Entry => {
        let entry = entries.get(uid);
        if (entry === undefined) {
            entry = {cache: null, rows: 0, generation: 0, inflight: null, error: null, attemptedAt: null, writes: Promise.resolve()};
            entries.set(uid, entry);
        }
        return entry;
    };
    const keyOf = (deployment: SourceDeployment): string => `${deployment.deployment}\n${deployment.credential}`;
    /** 结果还能不能提交：没停、代次没变、实例还在且部署与凭据与发出时相同。 */
    const stillCurrent = (uid: string, entry: Entry, generation: number, key: string): boolean => {
        if (closed || entry.generation !== generation) return false;
        const provider = deps.providers().find((item) => item.uid === uid);
        const deployment = provider === undefined ? null : deps.deploymentOf(provider);
        return deployment !== null && keyOf(deployment) === key;
    };

    async function run(uid: string, entry: Entry, generation: number, deployment: SourceDeployment, controller: AbortController): Promise<void> {
        const request = deployment.request!;
        const deadline = AbortSignal.timeout(LISTING_TIMEOUT_MS);
        const result = await listModels({...request, signal: AbortSignal.any([controller.signal, deadline])});
        const key = keyOf(deployment);
        if (!stillCurrent(uid, entry, generation, key)) return;
        if (!result.ok) {
            const timedOut = result.reason === "cancelled" && deadline.aborted && !controller.signal.aborted;
            entry.error = timedOut ? {reason: "timeout", message: "the model list did not arrive in time"} : {reason: result.reason, message: result.message};
            return;
        }
        const cache: SourceCache = {version: 1, uid, deployment: deployment.deployment, credential: deployment.credential, checkedAt: deps.now(), rows: result.rows.map((row) => ({...row}))};
        const written = await write(entry, () => deps.store?.write(uid, cache));
        if (!stillCurrent(uid, entry, generation, key)) return;
        if (!written) {
            entry.error = {reason: "storage", message: "the model list could not be saved"};
            return;
        }
        entry.cache = cache;
        entry.error = null;
        entry.rows += 1;
    }

    /** 同一 `uid` 的写盘排成一串；交回是否写成（失败写诊断）。 */
    const write = (entry: Entry, work: () => Promise<void> | undefined): Promise<boolean> => {
        const done = entry.writes.then(async () => {
            try {
                await work();
                return true;
            } catch (error) {
                deps.record("warn", "models.sources.write-failed", "Saving a provider model list failed", {error: message(error)});
                return false;
            }
        });
        entry.writes = done.then(() => undefined);
        return done;
    };

    const refresh = (provider: ProviderConfig, cause: RefreshCause): "accepted" | "no-credentials" => {
        if (closed || (cause === "implicit" && !started)) return "accepted";
        const deployment = deps.deploymentOf(provider);
        if (deployment === null || deployment.request === null) return "no-credentials";
        const entry = entryOf(provider.uid);
        const key = keyOf(deployment);
        // 同一部署、同一凭据的在途请求：合并。不同的：取消旧的，新的代次接手。
        if (entry.inflight?.key === key) return "accepted";
        entry.inflight?.controller.abort();
        const generation = (entry.generation += 1);
        const controller = new AbortController();
        entry.attemptedAt = deps.now();
        const done = run(provider.uid, entry, generation, deployment, controller)
            .catch((error: unknown) => deps.record("warn", "models.sources.failed", "Fetching a provider model list failed", {error: message(error)}))
            .finally(() => {
                if (entry.inflight?.controller === controller) entry.inflight = null;
                if (!closed) deps.changed();
            });
        entry.inflight = {key, controller, done};
        deps.changed();
        return "accepted";
    };

    // ---- 在线目录 ----
    function refreshCatalog(): void {
        if (closed || catalogInflight !== null) return;
        const controller = new AbortController();
        catalogAttemptedAt = deps.now();
        const done = (async () => {
            const fetched = await fetchOnlineCatalog({etag: catalog?.cache.etag ?? null, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(CATALOG_TIMEOUT_MS)]), ...(deps.catalogUrl === undefined ? {} : {url: deps.catalogUrl})});
            if (closed) return;
            if (fetched.status === "failed") {
                deps.record("warn", "models.catalog.fetch-failed", "Fetching the online model catalog failed", {reason: fetched.reason, error: fetched.message});
                return;
            }
            if (fetched.status === 304) {
                // 没变：只有本地那份可读时才算“刚确认过”。
                if (catalog === null) return;
                const cache = {...catalog.cache, fetchedAt: deps.now()};
                if (await writeCatalog(cache)) catalog = {cache, parsed: catalog.parsed};
                return;
            }
            let parsed: OnlineCatalog;
            try {
                parsed = parseOnlineCatalog(fetched.bytes);
            } catch (error) {
                if (!(error instanceof OnlineCatalogError)) throw error;
                deps.record("warn", "models.catalog.rejected", "The online model catalog was rejected", {reason: error.reason, error: error.message});
                return;
            }
            const cache: CatalogCache = {version: 1, etag: fetched.etag, fetchedAt: deps.now(), bytes: Buffer.from(fetched.bytes).toString("base64")};
            if (!(await writeCatalog(cache)) || closed) return;
            catalog = {cache, parsed};
            view = createCatalogView(parsed);
            catalogVersion += 1;
            deps.changed();
        })()
            .catch((error: unknown) => deps.record("warn", "models.catalog.fetch-failed", "Fetching the online model catalog failed", {error: message(error)}))
            .finally(() => {
                catalogInflight = null;
            });
        catalogInflight = {controller, done};
    }
    const writeCatalog = (cache: CatalogCache): Promise<boolean> => {
        const done = catalogWrites.then(async () => {
            try {
                await deps.store?.writeCatalog(cache);
                return true;
            } catch (error) {
                deps.record("warn", "models.catalog.write-failed", "Saving the online model catalog failed", {error: message(error)});
                return false;
            }
        });
        catalogWrites = done.then(() => undefined);
        return done;
    };

    // ---- 自动更新 ----
    const stale = (at: number | null): boolean => at === null || deps.now() - at >= SOURCE_STALE_MS;
    /**
     * 看一遍过期的并在后台拉：在线目录超过一天；列表是从没拉过的，或同一部署、同一凭据的缓存超过一天。部署或凭据变了的不自动拉
     * （新部署不接手旧部署的认证，等用户重新拉取或设密钥）。最近试过、失败了的也等满一天。
     */
    function check(): void {
        if (closed || !started || !deps.autoUpdate()) return;
        if (stale(catalog?.cache.fetchedAt ?? null) && stale(catalogAttemptedAt)) refreshCatalog();
        for (const provider of deps.providers()) {
            const entry = entryOf(provider.uid);
            const deployment = deps.deploymentOf(provider);
            if (deployment === null || deployment.request === null || entry.inflight !== null || !stale(entry.attemptedAt)) continue;
            const cache = entry.cache;
            if (cache !== null && (cache.deployment !== deployment.deployment || cache.credential !== deployment.credential || !stale(cache.checkedAt))) continue;
            refresh(provider, "implicit");
        }
    }

    const collect = async (): Promise<void> => {
        if (deps.store === undefined || !deps.confirmed()) return;
        try {
            const known = new Set(deps.providers().map((provider) => provider.uid));
            for (const uid of await deps.store.list()) {
                if (known.has(uid)) continue;
                entries.get(uid)?.inflight?.controller.abort();
                entries.delete(uid);
                await deps.store.remove(uid);
            }
        } catch (error) {
            deps.record("warn", "models.sources.collect-failed", "Removing unused provider model lists failed", {error: message(error)});
        }
    };

    async function load(): Promise<void> {
        const store = deps.store;
        if (store === undefined) return;
        for (const provider of deps.providers()) {
            try {
                const value = await store.read(provider.uid);
                if (value === null) continue;
                if (!Value.Check(SourceCacheSchema, value) || value.uid !== provider.uid) {
                    deps.record("warn", "models.sources.invalid", "A provider model list file is invalid and was ignored", {provider: provider.id});
                    continue;
                }
                const entry = entryOf(provider.uid);
                entry.cache = value;
                entry.rows += 1;
            } catch (error) {
                deps.record("warn", "models.sources.read-failed", "Reading a provider model list failed", {provider: provider.id, error: message(error)});
            }
        }
        try {
            const value = await store.readCatalog();
            if (value === null) return;
            if (!Value.Check(CatalogCacheSchema, value)) throw new OnlineCatalogError("malformed", "the saved catalog has an unknown shape");
            const parsed = parseOnlineCatalog(new Uint8Array(Buffer.from(value.bytes, "base64")));
            catalog = {cache: value, parsed};
            view = createCatalogView(parsed);
            catalogVersion += 1;
        } catch (error) {
            deps.record("warn", "models.catalog.read-failed", "The saved online model catalog was ignored", {error: message(error)});
        }
    }

    return {
        start: async () => {
            if (started || closed) return;
            await load();
            await collect();
            started = true;
            check();
            timer = setInterval(check, CHECK_INTERVAL_MS);
            timer.unref?.();
            deps.changed();
        },
        view: () => view,
        listing: (provider) => {
            const cache = entries.get(provider.uid)?.cache ?? null;
            if (cache === null) return null;
            const deployment = deps.deploymentOf(provider);
            return deployment !== null && deployment.deployment === cache.deployment ? cache.rows : null;
        },
        state: (provider) => {
            const entry = entries.get(provider.uid);
            const cache = entry?.cache ?? null;
            const deployment = deps.deploymentOf(provider);
            const state = cache === null ? "none" : deployment !== null && cache.deployment === deployment.deployment && cache.credential === deployment.credential ? "ok" : "changed";
            const usable = cache !== null && deployment !== null && cache.deployment === deployment.deployment;
            return {state, refreshing: entry?.inflight != null, checkedAt: usable ? cache.checkedAt : null, error: entry?.error ?? null};
        },
        rowsVersion: (provider) => `${String(catalogVersion)}.${String(entries.get(provider.uid)?.rows ?? 0)}`,
        refresh,
        collect,
        autoUpdateChanged: check,
        close: async () => {
            if (closed) return;
            closed = true;
            if (timer !== null) clearInterval(timer);
            const pending: Promise<void>[] = [];
            for (const entry of entries.values()) {
                entry.generation += 1;
                if (entry.inflight !== null) {
                    entry.inflight.controller.abort();
                    pending.push(entry.inflight.done);
                }
            }
            if (catalogInflight !== null) {
                catalogInflight.controller.abort();
                pending.push(catalogInflight.done);
            }
            let wait: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([Promise.allSettled(pending), new Promise((resolve) => (wait = setTimeout(resolve, CLOSE_WAIT_MS)))]);
            clearTimeout(wait);
            await Promise.allSettled([...[...entries.values()].map((entry) => entry.writes), catalogWrites]);
        },
    };
}
