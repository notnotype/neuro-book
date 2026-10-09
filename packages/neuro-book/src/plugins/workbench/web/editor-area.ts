/**
 * 编辑器槽的提供者（docs/specs/ui/workbench-shell.md 非目标第一条）：汇集 `workbench.editor-area` 的贡献，外壳挂 `order`
 * 最小的一个。同时有几个提供者时只挂一个、其余记诊断；挂着的那个撤回时换到下一个，都没有时外壳回到欢迎文字。
 */

import {shallowRef} from "vue";
import type {Component, ShallowRef} from "vue";

import type {ContributionDescriptor, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import {WORKBENCH_EDITOR_AREA_POINT} from "../shared/contracts";
import type {EditorAreaDeclaration} from "../shared/contracts";
import type {EditorAreaImplementation} from "./contracts";

export interface EditorAreaProvider {
    readonly id: string;
    load(): Promise<Component>;
}

export interface EditorAreaSource {
    /** 此刻挂在编辑器槽里的提供者；没有为 null。 */
    readonly current: Readonly<ShallowRef<EditorAreaProvider | null>>;
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
