/**
 * 一个窗口里的资源管理器（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：入口激活时建立，活到
 * 入口停止。视图第一次挂上时才打开偏好记录，偏好首读结束（读到或失败）后才建控制器，缺省值因此不会覆盖记录；之后视图
 * 停放、移动、渲染重试只解绑再绑定同一个控制器。命令经它找到控制器与当前挂着的视图。
 */

import {computed, shallowRef, watch} from "@vue/reactivity";
import type {ComputedRef, Ref, ShallowRef} from "@vue/reactivity";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import type {FilesService} from "nbook/plugins/files/shared/contracts";

import {createExplorerController} from "./controller";
import type {ExplorerController} from "./controller";
import {EXPANDED_LIMIT, fieldProblem, limitBranches} from "./preferences";
import type {ExplorerStore, PreferenceProblem} from "./preferences";
import {addressOf, resourceOf} from "./tree/address";

/** 当前挂着的视图实例：命令与确认按它的代次判断回调是否过期。 */
export interface AttachedView {
    readonly id: string;
    readonly generation: number;
    readonly visible: Readonly<Ref<boolean>>;
}

export interface ExplorerSessionOptions {
    readonly files: FilesService;
    readonly commands: Pick<CommandService, "execute">;
    readonly bound: boolean;
    /** 第一次挂上视图时调用：打开偏好记录。 */
    readonly createStore: () => ExplorerStore;
    readonly report: (error: unknown) => void;
}

export interface ExplorerSession {
    readonly controller: Readonly<ShallowRef<ExplorerController | null>>;
    readonly store: Readonly<ShallowRef<ExplorerStore | null>>;
    readonly view: Readonly<ShallowRef<AttachedView | null>>;
    /** 偏好记录此刻的问题（读不到、损坏、没保存上），给视图显示一条提示；没有为 null。 */
    readonly problem: ComputedRef<PreferenceProblem | null>;
    attach(view: AttachedView): () => void;
    setShowManifests(show: boolean): void;
    /** 偏好提示上的“重试 / 重新读取”与“放弃”：之后树与显示按记录此刻的值。 */
    retryPreferences(): Promise<void>;
    discardPreferences(): void;
    dispose(): void;
}

export function createExplorerSession(options: ExplorerSessionOptions): ExplorerSession {
    const controller = shallowRef<ExplorerController | null>(null);
    const store = shallowRef<ExplorerStore | null>(null);
    const view = shallowRef<AttachedView | null>(null);
    let stopWaiting: (() => void) | null = null;
    let disposed = false;

    const fieldsOf = (current: ExplorerStore) => [current.state.preferences, ...(current.state.expanded === null ? [] : [current.state.expanded]), current.state.userExpanded];

    const expandedOf = (current: ExplorerStore): string[] => [
        ...(current.state.expanded?.display.paths ?? []).map((path) => addressOf("project", path)),
        ...current.state.userExpanded.display.paths.map((path) => addressOf("user", path)),
    ];
    /**
     * 控制器的显示与展开是记录的一份拷贝，平时由控制器改、再存回记录；重读与放弃反过来改了记录的显示值，要拷回控制器，
     * 否则提示消失了、树却还是被放弃的样子，之后的保存又把它带回去。拷回时展开集合与记录相同，不会再触发保存。
     */
    const adopt = (): void => {
        const current = store.value;
        const active = controller.value;
        if (current === null || active === null) return;
        active.setShowManifests(current.state.preferences.display.showManifests);
        active.model.setExpanded(expandedOf(current));
    };

    const start = (current: ExplorerStore): void => {
        const {state, actions} = current;
        const initial = expandedOf(current);
        controller.value = createExplorerController({
            files: options.files,
            commands: options.commands,
            bound: options.bound,
            expanded: initial,
            showManifests: state.preferences.display.showManifests,
            onExpandedChange: (expanded) => {
                const paths = (scheme: "project" | "user"): string[] => limitBranches([...expanded].filter((address) => resourceOf(address).scheme === scheme), EXPANDED_LIMIT).map((address) => resourceOf(address).path);
                actions.saveExpanded("expanded", paths("project"));
                actions.saveExpanded("userExpanded", paths("user"));
            },
            report: options.report,
        });
    };

    const acquire = (): void => {
        if (store.value !== null) return;
        const current = options.createStore();
        store.value = current;
        // 首读结束（读到或失败）之前不建控制器：缺省值不能先显示、再被当成修改保存。
        const settled = computed(() => fieldsOf(current).every((field) => field.ready || field.failure !== null));
        stopWaiting = watch(settled, (done) => {
            if (!done || controller.value !== null || disposed) return;
            stopWaiting?.();
            stopWaiting = null;
            start(current);
        }, {immediate: true});
    };

    return {
        controller,
        store,
        view,
        problem: computed(() => {
            const current = store.value;
            if (current === null) return null;
            for (const field of fieldsOf(current)) {
                const problem = fieldProblem(field);
                if (problem !== null) return problem;
            }
            return null;
        }),
        attach: (attached) => {
            acquire();
            view.value = attached;
            return () => {
                if (view.value === attached) view.value = null;
            };
        },
        setShowManifests: (show) => {
            const current = controller.value;
            if (current === null) return;
            current.setShowManifests(show);
            store.value?.actions.setShowManifests(show);
        },
        retryPreferences: async () => {
            await store.value?.actions.retry();
            adopt();
        },
        discardPreferences: () => {
            store.value?.actions.discard();
            adopt();
        },
        dispose: () => {
            disposed = true;
            stopWaiting?.();
            controller.value?.dispose();
            controller.value = null;
            view.value = null;
        },
    };
}
