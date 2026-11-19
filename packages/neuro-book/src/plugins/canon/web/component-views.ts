/**
 * 数据分页的界面（docs/specs/canon/author-ui.md 输出 12 到 14 与输入一节的贡献点 `canon.component-views`）：注册表记下各类型
 * 交付的句柄，条目页按类型取界面；没有交付、句柄撤回或组件加载失败时条目页用通用字段表。
 *
 * 每个句柄只加载一次组件：同一次交付反复渲染不重新加载，换了句柄（贡献方重新激活）才重新加载；撤回后句柄的实现被内核
 * 拒绝，注册表不再拿它。
 */

import {shallowRef} from "vue";
import type {Component, ShallowRef} from "vue";

import type {ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";
import type {FieldDeclaration, FieldState, Placement, ReadPosition} from "@notnotype/nb-canon";
import type {Text} from "@notnotype/nb-ui/text";

import type {ComponentViewDeclaration} from "../shared/component-views";
import type {OriginsPage} from "./origin-pages";

export interface ComponentViewImplementation {
    /** 只取得组件定义；条目页创建实例，组件收到 `{context: ComponentViewContext}`。 */
    load(): Promise<Component>;
}

/** 都是响应式读取：条目页换位置、世界发布新修订以后，同一个 context 给出新的值。 */
export interface ComponentViewContext {
    readonly entry: string;
    readonly namespace: string;
    readonly position: ReadPosition;
    readonly mode: "actual" | "planned";
    /** 世界版本。界面自己另读别处的数据时，按它变了重读。 */
    readonly version: number;
    /** 这个命名空间在所选位置上的字段状态（含最近一次改动）。 */
    readonly fields: Readonly<Record<string, FieldState>>;
    /** 这个类型的字段声明，含条目上实例声明的。 */
    readonly declarations: readonly FieldDeclaration[];
    /** 这个分页在标签上的状态：界面组件随标签卸载，要跨“切走再回来”保留的放在这里。 */
    readonly state: Record<string, unknown>;
    /** 写入入口不可用时的原因；可以写时为 null。 */
    readonly blocked: Text | null;
    /** 把一次安放写成界面上的“第 N 章”“前史”。 */
    place(at: Placement): string;
    /** 一个地址的来历的一页，从最近一步往前；`path` 是这个命名空间里的路径。失败时 reject。 */
    origins(path: string, cursor?: string): Promise<OriginsPage>;
    /** 让条目页对这个地址打开就地改的确认条。 */
    edit(path: string): void;
    /** 对这个地址记一笔；语义档只给 `text`。 */
    record(path: string, input: {readonly text: string; readonly delta?: number}): Promise<{readonly ok: true} | {readonly ok: false; readonly reason: Text}>;
    /** 打开一个条目、一条剧情变更的页面。 */
    open(ref: {readonly kind: "entry" | "change"; readonly id: string}): void;
    /**
     * 这一页的通用字段表（输出 12），专门界面嵌进自己的内容里：值、来历与“改”同通用字段表；`fields` 只列其中几个字段（字段名），
     * 不传列全部。它展开着哪个字段记在 `state.open`，专门界面自己的状态别用这个键。
     */
    readonly FieldTable: Component<{readonly fields?: readonly string[]}>;
}

/**
 * 附加分页（`canon.entry-tabs`，输出 36）的组件收到的 `context`：同 `ComponentViewContext` 去掉命名空间、字段与写入入口。
 * 都是响应式读取：条目页换位置、世界发布新修订以后，同一个 context 给出新的值。
 */
export interface EntryTabContext {
    readonly entry: string;
    /** 所选位置；窗口选了线时带着线（输出 34）。 */
    readonly position: ReadPosition;
    readonly mode: "actual" | "planned";
    readonly version: number;
    /** 这个分页在标签上的状态（按贡献 id），寿命同输出 7。 */
    readonly state: Record<string, unknown>;
    place(at: Placement): string;
    open(ref: {readonly kind: "entry" | "change"; readonly id: string}): void;
}

/** 附加分页的实现：同数据分页，组件收到 `{context: EntryTabContext}`。 */
export type EntryTabImplementation = ComponentViewImplementation;

type Handle<D> = ContributionHandle<D, ComponentViewImplementation>;

/** 一个类型的界面此刻的情况。 */
export type ComponentViewSlot =
    | {readonly status: "none"}
    | {readonly status: "loading"; readonly title: Text}
    | {readonly status: "ready"; readonly title: Text; readonly component: Component}
    | {readonly status: "failed"; readonly title: Text; readonly reason: string};

/**
 * 一个贡献点交来的界面（数据分页 `canon.component-views` 与附加分页 `canon.entry-tabs` 各一个实例）：按贡献 id 查，第一次查到一个
 * 句柄时加载它的组件，同一次交付只加载一次；贡献方停了以后查不到。
 */
export class ComponentViewRegistry<D extends {readonly title?: Text} = ComponentViewDeclaration> {
    readonly #published = shallowRef<ReadonlyMap<string, Handle<D>>>(new Map());
    readonly #loads = new WeakMap<Handle<D>, ShallowRef<ComponentViewSlot>>();

    /** 交来的全部（贡献 id 与补全过的声明）；响应式。 */
    entries(): readonly {readonly id: string; readonly declaration: D}[] {
        return [...this.#published.value.values()].map((handle) => ({id: handle.id, declaration: handle.declaration}));
    }

    receiver(): ContributionReceiver<D, ComponentViewImplementation> {
        return {
            published: (handle) => {
                this.#published.value = new Map(this.#published.value).set(handle.id, handle);
            },
            revoke: (handle) => {
                if (this.#published.value.get(handle.id) !== handle) return;
                const next = new Map(this.#published.value);
                next.delete(handle.id);
                this.#published.value = next;
            },
        };
    }

    /** 这个类型的界面；响应式，在 computed 与渲染里读。第一次读到一个句柄时开始加载它的组件。 */
    view(type: string): ComponentViewSlot {
        const handle = this.#published.value.get(type);
        if (handle === undefined) return {status: "none"};
        let slot = this.#loads.get(handle);
        if (slot === undefined) {
            // 声明经约定键补全过，`title` 总在。
            const title = handle.declaration.title!;
            const loading = shallowRef<ComponentViewSlot>({status: "loading", title});
            slot = loading;
            this.#loads.set(handle, loading);
            void handle.implementation().load().then(
                (component) => {
                    loading.value = {status: "ready", title, component};
                },
                (error: unknown) => {
                    loading.value = {status: "failed", title, reason: error instanceof Error ? error.message : String(error)};
                },
            );
        }
        return slot.value;
    }
}
