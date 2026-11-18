/**
 * 对话状态栏里插件加的项（docs/specs/agent/contributions.md 输出 22）：`agent.statusItems` 的接收者。每个已发布的贡献是目录里的一项
 * （声明给标题、说明、左右与缺省显隐），实现 `{load()}` 交一个组件，视图按注册表的 `statusItems` 登记项画它。设置页只要目录（声明），
 * 不加载组件，所以设置页里不会跑插件的代码。
 *
 * 句柄撤回（插件停用）时这一项从目录里消失；用户设置里关于它的显隐与次序不动（解算时按目录里有没有忽略，回来就生效）。
 */

import {defineAsyncComponent, markRaw, shallowRef} from "vue";
import type {Component, ShallowRef} from "vue";
import type {ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";
import type {StatusItemEntry, StatusLineItem} from "@notnotype/nb-agent-ui";

import type {AgentStatusItemDeclaration, AgentStatusItemImplementation} from "../shared/status-item-point";

type Handle = ContributionHandle<AgentStatusItemDeclaration, AgentStatusItemImplementation>;

export interface StatusItems {
    /** 目录里插件的项（声明）；设置页与解算用。 */
    readonly items: ShallowRef<readonly StatusLineItem[]>;
    /** 视图的注册表登记项（带组件）。 */
    readonly entries: ShallowRef<readonly StatusItemEntry[]>;
    receiver(): ContributionReceiver<AgentStatusItemDeclaration, AgentStatusItemImplementation>;
}

/** `report`：实现交得不对、组件加载失败时写诊断，不抛出：一项坏了不影响状态栏的其余项。 */
export function createStatusItems(report: (message: string) => void): StatusItems {
    const handles = new Map<string, Handle>();
    const items = shallowRef<readonly StatusLineItem[]>([]);
    const entries = shallowRef<readonly StatusItemEntry[]>([]);
    /** 同一个句柄的组件只建一次：重算目录时不让视图里的组件重新加载。 */
    const components = new WeakMap<Handle, Component>();

    const componentOf = (handle: Handle): Component => {
        let component = components.get(handle);
        if (component === undefined) {
            component = markRaw(defineAsyncComponent({
                loader: async () => {
                    const loaded = await handle.implementation().load();
                    return "default" in (loaded as object) ? (loaded as {default: Component}).default : loaded as Component;
                },
                // 不重试；`fail()` 把失败交给状态栏里这一项外面的 RenderGuard，这一项不画，别的项照常。
                onError: (error, _retry, fail) => {
                    report(`Status item ${handle.id} failed to load: ${error instanceof Error ? error.message : String(error)}`);
                    fail();
                },
            }));
            components.set(handle, component);
        }
        return component;
    };

    const rebuild = (): void => {
        const list = [...handles.values()].sort((a, b) => a.id.localeCompare(b.id));
        items.value = list.map((handle) => ({
            id: handle.id,
            side: handle.declaration.side,
            title: handle.declaration.title,
            defaultVisible: handle.declaration.defaultVisible ?? false,
            source: handle.plugin,
            ...(handle.declaration.description === undefined ? {} : {description: handle.declaration.description}),
        }));
        entries.value = list.map((handle) => ({
            id: handle.id,
            component: componentOf(handle),
            side: handle.declaration.side,
            title: handle.declaration.title,
            defaultVisible: handle.declaration.defaultVisible ?? false,
            source: handle.plugin,
            ...(handle.declaration.description === undefined ? {} : {description: handle.declaration.description}),
        }));
    };

    return {
        items,
        entries,
        receiver: () => ({
            published: (handle) => {
                const implementation = handle.implementation() as Partial<AgentStatusItemImplementation>;
                if (typeof implementation.load !== "function") report(`Status item ${handle.id} has an implementation without load(); it is shown as missing`);
                handles.set(handle.id, handle);
                rebuild();
            },
            revoke: (handle) => {
                if (handles.get(handle.id) !== handle) return;
                handles.delete(handle.id);
                rebuild();
            },
        }),
    };
}
