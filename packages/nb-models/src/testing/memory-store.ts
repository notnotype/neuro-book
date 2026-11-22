/**
 * 内存里的 `ModelsConfigStore`：一层可写的用户配置，没有的键取缺省值。给本包的服务核心测试，也给要个现成存储的使用方测试。
 * 与应用的设置存储对过契约：两边都跑 `runModelsConfigStoreContract`。
 *
 * 和真实的设置存储一样分两份：“磁盘”是写入核对 `expect` 的对象，“视图”是 `read`、`editable` 读的。自己的写入两份一起改、
 * 立刻通知；别处的写入（`writeExternally`）只改磁盘，视图要等 `catchUp()` 才跟上并通知。这段落差就是服务核心撞上
 * `conflict` 的那种时刻。
 */

import {Value} from "typebox/value";

import {DEFAULT_COMPACTION} from "../config/compaction";
import type {CompactionSetting} from "../config/compaction";
import {DEFAULT_ROLES, ProvidersSchema, RolesSchema} from "../config/shapes";
import type {RolesConfig, StoredProvider} from "../config/shapes";
import type {IconStore} from "../core/core";
import type {SourceStore} from "../core/sources";
import type {ConfigKey, ConfigSlot, ModelsConfigStore, SlotLayer, SlotWriteResult} from "../core/store";

type SlotKey = "providers" | "roles";
type Stream = ReturnType<ModelsConfigStore["stream"]>;
type Layer = {providers?: StoredProvider[]; roles?: RolesConfig};

export interface MemoryModelsConfig extends ModelsConfigStore {
    /** 别处改了可写那一层（另一个进程、用户手改文件）：只改磁盘，`undefined` 删掉这个键；视图等 `catchUp()`。 */
    writeExternally(key: SlotKey, value: unknown): void;
    /** 视图跟上磁盘，有效值变了的键经 `onChange` 通知。 */
    catchUp(): void;
    /** 可写那一层的状态：`unavailable`、`invalid` 时 `editable()` 照实交回、写入失败，读仍是原来的值。 */
    setLayer(state: "ok" | "unavailable" | "invalid"): void;
    setCompaction(value: CompactionSetting): void;
    setStream(value: Stream): void;
    setAutoUpdate(value: boolean): void;
}

export interface MemoryModelsConfigOptions {
    readonly providers?: StoredProvider[];
    readonly roles?: RolesConfig;
    readonly compaction?: CompactionSetting;
    readonly stream?: Stream;
    /** 缺省关：测试不想要的后台拉取不发生。 */
    readonly autoUpdate?: boolean;
}

/** 键按码元顺序排列的 JSON 文本：比较 `expect` 时对象的键序不算。 */
function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
        const record = item as Record<string, unknown>;
        return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
    });
}

/** 存进去的值深冻结：调用方改它会抛错，与只读的设置值一样，漏拷贝的地方在测试里就暴露。 */
function frozen<T>(value: T): T {
    const copy = structuredClone(value);
    const freeze = (item: unknown): void => {
        if (typeof item !== "object" || item === null) return;
        Object.freeze(item);
        for (const child of Object.values(item)) freeze(child);
    };
    freeze(copy);
    return copy;
}

export function memoryModelsConfig(options: MemoryModelsConfigOptions = {}): MemoryModelsConfig {
    const initial: Layer = {
        ...(options.providers === undefined ? {} : {providers: frozen(options.providers)}),
        ...(options.roles === undefined ? {} : {roles: frozen(options.roles)}),
    };
    let disk: Layer = {...initial};
    let view: Layer = {...initial};
    let state: "ok" | "unavailable" | "invalid" = "ok";
    let compaction = frozen(options.compaction ?? DEFAULT_COMPACTION);
    let stream = frozen(options.stream ?? {firstEventTimeoutSeconds: 300, idleTimeoutSeconds: 300});
    let autoUpdate = options.autoUpdate ?? false;
    const listeners = new Set<(changed: ReadonlySet<ConfigKey>) => void>();
    const defaults = {providers: frozen<StoredProvider[]>([]), roles: frozen(DEFAULT_ROLES)};
    const schemas = {providers: ProvidersSchema, roles: RolesSchema};
    const effective = (layer: Layer, key: SlotKey): string => canonical(layer[key] ?? defaults[key]);

    const notify = (changed: ReadonlySet<ConfigKey>): void => {
        if (changed.size === 0) return;
        for (const listener of [...listeners]) listener(changed);
    };
    /** 视图换成 `next`，通知有效值变了的键。 */
    const show = (next: Layer): void => {
        const changed = new Set((["providers", "roles"] as const).filter((key) => effective(view, key) !== effective(next, key)));
        view = next;
        notify(changed);
    };
    const withValue = (layer: Layer, key: SlotKey, value: unknown): Layer => {
        const next = {...layer};
        if (value === undefined) delete next[key];
        else (next as Record<SlotKey, unknown>)[key] = frozen(value);
        return next;
    };

    const slot = <T>(key: SlotKey): ConfigSlot<T> => ({
        read: () => (view[key] ?? defaults[key]) as T,
        editable: (): SlotLayer<T> => (state === "ok" ? {status: "ok", value: view[key] as T | undefined} : {status: state}),
        write: async (next, expect): Promise<SlotWriteResult> => {
            if (state === "unavailable") return {ok: false, code: "unavailable", detail: "the settings layer is unavailable"};
            if (state === "invalid") return {ok: false, code: "layer-invalid", detail: "the settings layer is invalid"};
            if (!Value.Check(schemas[key], next)) {
                return {ok: false, code: "invalid-value", detail: [...Value.Errors(schemas[key], next)].map((error) => `${error.instancePath === "" ? "/" : error.instancePath}: ${error.message}`).join("; ")};
            }
            const current = disk[key];
            const holds = expect.value === undefined ? current === undefined : current !== undefined && canonical(current) === canonical(expect.value);
            if (!holds) return {ok: false, code: "conflict"};
            disk = withValue(disk, key, next);
            // 自己的写入：视图直接换成磁盘（别处更早的改动也一起跟上，与重读整个文件一样）。
            show({...disk});
            return {ok: true};
        },
    });

    return {
        providers: slot<StoredProvider[]>("providers"),
        roles: slot<RolesConfig>("roles"),
        compaction: () => compaction,
        stream: () => stream,
        autoUpdate: () => autoUpdate,
        onChange: (listener) => {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
        writeExternally: (key, value) => {
            disk = withValue(disk, key, value);
        },
        catchUp: () => show({...disk}),
        setLayer: (next) => {
            state = next;
        },
        setCompaction: (value) => {
            const changed = canonical(value) !== canonical(compaction);
            compaction = frozen(value);
            if (changed) notify(new Set(["compaction"]));
        },
        setStream: (value) => {
            stream = frozen(value);
        },
        setAutoUpdate: (value) => {
            const changed = value !== autoUpdate;
            autoUpdate = value;
            if (changed) notify(new Set(["autoUpdate"]));
        },
    };
}

/** 内存里的图标文件存放（`IconStore`），给服务核心的测试。 */
export function memoryIconStore(): IconStore & {readonly files: ReadonlyMap<string, Uint8Array>} {
    const files = new Map<string, Uint8Array>();
    return {
        files,
        save: async (name, bytes) => void files.set(name, bytes),
        remove: async (name) => void files.delete(name),
        list: async () => [...files.keys()],
    };
}

/**
 * 内存里的来源文件存放（`SourceStore`），给服务核心的测试：读写都做深拷贝（同写盘再读回），`files` 可以直接改来模拟坏文件。
 * `failWrites` 为真时写入抛错。应用的文件实现另由 `runSourceStoreContract` 对同一合同核对。
 */
export function memorySourceStore(): SourceStore & {readonly files: Map<string, unknown>; catalog: unknown; failWrites: boolean} {
    const files = new Map<string, unknown>();
    const store = {
        files,
        catalog: null as unknown,
        failWrites: false,
        read: async (uid: string) => (files.has(uid) ? structuredClone(files.get(uid)) : null),
        write: async (uid: string, value: unknown) => {
            if (store.failWrites) throw new Error("the disk is full");
            files.set(uid, structuredClone(value));
        },
        remove: async (uid: string) => void files.delete(uid),
        list: async () => [...files.keys()],
        readCatalog: async () => structuredClone(store.catalog),
        writeCatalog: async (value: unknown) => {
            if (store.failWrites) throw new Error("the disk is full");
            store.catalog = structuredClone(value);
        },
    };
    return store;
}
