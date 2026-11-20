/**
 * 书架案头的贡献位的实现与接收（docs/specs/workbench/bookshelf.md 输出 22）。
 *
 * 只采用恰好一条贡献：没有或多于一条时都不采用（多于一条记诊断），同 `workbench.home` 的裁决。书架第一次画出来时才 `load`，项目窗口
 * 不加载贡献方的组件；加载失败记诊断、不采用。猫始终由 `ShelfDesk` 画，贡献的组件叠在同一格上，晚到或换掉都不重挂猫。
 */

import {shallowRef, watch} from "vue";
import type {Component, ShallowRef} from "vue";

import type {ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import {PROJECTS_DESK_POINT} from "../shared/desk";

export {PROJECTS_DESK_POINT} from "../shared/desk";

/**
 * 贡献的实现：交回叠在看板娘那一格上的组件。组件不收属性，有自己的单个根元素（铺满格子、圆角取 `inherit`），可以发
 * `update:mood`（`NeuroBookMood` 的心情）改猫的表情；宽窄按案头的容器查询 `@container (max-width: 720px)`，不另设容器。
 */
export interface DeskImplementation {
    load(): Promise<Component>;
}

export interface DeskSlot {
    readonly receiver: ContributionReceiver<unknown, DeskImplementation>;
    /** 采用的那条贡献的组件；没有、还没加载完或失败时为 null。 */
    readonly companion: ShallowRef<Component | null>;
    /** 书架画出来了：要组件。 */
    want(): void;
}

export function createDeskSlot(report: (event: string, message: string) => void): DeskSlot {
    const handles = shallowRef<readonly ContributionHandle<unknown, DeskImplementation>[]>([]);
    const companion = shallowRef<Component | null>(null);
    const wanted = shallowRef(false);

    const chosen = (): ContributionHandle<unknown, DeskImplementation> | null => (handles.value.length === 1 ? handles.value[0]! : null);

    watch([handles, wanted], ([list, want]) => {
        companion.value = null;
        if (list.length > 1) report("projects.desk-ambiguous", `${PROJECTS_DESK_POINT} 有 ${String(list.length)} 条贡献（${list.map((handle) => handle.id).join("、")}），都不采用`);
        const handle = chosen();
        if (handle === null || !want) return;
        void handle.implementation().load().then((component) => {
            // 加载期间撤回或又来了一条：这次作废。
            if (chosen() === handle && handle.published) companion.value = component;
        }, (error: unknown) => {
            report("projects.desk-load-failed", `${handle.id} 的组件加载失败：${error instanceof Error ? error.message : String(error)}`);
        });
    });

    return {
        receiver: {
            published: (handle) => {
                handles.value = [...handles.value, handle];
            },
            revoke: (handle) => {
                handles.value = handles.value.filter((entry) => entry !== handle);
            },
        },
        companion,
        want: () => {
            wanted.value = true;
        },
    };
}
