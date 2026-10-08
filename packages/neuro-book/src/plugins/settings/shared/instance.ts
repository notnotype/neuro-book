/**
 * 一个内核实例里的配置（docs/specs/settings/configuration.md 输出 6–8、11、12、15–17，“时序与寿命”）：订阅本实例
 * 需要的层，合成有效值，按调用方交出配置服务。三个位置共用：层在本实例时是本地拥有者，不在时是远程服务。
 *
 * 层状态放在 `@vue/reactivity` 的 shallowRef 里：`get`、`inspect` 读它们，在 computed 或 effect 里读时随层更新重新
 * 求值。`onDidChange` 另按有效值逐键比较，只在值变了时调用。
 *
 * 就绪：激活等每层“订阅建立并收到第一份快照”，各层至多 `firstSnapshotMs`。订阅本身没有截止（内核的激活期调用上限
 * 只管方法调用），超时的层记为 unavailable、按默认值继续，订阅不取消，快照晚到时照常应用。建立失败或被结束的
 * 远程层，在窗口连接回到在线时重新订阅：内核只重建已建立的订阅，建立失败的不在其中。
 */

import {shallowRef} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {providePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import type {WindowConnection} from "nbook/shared/host";
import type {DeepReadonly, LayerInspection, SettingDefinition, SettingInspection, SettingLayer, SettingsService, SettingUpdateOptions, SettingWriteResult} from "nbook/shared/settings";

import {settingsKey} from "./contracts";
import {canonical, effectiveOf, supersedes, writeProblem} from "./layers";
import type {DeclaredSetting, LayerEdit, LayerSnapshot, LayerWriteResult} from "./layers";

export type LinkSubscribe =
    | {readonly ok: true; release(): void}
    /** `retry`：原因是连接类的，连接恢复后值得再订阅一次。 */
    | {readonly ok: false; readonly code: string; readonly detail: string; readonly retry: boolean};

/** 到一层拥有者的一条路：本地拥有者或远程服务。 */
export interface LayerLink {
    /** 先推一次当前快照，之后推送每次发布；`onEnd` 至多调用一次，`retry` 同上。 */
    subscribe(onSnapshot: (snapshot: LayerSnapshot) => void, onEnd: (reason: string, retry: boolean) => void): Promise<LinkSubscribe>;
    /** 以调用方的身份写；成功带回写后的层快照。 */
    write(consumer: ConsumerIdentity, key: string, edit: LayerEdit): Promise<LayerWriteResult>;
}

export interface SettingsInstanceOptions {
    readonly layers: Readonly<Partial<Record<SettingLayer, LayerLink>>>;
    /** 已接受的声明；插件集合在实例的一生里不变（热插拔实现后改为随登记失效）。 */
    readonly declarations: ReadonlyMap<string, DeclaredSetting>;
    readonly clock: RuntimeClock;
    readonly firstSnapshotMs: number;
    /** 浏览器窗口的连接状态；没有时（服务端、项目实例）失败的层不重新订阅。 */
    readonly connection?: WindowConnection;
    readonly record: (level: "info" | "warn", event: string, message: string, data?: unknown, error?: unknown) => void;
}

export interface SettingsFacade {
    readonly service: SettingsService;
    /** 之后 `get` 返回最后的值，`update` 为 unavailable，`onDidChange` 不再调用。幂等。 */
    release(): void;
}

export interface SettingsInstance {
    /** 每层收到第一份快照、或超时、或失败之后完成；不会 reject。 */
    readonly ready: Promise<void>;
    facade(consumer: ConsumerIdentity): SettingsFacade;
    /** 结束订阅与计时；幂等。 */
    close(): void;
}

type LayerState = {readonly status: "pending" | "unavailable"} | {readonly status: "live"; readonly snapshot: LayerSnapshot};

const LAYERS: ReadonlyArray<SettingLayer> = ["user", "project"];

interface Registration {
    readonly listener: (keys: ReadonlySet<string>) => void;
}

export function createSettingsInstance(options: SettingsInstanceOptions): SettingsInstance {
    const states = new Map<SettingLayer, ShallowRef<LayerState>>();
    for (const layer of LAYERS) if (options.layers[layer] !== undefined) states.set(layer, shallowRef<LayerState>({status: "pending"}));
    // 每次登记一项：同一个函数被两个调用方各登记一次是两项，一方取消或释放不影响另一方。
    const listeners = new Set<Registration>();
    let closed = false;

    /** 本实例各层此刻的值；没有这一层或不可用时不出现。 */
    const layerValues = (): Partial<Record<SettingLayer, Readonly<Record<string, unknown>>>> => {
        const values: Partial<Record<SettingLayer, Readonly<Record<string, unknown>>>> = {};
        for (const [layer, state] of states) if (state.value.status === "live") values[layer] = (state.value as {snapshot: LayerSnapshot}).snapshot.values;
        return values;
    };

    /** 全部已声明项的有效值（规范化文本），用来算出一次层更新改了哪些键。 */
    const effectiveTexts = (): Map<string, string> => {
        const values = layerValues();
        return new Map([...options.declarations].map(([key, declared]) => [key, canonical(effectiveOf(key, declared.declaration, values).value)]));
    };
    let lastEffective = effectiveTexts();

    const setState = (layer: SettingLayer, next: LayerState): void => {
        const state = states.get(layer);
        if (state === undefined || closed) return;
        state.value = next;
        const effective = effectiveTexts();
        const changed = new Set([...effective].filter(([key, text]) => lastEffective.get(key) !== text).map(([key]) => key));
        lastEffective = effective;
        if (changed.size === 0) return;
        for (const registration of [...listeners]) {
            try {
                registration.listener(changed);
            } catch (error) {
                options.record("warn", "settings.listener.failed", "配置变化的监听出错", {keys: [...changed]}, error);
            }
        }
    };

    /** 同一启动标识下修订号更大才替换：写入结果与订阅推送乱序到达时不倒退。 */
    const apply = (layer: SettingLayer, snapshot: LayerSnapshot): void => {
        const current = states.get(layer)?.value;
        const revision = current?.status === "live" ? current.snapshot.revision : null;
        if (supersedes(snapshot.revision, revision)) setState(layer, {status: "live", snapshot});
    };

    // 每层的订阅与就绪。
    let pendingFirst = states.size;
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
        if (pendingFirst === 0) resolve();
    });
    const connections = new Map<SettingLayer, {token: number; handle: {release(): void} | null; retry: boolean; first: boolean; cancelDeadline: (() => void) | null}>();

    const firstDone = (layer: SettingLayer): void => {
        const connection = connections.get(layer);
        if (connection === undefined || connection.first) return;
        connection.first = true;
        connection.cancelDeadline?.();
        connection.cancelDeadline = null;
        pendingFirst -= 1;
        if (pendingFirst === 0) resolveReady();
    };

    /** 层不可用时不再用它上一次的值：订阅已结束，之后的修改收不到，留着旧值会与别的实例分歧。 */
    const unavailable = (layer: SettingLayer, reason: string): void => {
        setState(layer, {status: "unavailable"});
        options.record("warn", "settings.layer.unavailable", "配置层不可用，按默认值与其它层继续", {layer, reason});
    };

    const connect = async (layer: SettingLayer, link: LayerLink): Promise<void> => {
        const connection = connections.get(layer);
        if (connection === undefined || closed) return;
        const token = (connection.token += 1);
        connection.retry = false;
        let ended = false;
        const result = await link.subscribe(
            (snapshot) => {
                if (connection.token !== token || closed) return;
                apply(layer, snapshot);
                firstDone(layer);
            },
            (reason, retry) => {
                if (connection.token !== token || ended) return;
                ended = true;
                connection.handle = null;
                connection.retry = retry;
                unavailable(layer, reason);
                firstDone(layer);
            },
        );
        if (connection.token !== token || closed || ended) {
            if (result.ok) result.release();
            return;
        }
        if (!result.ok) {
            connection.retry = result.retry;
            unavailable(layer, `${result.code}：${result.detail}`);
            firstDone(layer);
            return;
        }
        connection.handle = result;
    };

    for (const layer of states.keys()) {
        const link = options.layers[layer]!;
        const connection = {token: 0, handle: null, retry: false, first: false, cancelDeadline: null as (() => void) | null};
        connections.set(layer, connection);
        connection.cancelDeadline = options.clock.schedule(() => {
            if (connection.first) return;
            unavailable(layer, `${String(options.firstSnapshotMs)} 毫秒内没有收到第一份快照`);
            firstDone(layer);
        }, options.firstSnapshotMs);
        void connect(layer, link);
    }

    const stopListening = options.connection?.onChange((state) => {
        if (state !== "online") return;
        for (const [layer, connection] of connections) {
            if (connection.retry && connection.handle === null) void connect(layer, options.layers[layer]!);
        }
    });

    const inspectLayer = <T>(layer: SettingLayer, key: string): LayerInspection<T> => {
        const state = states.get(layer)?.value;
        if (state === undefined) return {status: "absent"};
        if (state.status !== "live") return {status: "unavailable"};
        const values = state.snapshot.values;
        const value = Object.hasOwn(values, key) ? {value: values[key] as DeepReadonly<T>} : {};
        return state.snapshot.status === "ok" ? {status: "ok", ...value} : {status: "invalid", detail: state.snapshot.detail, ...value};
    };

    const facade = (consumer: ConsumerIdentity): SettingsFacade => {
        let released = false;
        const own = new Set<Registration>();
        const declarationOf = <T>(setting: SettingDefinition<T>) => options.declarations.get(setting.key)?.declaration ?? setting.declaration;

        const service: SettingsService = {
            get: <T>(setting: SettingDefinition<T>) => effectiveOf(setting.key, declarationOf(setting), layerValues()).value as DeepReadonly<T>,
            inspect: <T>(setting: SettingDefinition<T>): SettingInspection<T> => {
                const declaration = declarationOf(setting);
                const effective = effectiveOf(setting.key, declaration, layerValues());
                return {
                    value: effective.value as DeepReadonly<T>,
                    source: effective.source,
                    default: declaration.default as DeepReadonly<T>,
                    user: inspectLayer<T>("user", setting.key),
                    project: inspectLayer<T>("project", setting.key),
                };
            },
            onDidChange: (listener) => {
                const registration: Registration = {listener};
                listeners.add(registration);
                own.add(registration);
                return () => {
                    listeners.delete(registration);
                    own.delete(registration);
                };
            },
            update: async <T>(setting: SettingDefinition<T>, value: T | undefined, update: SettingUpdateOptions = {}): Promise<SettingWriteResult> => {
                if (closed) return {ok: false, code: "unavailable", detail: "配置服务已停止"};
                const declared = options.declarations.get(setting.key);
                const requested: LayerEdit = value === undefined ? {kind: "delete"} : {kind: "set", value};
                const layer = declared === undefined ? "user" : targetLayer(setting.key, declared, update.layer ?? "auto");
                const problem = writeProblem(consumer.plugin, setting.key, declared, requested, layer);
                if (problem !== null) return {ok: false, ...problem};
                const link = options.layers[layer];
                if (link === undefined) return {ok: false, code: layer === "project" ? "no-project" : "unavailable", detail: layer === "project" ? "这个实例没有项目层" : "这个实例没有用户层"};
                // 先复制一份：排队与传输期间调用方再改原对象不影响这次写入。
                const edit: LayerEdit = value === undefined ? {kind: "delete"} : {kind: "set", value: structuredClone(value)};
                const result = await link.write(consumer, setting.key, edit);
                if (!result.ok) return result;
                apply(layer, result.snapshot);
                return {ok: true};
            },
        };

        const targetLayer = (key: string, declared: DeclaredSetting, requested: SettingLayer | "auto"): SettingLayer => {
            if (requested !== "auto") return requested;
            const project = states.get("project")?.value;
            const inProject = project?.status === "live" && Object.hasOwn(project.snapshot.values, key);
            if (declared.declaration.layers.includes("project") && (inProject || !declared.declaration.layers.includes("user"))) return "project";
            return "user";
        };

        return {
            service,
            release: () => {
                if (released) return;
                released = true;
                for (const registration of own) listeners.delete(registration);
                own.clear();
            },
        };
    };

    return {
        ready,
        facade,
        close: () => {
            if (closed) return;
            closed = true;
            stopListening?.();
            listeners.clear();
            for (const connection of connections.values()) {
                connection.cancelDeadline?.();
                connection.handle?.release();
                connection.handle = null;
            }
            resolveReady();
        },
    };
}

/** 按调用方交出配置服务：每个调用方一个门面，门面随调用方入口的这一代释放。 */
export function provideSettings(instance: SettingsInstance) {
    const facades = new WeakMap<SettingsService, SettingsFacade>();
    return providePerConsumer(
        settingsKey,
        (consumer): SettingsService => {
            const facade = instance.facade(consumer);
            facades.set(facade.service, facade);
            return facade.service;
        },
        {release: (service) => facades.get(service)?.release()},
    );
}

/** 第一份快照至多等多久（输出 16）。 */
export const FIRST_SNAPSHOT_MS = 3_000;

/** 实例的诊断写到本插件名下。 */
export function recordTo(diagnostics: DiagnosticsService, plugin: string): SettingsInstanceOptions["record"] {
    return (level, event, message, data, error) => {
        diagnostics.record({level, event, message, data, error, source: {plugin}});
    };
}
