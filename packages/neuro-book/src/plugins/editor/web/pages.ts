/**
 * 编辑区的页面（docs/specs/workbench/editor.md 输出 33）：贡献点 `editor.pages` 交来的不对应文件的标签。注册表记下交付的
 * 句柄，按 id 给出标题与组件；组件每次经句柄取实现，贡献撤回后内核拒绝，不再用旧实现。页面标签的地址是 `page://<id>`，
 * 不是资源地址：不读文档、不进会话记录。
 */

import {defineAsyncComponent, defineComponent, h, reactive, shallowRef} from "vue";
import type {Component} from "vue";

import type {ContributionDeclarations, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";
import {useText} from "@notnotype/nb-ui/text-port";

import type {TextResolver} from "nbook/shared/localized-text";

import {EDITOR_PAGES_POINT, PAGE_ICON_PATTERN} from "../shared/contracts";
import type {EditorPageDeclaration} from "../shared/contracts";
import {editorText} from "../shared/text";
import {pageAddress, pageArgOf, pageIdOf} from "./page-address";

export {pageAddress, pageArgOf, pageIdOf};

/**
 * 页面组件加载期间与加载失败时的内容（editor.md 输出 33）。加载期间是一句给读屏的“正在加载页面”（`role="status"`），容器标
 * `aria-busy`，截图工具（page:shot）据此等页面出来；失败时写出原因，aria-busy 随占位一起撤掉。编辑组给页面组件的 `context`
 * 也会透传到这两个组件上，`inheritAttrs: false` 不让它落成 DOM 属性。
 */
function pageStates(): {readonly loading: Component; readonly failed: Component} {
    return {
        loading: defineComponent({
            name: "EditorPageLoading",
            inheritAttrs: false,
            setup: () => {
                const text = useText();
                return () => h("div", {"role": "status", "aria-busy": "true", "data-editor-page-loading": ""}, h("span", {class: "sr-only"}, text.t(editorText("page.loading"))));
            },
        }),
        failed: defineComponent({
            name: "EditorPageFailed",
            inheritAttrs: false,
            props: {error: {type: Error, required: true}},
            setup: (props) => {
                const text = useText();
                return () => h("p", {"class": "px-6 py-4 text-[length:var(--text-sm)] text-[var(--status-danger)]", "role": "alert", "data-editor-page-failed": ""}, text.t(editorText("page.failed", {reason: props.error.message})));
            },
        }),
    };
}

/**
 * 页面组件收到的 `context` 属性，每个标签一份（输出 33）。`state` 是编辑器给这个标签的响应式对象：页面标签只在活动时渲染，
 * 切走时组件卸载，要跨“切走再回来”保留的界面状态放在它里面。它随标签：标签关闭时丢弃，不存盘。
 */
export interface EditorPageContext<State extends object = Record<string, unknown>> {
    /** 这部作品在本窗口最近打开的地址，最近在前（输出 31）；没有绑定项目时为空。 */
    readonly recent: ReadonlyArray<string>;
    /** 这个标签的参数；不带参数的页面没有。 */
    readonly arg?: string;
    readonly state: State;
}

/** 页面面包屑的一段：带命令的可以点，点了执行那条命令；最后一段是当前页，不可点。 */
export interface EditorPageCrumb {
    readonly label: EditorPageDeclaration["title"];
    readonly command?: {readonly id: string; readonly args?: unknown};
}

export interface EditorPageImplementation<State extends object = Record<string, unknown>> {
    /** 只取得组件定义；实例由编辑区创建，组件收到 `{context: EditorPageContext}`。 */
    load(): Promise<Component>;
    /** 这个标签的标题；在标签条的计算里调用，读到的响应式数据变了标题跟着变。返回 null 时用记着的标题或声明的标题。 */
    title?(arg: string | undefined): EditorPageDeclaration["title"] | null;
    /**
     * 这个标签的图标：lucide 的类名（输出 53）；同 `title` 在标签条的计算里调用。返回 null 时用记着的图标或声明的图标。
     */
    icon?(arg: string | undefined): string | null;
    /** `context.state` 的初值；不给时是空对象。 */
    initialState?(arg: string | undefined): State;
    /** 这个标签的面包屑；同样在计算里调用。返回 null 或空时这个标签没有面包屑。 */
    breadcrumbs?(arg: string | undefined): ReadonlyArray<EditorPageCrumb> | null;
    /**
     * 这个标签有没有还没提交的内容（输出 68）；在标签条与公开状态的计算里调用，不在前台的标签也会问，所以它读的状态不能放在
     * 页面组件里（组件只在标签活动时存在）。
     */
    uncommitted?(arg: string | undefined): boolean;
    /**
     * 提交这个标签的内容（输出 68）：活动标签是它时由“保存”命令调用并等待。失败由页面自己显示；reject 时保存命令报告失败。
     * 同一个标签的两次调用可能重叠（连按两次 Ctrl+S），由页面自己合并。
     */
    commit?(arg: string | undefined): Promise<void>;
}

/** 页面标签上与页面有关的那几项（`groups.ts` 的 `PageTab`）。 */
export interface PageTabRef {
    readonly id: string;
    readonly address: string;
    readonly title?: string;
    readonly icon?: string;
}

/** 给界面的面包屑的一段：文字已经翻译好；`run` 执行这一段的命令，没有命令的段没有它。 */
export interface PageCrumbItem {
    readonly label: string;
    readonly run?: () => void;
}

/** 编辑组渲染页面标签要的东西。 */
export interface EditorPageSource {
    /**
     * 标签的标题：页面此刻给的，没有就用标签上记着的，再没有用声明的标题；都没有（声明已不在、也没记过）时为 null。
     * `liveTitle` 只给页面此刻给的那一个，编辑器拿它更新标签上记着的标题。
     */
    title(tab: PageTabRef, text: TextResolver): string | null;
    liveTitle(tab: PageTabRef, text: TextResolver): string | null;
    /** 标签的图标（lucide 类名），取法同标题：页面此刻给的、标签上记着的、声明的；`liveIcon` 只给页面此刻给的。 */
    icon(tab: PageTabRef): string | null;
    liveIcon(tab: PageTabRef): string | null;
    /** 页面组件；还没交付实现时为 null。 */
    component(id: string): Component | null;
    /**
     * 声明在、实现还没交付过（例如刷新后恢复的标签，贡献方还没激活）：编辑组显示“正在加载页面”，交付后自己换成页面。
     * 交付过又撤回的（贡献方停了）不算，那时说明页面已经不在了。响应式。
     */
    pending(id: string): boolean;
    /** 这个页面铺主题的场景图。 */
    scene(id: string): boolean;
    /** 这个标签的 `context`：同一个标签每次拿到同一个对象。 */
    context(tab: PageTabRef): EditorPageContext;
    crumbs(tab: PageTabRef, text: TextResolver): ReadonlyArray<PageCrumbItem>;
    /** 页面说这个标签有没提交的内容（输出 68）；页面没给、或贡献已撤回时为假。响应式。 */
    uncommitted(tab: PageTabRef): boolean;
    /** 提交这个标签的内容；页面没给 `commit`、或贡献已撤回时为 null。 */
    commit(tab: PageTabRef): (() => Promise<void>) | null;
    /** 标签关掉了：丢掉它的 `state`。 */
    release(tabId: string): void;
}

export class EditorPageRegistry {
    readonly #declarations: ContributionDeclarations;
    readonly #published = shallowRef<ReadonlyMap<string, ContributionHandle<EditorPageDeclaration, EditorPageImplementation>>>(new Map());
    /** 交付过又撤回的页面 id：声明可能还在，但它不会自己回来，不当成还在加载。 */
    readonly #revoked = shallowRef<ReadonlySet<string>>(new Set());
    /** 每个交付句柄一个异步组件：同一次交付反复渲染不重新加载，换了句柄（重新激活）才重新加载。 */
    readonly #components = new WeakMap<ContributionHandle<EditorPageDeclaration, EditorPageImplementation>, Component>();
    readonly #states: {readonly loading: Component; readonly failed: Component};

    constructor(declarations: ContributionDeclarations) {
        this.#declarations = declarations;
        this.#states = pageStates();
    }

    receiver(): ContributionReceiver<EditorPageDeclaration, EditorPageImplementation> {
        return {
            published: (handle) => {
                this.#published.value = new Map(this.#published.value).set(handle.id, handle);
                if (this.#revoked.value.has(handle.id)) this.#revoked.value = new Set([...this.#revoked.value].filter((id) => id !== handle.id));
            },
            revoke: (handle) => {
                if (this.#published.value.get(handle.id) !== handle) return;
                const next = new Map(this.#published.value);
                next.delete(handle.id);
                this.#published.value = next;
                this.#revoked.value = new Set(this.#revoked.value).add(handle.id);
            },
        };
    }

    declaration(id: string): EditorPageDeclaration | null {
        return this.#declarations.get<EditorPageDeclaration>(EDITOR_PAGES_POINT, id)?.declaration ?? null;
    }

    /** 交付了实现、可以打开的页面。响应式：在 computed 与 watch 里读。 */
    available(id: string): boolean {
        return this.#published.value.has(id);
    }

    /** 交付了实现、声明要在作品第一次打开时自动打开的页面，按 id。 */
    firstVisitPages(): string[] {
        return [...this.#published.value.values()].filter((handle) => handle.declaration.openOnFirstVisit === true).map((handle) => handle.id).sort();
    }

    /**
     * `shared` 是各标签共用的那部分上下文（最近打开）；`execute` 执行面包屑里的命令。
     *
     * 实现只在贡献还交付着的时候取（`#published` 里有它的句柄）：贡献撤回后句柄的 `implementation()` 被内核拒绝，
     * 这时标题退回记着的那个，面包屑没有。
     */
    source(shared: Pick<EditorPageContext, "recent">, execute: (id: string, args: unknown) => void = () => undefined): EditorPageSource {
        const contexts = new Map<string, EditorPageContext>();
        const implementationOf = (address: string): EditorPageImplementation | null => {
            const id = pageIdOf(address);
            const handle = id === null ? undefined : this.#published.value.get(id);
            return handle === undefined ? null : handle.implementation();
        };
        const liveTitle = (tab: PageTabRef, text: TextResolver): string | null => {
            const given = implementationOf(tab.address)?.title?.(pageArgOf(tab.address)) ?? null;
            return given === null ? null : text.t(given);
        };
        // 页面给的图标不是 lucide 类名时不认：它会随标签记录存盘，格式不对会让整条记录写不进去（`tabs-record.ts` 的校验）。
        const iconPattern = new RegExp(PAGE_ICON_PATTERN, "u");
        const liveIcon = (tab: PageTabRef): string | null => {
            const given = implementationOf(tab.address)?.icon?.(pageArgOf(tab.address)) ?? null;
            return given !== null && iconPattern.test(given) && given.length <= 100 ? given : null;
        };
        return {
            liveTitle,
            liveIcon,
            icon: (tab) => {
                const live = liveIcon(tab);
                if (live !== null) return live;
                if (tab.icon !== undefined) return tab.icon;
                const id = pageIdOf(tab.address);
                return (id === null ? null : this.declaration(id)?.icon) ?? null;
            },
            title: (tab, text) => {
                const live = liveTitle(tab, text);
                if (live !== null) return live;
                if (tab.title !== undefined) return tab.title;
                const id = pageIdOf(tab.address);
                const declaration = id === null ? null : this.declaration(id);
                return declaration === null ? null : text.t(declaration.title);
            },
            context: (tab) => {
                let context = contexts.get(tab.id);
                if (context === undefined) {
                    const arg = pageArgOf(tab.address);
                    const state = reactive(implementationOf(tab.address)?.initialState?.(arg) ?? {});
                    // `recent` 经取值函数读：各标签共用的那一份变了，每个标签的 context 都看得到。
                    context = {get recent() { return shared.recent; }, ...(arg === undefined ? {} : {arg}), state};
                    contexts.set(tab.id, context);
                }
                return context;
            },
            crumbs: (tab, text) => (implementationOf(tab.address)?.breadcrumbs?.(pageArgOf(tab.address)) ?? []).map((crumb) => {
                const command = crumb.command;
                return {label: text.t(crumb.label), ...(command === undefined ? {} : {run: () => execute(command.id, command.args)})};
            }),
            uncommitted: (tab) => implementationOf(tab.address)?.uncommitted?.(pageArgOf(tab.address)) === true,
            commit: (tab) => {
                const implementation = implementationOf(tab.address);
                return implementation?.commit === undefined ? null : () => implementation.commit!(pageArgOf(tab.address));
            },
            release: (tabId) => void contexts.delete(tabId),
            scene: (id) => this.declaration(id)?.scene === true,
            pending: (id) => !this.#published.value.has(id) && !this.#revoked.value.has(id) && this.declaration(id) !== null,
            component: (id) => {
                const handle = this.#published.value.get(id);
                if (handle === undefined) return null;
                let component = this.#components.get(handle);
                if (component === undefined) {
                    // 占位立即显示，不等缺省的 200 毫秒：这段空白里截图工具看不出标签内容还没出来。
                    component = defineAsyncComponent({loader: () => handle.implementation().load(), loadingComponent: this.#states.loading, errorComponent: this.#states.failed, delay: 0});
                    this.#components.set(handle, component);
                }
                return component;
            },
        };
    }
}
