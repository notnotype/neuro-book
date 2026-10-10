/**
 * 无项目首页的提供者（docs/specs/ui/workbench-shell.md 输出 36）：汇集 `workbench.home` 的贡献。恰好一个时采用；几个插件
 * 同时贡献时全部不采用并记诊断（没有“谁先登记谁赢”，结果与登记顺序无关）；撤回后重新裁决。
 */

import {shallowRef} from "vue";
import type {Component, ShallowRef} from "vue";

import type {ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {HomeDeclaration} from "../shared/home";
import type {WorkbenchHomeImplementation} from "./contracts";

export interface HomeProvider {
    readonly id: string;
    load(): Promise<Component>;
}

export interface HomeSource {
    /** 此刻采用的首页；没有贡献或贡献多于一个时为 null。 */
    readonly current: Readonly<ShallowRef<HomeProvider | null>>;
}

export class HomeSlot implements HomeSource {
    readonly current = shallowRef<HomeProvider | null>(null);
    readonly #published = new Map<string, ContributionHandle<HomeDeclaration, WorkbenchHomeImplementation>>();
    readonly #report: (message: string) => void;

    constructor(report: (message: string) => void) {
        this.#report = report;
    }

    receiver(): ContributionReceiver<HomeDeclaration, WorkbenchHomeImplementation> {
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
        const handles = [...this.#published.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        if (handles.length > 1) {
            this.#report(`首页有 ${String(handles.length)} 个提供者，都不采用：${handles.map((handle) => handle.id).join("、")}`);
            this.current.value = null;
            return;
        }
        const chosen = handles[0];
        if (chosen === undefined) {
            this.current.value = null;
            return;
        }
        // 同一个提供者重复交付时不换对象：页面按对象身份决定是否重新加载。
        if (this.current.value?.id === chosen.id) return;
        // 每次加载都经 implementation() 取实现：贡献撤回后内核拒绝，不再用旧实现。
        this.current.value = {id: chosen.id, load: async () => chosen.implementation().load()};
    }
}
