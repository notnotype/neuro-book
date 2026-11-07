/**
 * 编辑器槽的提供者（docs/specs/ui/workbench-shell.md 非目标第一条）：汇集 `workbench.editor-area` 的贡献，外壳挂 `order`
 * 最小的一个。同时有几个提供者时只挂一个、其余记诊断；挂着的那个撤回时换到下一个，都没有时外壳回到欢迎文字。
 */

import {defineAsyncComponent, defineComponent, h, markRaw, shallowRef} from "vue";
import type {Component, ShallowRef} from "vue";

import type {ContributionDescriptor, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {TextResolver} from "nbook/shared/localized-text";

import {WORKBENCH_EDITOR_AREA_POINT} from "../shared/contracts";
import type {EditorAreaDeclaration} from "../shared/contracts";
import {workbenchText} from "../shared/text";
import type {EditorAreaImplementation, EditorAreaParts} from "./contracts";

export interface EditorAreaProvider {
    readonly id: string;
    load(): Promise<EditorAreaParts>;
}

export interface EditorAreaSource {
    /** 此刻挂在编辑器槽里的提供者；没有为 null。 */
    readonly current: Readonly<ShallowRef<EditorAreaProvider | null>>;
}

/** 外壳挂的编辑器内容：提供者只加载一次，两个组件共用这一次的结果。 */
export interface MountedEditorArea {
    readonly host: Component;
    readonly group: Component;
    readonly head: Component;
}

/**
 * 编辑器槽里挂的组件：提供者的组件，加载期间与失败时由这里给内容（WorkbenchShell.md 的“编辑器”）。加载期间是一句给读屏的
 * “正在加载编辑器”（`role="status"`），容器标 `aria-busy`，截图工具（page:shot）据此等编辑器内容出来；失败时写出原因，
 * aria-busy 随占位一起撤掉。外壳给组的属性（`context`、`panelId` 与标记）只给提供者的组件，`inheritAttrs: false` 不让它们落到这两个
 * 组件的 DOM 上。占位立即显示，不等缺省的 200 毫秒。区级的 `host` 没有地方显示这些，什么都不画。
 */
export function mountEditorArea(provider: EditorAreaProvider, text: TextResolver): MountedEditorArea {
    const Loading = defineComponent({
        name: "EditorAreaLoading",
        inheritAttrs: false,
        setup: () => () => h("div", {"role": "status", "aria-busy": "true", "data-workbench-editor-loading": ""}, h("span", {class: "sr-only"}, text.t(workbenchText("editorArea.loading")))),
    });
    const Failed = defineComponent({
        name: "EditorAreaFailed",
        inheritAttrs: false,
        props: {error: {type: Error, required: true}},
        setup: (props) => () => h("p", {"class": "p-[var(--space-4)] text-[var(--status-danger)]", "role": "alert", "data-workbench-editor-failed": ""}, text.t(workbenchText("editorArea.failed", {reason: props.error.message}))),
    });
    const Nothing = defineComponent({name: "EditorAreaHostAbsent", inheritAttrs: false, setup: () => () => null});
    let loading: Promise<EditorAreaParts> | null = null;
    const load = (): Promise<EditorAreaParts> => {
        loading ??= provider.load();
        return loading;
    };
    return {
        host: markRaw(defineAsyncComponent({loader: async () => (await load()).host, errorComponent: Nothing, delay: 0})),
        group: markRaw(defineAsyncComponent({loader: async () => (await load()).group, loadingComponent: Loading, errorComponent: Failed, delay: 0})),
        // 头也没有地方显示加载与失败：内容那边已经写了。
        head: markRaw(defineAsyncComponent({loader: async () => (await load()).head ?? Nothing, errorComponent: Nothing, delay: 0})),
    };
}

export function validateEditorAreaContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${WORKBENCH_EDITOR_AREA_POINT} 只接受浏览器入口的贡献`;
    const declaration = descriptor.declaration;
    if (typeof declaration !== "object" || declaration === null) return "编辑器槽声明必须是对象";
    const {order} = declaration as Record<string, unknown>;
    if (typeof order !== "number" || !Number.isFinite(order)) return "order 必须是有限数";
    return null;
}

export class EditorAreaSlot implements EditorAreaSource {
    readonly current = shallowRef<EditorAreaProvider | null>(null);
    readonly #published = new Map<string, ContributionHandle<EditorAreaDeclaration, EditorAreaImplementation>>();
    readonly #report: (message: string) => void;

    constructor(report: (message: string) => void) {
        this.#report = report;
    }

    receiver(): ContributionReceiver<EditorAreaDeclaration, EditorAreaImplementation> {
        return {
            published: (handle) => {
                this.#published.set(handle.id, handle);
                this.#choose();
            },
            revoke: (handle) => {
                if (this.#published.get(handle.id) !== handle) return;
                this.#published.delete(handle.id);
                this.#choose();
            },
        };
    }

    #choose(): void {
        const ordered = [...this.#published.values()].sort((a, b) => a.declaration.order - b.declaration.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const chosen = ordered[0];
        if (ordered.length > 1) this.#report(`编辑器槽有 ${String(ordered.length)} 个提供者，只挂 ${chosen?.id ?? ""}：${ordered.slice(1).map((handle) => handle.id).join("、")} 不挂`);
        if (chosen === undefined) {
            this.current.value = null;
            return;
        }
        // 同一个提供者重复交付时不换对象：外壳按对象身份决定是否重挂。
        if (this.current.value?.id === chosen.id) return;
        // 每次加载都经 implementation() 取实现：贡献撤回后内核拒绝，不再用旧实现。
        this.current.value = {id: chosen.id, load: async () => chosen.implementation().load()};
    }
}
