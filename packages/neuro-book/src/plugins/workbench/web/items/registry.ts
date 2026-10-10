/**
 * 状态栏或标题栏的条目注册表（docs/specs/ui/workbench-shell.md 外壳四输出 33）：一个贡献点一个实例，写法与视图注册表
 * 相同。
 *
 * - 声明目录在工作台入口激活时取得，之后不变；交付句柄在 `published` 时记下、`revoke` 时去掉。
 * - 每次求值都经句柄的 `implementation()` 取实现、不缓存；入口开始停止时句柄先失去 `published`（撤回稍后才到），从那一刻
 *   起就不再显示、也不再调用它的实现，打开着的“更多”菜单同样如此。
 * - 显示与否只看声明的 `when`：每个键在公开状态里已就绪且为真才显示，与命令的可用性同一规则。
 * - 实现抛错的条目原位显示为出错，别的条目照常；同一个句柄只记一次诊断。
 */

import {shallowRef} from "@vue/reactivity";

import type {ContributionDescriptor, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {PublicStateService} from "nbook/plugins/state/shared/contracts";
import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import type {ItemDeclaration} from "../../shared/items";
import type {ItemImplementation} from "../contracts";

export type ItemState = "normal" | "warning" | "error";

/** 外壳此刻要画的一个条目：文字都已按语言取好。 */
export interface ShownItem {
    readonly id: string;
    readonly title: string;
    readonly alignment: ItemDeclaration["alignment"];
    readonly order: number;
    readonly priority: number;
    readonly command: {readonly id: string; readonly args: Readonly<Record<string, unknown>>} | null;
    readonly text: string;
    readonly tooltip: string | null;
    readonly state: ItemState;
}

/** 交给条目条组件的一项：再带上命令此刻不可用的原因（有命令且不可用时）。 */
export type StripEntry = ShownItem & {readonly disabledReason: string | null};

type ItemHandle = ContributionHandle<ItemDeclaration, ItemImplementation>;

const BROKEN: LocalizedText = {"zh-CN": "这个条目出错了：{message}", "en-US": "This item failed: {message}"};

export class ItemRegistry {
    readonly #catalog: ReadonlyMap<string, ItemDeclaration>;
    readonly #state: Pick<PublicStateService, "read">;
    readonly #report: (message: string) => void;
    readonly #handles = new Map<string, ItemHandle>();
    /** 已记过诊断的句柄：一个句柄的实现反复抛错只记一次。 */
    readonly #reported = new WeakSet<ItemHandle>();
    /** 句柄集合的响应式版本号：交付、撤回、停止时加一，读 `shown` 的 computed 因此重算。 */
    readonly #version = shallowRef(0);
    #stopped = false;

    constructor(declarations: ReadonlyArray<ContributionDescriptor<ItemDeclaration>>, state: Pick<PublicStateService, "read">, report: (message: string) => void, signal: AbortSignal) {
        this.#catalog = new Map(declarations.map((descriptor) => [descriptor.id, descriptor.declaration]));
        this.#state = state;
        this.#report = report;
        signal.addEventListener("abort", () => {
            this.#stopped = true;
            this.#version.value += 1;
        }, {once: true});
    }

    receiver(): ContributionReceiver<ItemDeclaration, ItemImplementation> {
        return {
            published: (handle) => {
                this.#handles.set(handle.id, handle);
                this.#version.value += 1;
            },
            revoke: (handle) => {
                if (this.#handles.get(handle.id) !== handle) return;
                this.#handles.delete(handle.id);
                this.#version.value += 1;
            },
        };
    }

    /** 此刻要显示的条目：左侧在前、右侧在后，同侧按 order 再按 id。响应式：在 computed 里读。 */
    shown(locale: DisplayLocale): ShownItem[] {
        void this.#version.value;
        if (this.#stopped) return [];
        const items: ShownItem[] = [];
        for (const [id, handle] of this.#handles) {
            const declaration = this.#catalog.get(id);
            if (declaration === undefined || !handle.published || !this.#visible(declaration)) continue;
            items.push(this.#render(id, handle, declaration, locale));
        }
        const side = (item: ShownItem) => (item.alignment === "left" ? 0 : 1);
        return items.sort((a, b) => side(a) - side(b) || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    #visible(declaration: ItemDeclaration): boolean {
        return (declaration.when?.requires ?? []).every((key) => {
            const read = this.#state.read(key);
            return read.status === "ready" && read.value === true;
        });
    }

    #render(id: string, handle: ItemHandle, declaration: ItemDeclaration, locale: DisplayLocale): ShownItem {
        const base = {
            id,
            title: localize(declaration.title, locale),
            alignment: declaration.alignment,
            order: declaration.order,
            priority: declaration.priority,
            command: declaration.command === undefined ? null : {id: declaration.command.id, args: declaration.command.args ?? {}},
        };
        try {
            const implementation = handle.implementation();
            return {...base, text: implementation.text(), tooltip: implementation.tooltip?.() ?? null, state: implementation.state?.() ?? "normal"};
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!this.#reported.has(handle)) {
                this.#reported.add(handle);
                this.#report(`条目 ${id} 的实现出错：${message}`);
            }
            return {...base, text: base.title, tooltip: localize(formatText(BROKEN, {message}), locale), state: "error", command: null};
        }
    }
}
