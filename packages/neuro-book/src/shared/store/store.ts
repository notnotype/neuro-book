/**
 * 插件状态 store（docs/specs/state/store.md）：插件作者在一处声明一个入口的内存、持久化、派生与公开状态，只经
 * action 写。setup 写法（Pinia setup store 与 Vue 组合式 API 的写法），响应式用 `@vue/reactivity`；不用 Pinia：
 * 这里的 store 归插件私有、随入口代次创建与释放，而 Pinia 是全局注册表里的单例。
 *
 * 浏览器里 store 必须与 Vue 组件共用同一份响应式运行时，否则组件里读 store 的 computed 不刷新：`vite.config.ts`
 * 的预构建清单把 `@vue/reactivity` 与 `vue` 一起列出。
 */

import {effectScope, readonly} from "@vue/reactivity";
import type {DeepReadonly, UnwrapRef} from "@vue/reactivity";

import type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext} from "@notnotype/nb-runtime/plugins";

import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import type {PublicStateBinding} from "nbook/plugins/state/shared/contracts";
import type {RecordDefinition, StorageService} from "nbook/shared/storage";

import {PersistedFieldState} from "./persisted";
import type {PersistedField, PersistedFieldView, PersistOptions} from "./persisted";
import {bindingsOf} from "./public";
import type {PublicBindings, PublicDeclarations, PublicState} from "./public";

export {StoreClosedError} from "./persisted";
export type {CommitResult, FieldSnapshot, PersistedField, PersistedFieldView, PersistOptions, SaveState} from "./persisted";
export {definePublicState} from "./public";
export type {PublicBindings, PublicDeclarations, PublicState} from "./public";

/** setup 能用的全部外部接触：不自己做 I/O，不持有入口之外的资源。 */
export interface StoreSetupContext {
    persist<T>(record: RecordDefinition<T>, options: PersistOptions<T>): PersistedField<T>;
    publish<D extends PublicDeclarations>(state: PublicState<D>, bindings: PublicBindings<D>): void;
}

type Actions = Readonly<Record<string, (...args: never[]) => unknown>>;

export interface StoreShape<S extends object, A extends Actions> {
    readonly state: S;
    readonly actions: A;
}

/** 读取方看到的状态：ref 解包后只读；持久化字段只剩数据。 */
export type StoreView<S> = {
    readonly [K in keyof S]: S[K] extends PersistedField<infer T> ? PersistedFieldView<T> : DeepReadonly<UnwrapRef<S[K]>>;
};

export interface StoreOptions {
    /** 入口解析到的 Storage 服务；setup 里用了 `persist` 时必须给。 */
    readonly storage?: StorageService;
    /** 写 store 的诊断（`publish` 多出的键、停止时没有发出的修改）。 */
    readonly diagnostics: DiagnosticsService;
}

export interface Store<S extends object, A extends Actions> {
    readonly state: StoreView<S>;
    readonly actions: A;
    /** 交给内核的激活产出里 `state.public` 的那一项；没有公开键时为空对象。 */
    readonly contributions: Readonly<Record<string, Readonly<Record<string, PublicStateBinding>>>>;
}

export interface StoreDefinition<S extends object, A extends Actions> {
    readonly name: string;
    /** 在入口的 `activate` 里调用：运行一次 setup，store 登记在 `context.scope` 上、随这一代入口释放。 */
    create(context: ActivationContext, options: StoreOptions): Store<S, A>;
}

const STORE_NAME = /^[a-z][a-z0-9-]{0,63}$/u;

/** 入口开始停止后调用 action：已不再接受修改（输出第 17 条）。 */
export class StoreStoppedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StoreStoppedError";
    }
}

export function defineStore<S extends object, A extends Actions>(name: string, setup: (context: StoreSetupContext) => StoreShape<S, A>): StoreDefinition<S, A> {
    if (!STORE_NAME.test(name)) throw new TypeError(`store 名 ${name} 不合规则：小写字母开头，其余为小写字母、数字与 -，至多 64 个字符`);
    return {name, create: (context, options) => createStore(name, setup, context, options)};
}

function createStore<S extends object, A extends Actions>(
    name: string,
    setup: (context: StoreSetupContext) => StoreShape<S, A>,
    context: ActivationContext,
    options: StoreOptions,
): Store<S, A> {
    const label = `${context.plugin} 的 store ${name}`;
    const record = (level: "warn" | "error", event: string, message: string, data?: unknown, error?: unknown): void => {
        options.diagnostics.record({level, event, message, data, error, source: {plugin: context.plugin, entry: context.entry}});
    };
    const fields: PersistedFieldState<unknown>[] = [];
    const views = new WeakMap<object, PersistedFieldView<unknown>>();
    const published = new Map<string, PublicStateBinding>();
    let inSetup = true;
    const setupContext: StoreSetupContext = {
        persist: (definition, persistOptions) => {
            if (!inSetup) throw new TypeError(`${label}：persist 只能在 setup 里调用`);
            const field = new PersistedFieldState(definition, persistOptions, `${label} 的字段 ${definition.key}`);
            fields.push(field as PersistedFieldState<unknown>);
            views.set(field.handle, field.view as PersistedFieldView<unknown>);
            return field.handle;
        },
        publish: (state, bindings) => {
            if (!inSetup) throw new TypeError(`${label}：publish 只能在 setup 里调用`);
            const given = bindingsOf(state, bindings);
            for (const [key, binding] of given.bindings) {
                if (published.has(key)) throw new TypeError(`${label}：公开键 ${key} 绑定了两次`);
                published.set(key, binding);
            }
            if (given.extra.length > 0) {
                record("warn", "store.publish-undeclared", `${label} 绑定了没有声明的公开键，已忽略`, {keys: given.extra.map((extra) => `${state.plugin}/${extra}`)});
            }
        },
    };

    // setup 里建立的 computed、watch 随 store 释放一起停止。
    const scope = effectScope(true);
    let shape: StoreShape<S, A>;
    try {
        shape = scope.run(() => setup(setupContext)) as StoreShape<S, A>;
    } catch (error) {
        scope.stop();
        throw error;
    } finally {
        inSetup = false;
    }
    if (fields.length > 0 && options.storage === undefined) {
        scope.stop();
        throw new TypeError(`${label} 有持久化字段，create 时要给 storage`);
    }

    let accepting = !context.signal.aborted;
    context.signal.addEventListener("abort", () => {
        accepting = false;
    }, {once: true});
    const actions = Object.fromEntries(Object.entries(shape.actions).map(([key, action]) => [key, (...args: never[]) => {
        if (!accepting) throw new StoreStoppedError(`${label} 已开始停止，不再接受 ${key}`);
        return action(...args);
    }])) as unknown as A;

    // 字段句柄对外换成只含数据的视图；其余的 ref 与 computed 由 readonly 解包并禁止写入。
    const exposed = Object.fromEntries(Object.entries(shape.state).map(([key, value]) => [key, typeof value === "object" && value !== null && views.has(value) ? views.get(value) : value]));
    const state = readonly(exposed) as unknown as StoreView<S>;

    context.scope.register({
        kind: "plugin-store",
        label,
        value: fields,
        release: async (owned) => {
            accepting = false;
            const cancelled = await Promise.all(owned.map((field) => field.flush()));
            const total = cancelled.reduce((sum, count) => sum + count, 0);
            if (total > 0) record("warn", "store.intents-cancelled", `${label} 停止时有 ${String(total)} 条修改没有发出`, {cancelled: total});
            for (const field of owned) field.close();
            scope.stop();
        },
    });
    for (const field of fields) {
        field.attach(options.storage as StorageService, (event, error) => record("error", event, `${label} 的 Storage 调用抛出异常`, undefined, error));
    }

    return {state, actions, contributions: published.size === 0 ? {} : {[PUBLIC_STATE_POINT]: Object.fromEntries(published)}};
}

