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
import type {FieldDeclaration, FieldDraft, FieldState, Placement, ReadPosition} from "@notnotype/nb-canon";
import type {Text} from "@notnotype/nb-ui/text";

import type {ComponentViewDeclaration} from "../shared/component-views";
import type {OriginsPage} from "./origin-pages";

export interface ComponentViewImplementation {
    /** 只取得组件定义；条目页创建实例，组件收到 `{context: ComponentViewContext}`。 */
    load(): Promise<Component>;
}

/** 写入的结果：失败的原因由界面自己显示。 */
export type ViewWriteResult = {readonly ok: true} | {readonly ok: false; readonly reason: Text};

/** 同一条目上另一个模块的只读视图（`context.other` 的 `present`）：改它的字段、看它的来历到它自己的分页去（`showTab`）。 */
export interface ComponentPeer {
    readonly namespace: string;
    readonly fields: Readonly<Record<string, FieldState>>;
    readonly declarations: readonly FieldDeclaration[];
}

/** 同一条目上另一个模块此刻的情况（author-ui.md 输入一节的 `other`）。 */
export type OtherComponent =
    | {readonly status: "present"; readonly peer: ComponentPeer}
    /** 没加过。 */
    | {readonly status: "absent"}
    /** 去掉过，可以恢复。 */
    | {readonly status: "removed"}
    /** 加了，所选位置上还没启用；`from` 是“第 N 章”这样的写法。 */
    | {readonly status: "later"; readonly from: string}
    /** 类型没登记或不可用。 */
    | {readonly status: "unavailable"};

/** 就地改的编辑器（`context.FieldEditor`）的属性：`path` 是这个命名空间里的字段名。 */
export interface FieldEditorProps {
    readonly path: string;
    /**
     * 两种都是锚在 `anchor`（值或原文按钮）下方的浮层（输出 51）。`popover`（缺省）：短项用，单行输入，点外面放弃；`block`：
     * 成段的文字用，多行输入、与原文同宽，点外面不收起。
     */
    readonly layout?: "popover" | "block";
    /** 文字字段这一处的建议值（例如现在穿的：衣柜里各套的名字）；给了就用输入框加候选。 */
    readonly suggestions?: readonly string[];
    /** 浮层贴着的元素（值按钮）。写成 `object`：这个文件也在服务端的类型检查里，那里没有 DOM 的类型。 */
    readonly anchor?: object | null;
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
    /**
     * 改这个地址（输出 16、51）：`inline` 为真、并且此刻挂着这条路径的 `FieldEditor` 时由它画，否则出页面顶上的确认条；`value`、
     * `intent` 预先填好（换装用）。
     */
    edit(path: string, options?: {readonly inline?: boolean; readonly value?: unknown; readonly intent?: "creative" | "story"}): void;
    /** 对这个地址记一笔；语义档只给 `text`。 */
    record(path: string, input: {readonly text: string; readonly delta?: number}): Promise<{readonly ok: true} | {readonly ok: false; readonly reason: Text}>;
    /**
     * 列表（canon.revisions 输出 25 的 `listAdd`、`listRemove`、元素子字段的 `set`）：让条目页打开加一项、改一项的对话框，或去掉一项的
     * 确认。`path` 是这个命名空间里的列表字段名。条目页以外的宿主可以不给。
     */
    listAdd?(path: string): void;
    listEdit?(path: string, element: string): void;
    listRemove?(path: string, element: string): void;
    /** 打开一个条目、一条剧情变更的页面。 */
    open(ref: {readonly kind: "entry" | "change"; readonly id: string}): void;
    /**
     * 这一页的通用字段表（输出 12），专门界面嵌进自己的内容里：值、来历与“改”同通用字段表；`fields` 只列其中几个字段（字段名），
     * 不传列全部。它展开着哪个字段记在 `state.open`，专门界面自己的状态别用这个键。
     */
    readonly FieldTable: Component<{readonly fields?: readonly string[]}>;
    /*
     * 以下都可以不给：条目页给全，别的宿主（Lab、测试）缺哪一项，界面就退到没有它时的做法（输入一节）。
     */
    /** 同一条目上另一个模块；只认声明里 `uses` 列了的类型。在渲染或 computed 里读，不要存起来。 */
    other?(type: string): OtherComponent;
    /** 给这个条目加上（去掉过的是恢复）一个模块。 */
    addComponent?(type: string): Promise<ViewWriteResult>;
    /** 切到那个模块的分页；没有这个分页时什么也不做。 */
    showTab?(type: string): void;
    /** 在这个条目的这个模块上新增一个字段、改显示名、去掉、恢复（类型允许实例字段时才有）；`path` 是字段名。 */
    fieldAdd?(field: FieldDraft): Promise<ViewWriteResult>;
    fieldRename?(path: string, label: string): Promise<ViewWriteResult>;
    fieldRemove?(path: string): Promise<ViewWriteResult>;
    fieldRestore?(path: string): Promise<ViewWriteResult>;
    /** 这个模块上去掉过的字段，给“恢复”用。 */
    readonly removedFields?: readonly {readonly id: string; readonly label: string}[];
    /** 这个类型的预设字段（canon.components 输出 24），“添加一项资料”里列。 */
    readonly presets?: readonly FieldDeclaration[];
    /** 就地改的编辑器与一个值的细节（来历、语义档的各句、记一句）；`path` 是字段名。 */
    readonly FieldEditor?: Component<FieldEditorProps>;
    readonly FieldDetail?: Component<{readonly path: string}>;
    /** 正在就地改、正在看细节的字段（字段名）；没有时为 null。 */
    readonly editing?: string | null;
    readonly detail?: string | null;
    showDetail?(path: string | null): void;
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
