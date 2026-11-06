/**
 * `nbook.workbench` 的贡献助手（docs/specs/runtime/plugin-api.md 的“作者 API”）：侧栏与面板的视图、状态栏条目。SDK 的
 * `/workbench` 导出它们；工作台只在浏览器里有意义，整个子路径只给浏览器入口用。第一个参数是 `plugin`，读它的 id 拼贡献 id；
 * 带 `where: "browser"`，写进别的位置的入口编译不过。
 */

import type {AllowedComponentProps, Component, ComponentCustomProps, VNodeProps} from "vue";

import {WORKBENCH_STATUSBAR_ITEMS_POINT} from "nbook/plugins/workbench/shared/items";
import type {ItemDeclaration} from "nbook/plugins/workbench/shared/items";
import type {Written} from "nbook/shared/convention-keys";
import {WORKBENCH_THEME_SCENES_POINT} from "nbook/plugins/workbench/shared/theme-points";
import type {SceneProviderImplementation} from "nbook/plugins/workbench/shared/theme-points";
import type {SceneProviderDeclaration} from "nbook/plugins/workbench/shared/themes";
import {OPEN_VIEW_COMMAND, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/views";
import type {ViewDeclaration, WrittenViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ItemImplementation} from "nbook/plugins/workbench/web/contracts";
import {viewContribution} from "nbook/plugins/workbench/web/view-contribution";

import type {CommandHelper} from "./command-helpers";
import {bound, contributionId} from "./plugin";
import type {BoundImplementation, ContributionHelper, PluginBuilder, ShortNameRule, Text} from "./plugin";

/** `load` 取到的组件。 */
type Loaded<Load> = Load extends () => Promise<infer Module> ? (Module extends {readonly default: infer Value} ? Value : Module) : never;

/**
 * 组件的属性类型，去掉宿主给的 `context` 与 Vue 给每个组件都加的属性。用 vue-tsc 检查时，`load: () => import("./X.vue")`
 * 带着组件的 `defineProps`，`implement` 给的属性漏了必填项、写错名或类型不对都编译不过；可选属性的笔误查不出（返回的对象
 * 不做多余属性检查）。带泛型参数的单文件组件（`<script setup generic="…">`）推不出属性，回落成不检查。只有 tsc 时单文件组件
 * 是没有属性信息的 `Component`，不检查也不误报。
 */
export type PropsOf<Load> = Loaded<Load> extends abstract new (...args: never) => {readonly $props: infer Props}
    ? Omit<Props, keyof VNodeProps | keyof AllowedComponentProps | keyof ComponentCustomProps | "context">
    : Readonly<Record<string, unknown>>;

export type ComponentLoad = () => Promise<Component | {readonly default: Component}>;

export interface ViewHelper<Id extends string, Load extends ComponentLoad> extends ContributionHelper<typeof WORKBENCH_VIEWS_POINT, Id, WrittenViewDeclaration> {
    readonly where: "browser";
    /** `props` 在渲染时求值、作为视图组件的属性，读响应式的值时视图随之更新。组件另收宿主给的 `context`。 */
    implement(props?: () => PropsOf<Load>): BoundImplementation<typeof WORKBENCH_VIEWS_POINT, Id>;
}

/**
 * 侧栏、右栏或面板里的视图（docs/specs/workbench/views.md）：`location` 缺省 `sidebar`，`layout` 缺省 `scroll`。视图的实现要等
 * 入口激活才交出，入口通常写 `activationEvents: ["onStartup"]`。`title` 与标题动作的 `title` 省略时宿主登记时补成约定键
 * （docs/specs/workbench/views.md 的“约定键”）。
 */
export function view<const Id extends string, const Name extends string, const Load extends ComponentLoad>(plugin: PluginBuilder<Id>, options: Omit<WrittenViewDeclaration, "title" | "location" | "layout"> & {
    readonly name: Name;
    readonly title?: Text;
    readonly location?: ViewDeclaration["location"];
    readonly layout?: ViewDeclaration["layout"];
    readonly load: Load;
} & ShortNameRule<Name>): ViewHelper<`${Id}.${Name}`, Load> {
    const id = contributionId(plugin.id, options.name, "视图");
    const {name: _name, title, location, layout, load, ...rest} = options;
    const helper = viewContribution({id, declaration: {...rest, ...(title === undefined ? {} : {title}), location: location ?? "sidebar", layout: layout ?? "scroll"}, load});
    return {
        id,
        contribution: helper.contribution,
        where: "browser",
        activationEvents: [],
        implement: (props) => bound(WORKBENCH_VIEWS_POINT, id, helper.implementation(props as (() => Readonly<Record<string, unknown>>) | undefined)),
    };
}

export interface StatusItemHelper<Id extends string> extends ContributionHelper<typeof WORKBENCH_STATUSBAR_ITEMS_POINT, Id, Written<ItemDeclaration, "title">> {
    readonly where: "browser";
    /** 三个函数每次渲染都调用，从响应式状态现算。 */
    implement(implementation: ItemImplementation): BoundImplementation<typeof WORKBENCH_STATUSBAR_ITEMS_POINT, Id>;
}

/**
 * 状态栏条目点了做什么：执行一条命令（助手或 `{id, args}`），或打开一个视图（视图助手）。`{id, args}` 那一项写明没有
 * `contribution`：别的助手（设置页、另一个状态栏条目）也有 `id`，不排除的话会被当成命令 id 收下，点了没有反应。
 */
type ItemCommand = CommandHelper | ViewHelper<string, ComponentLoad> | (NonNullable<ItemDeclaration["command"]> & {readonly contribution?: never});

/** 助手按它的贡献点区分：视图助手换成以它的 id 执行 `nbook.view.open`。 */
function itemCommandOf(command: ItemCommand): NonNullable<ItemDeclaration["command"]> {
    if (command.contribution === undefined) return {id: command.id, ...(command.args === undefined ? {} : {args: command.args})};
    if (command.contribution.capability === WORKBENCH_VIEWS_POINT) return {id: OPEN_VIEW_COMMAND, args: {viewId: command.id}};
    return {id: command.id};
}

/**
 * 状态栏条目（docs/specs/ui/workbench-shell.md 外壳四）：`alignment` 缺省 `right`，`order`、`priority` 缺省 0；`command`
 * 收命令助手（点击执行它，不带参数）、视图助手（点击打开那个视图）或 `{id, args}`。`title` 省略时宿主登记时补成约定键
 * `statusItems.<name>.title`（ui/workbench-shell.md 输出 33）。
 */
export function statusItem<const Id extends string, const Name extends string>(plugin: PluginBuilder<Id>, options: Omit<ItemDeclaration, "title" | "alignment" | "order" | "priority" | "command"> & {
    readonly name: Name;
    readonly title?: Text;
    readonly alignment?: ItemDeclaration["alignment"];
    readonly order?: number;
    readonly priority?: number;
    readonly command?: ItemCommand;
} & ShortNameRule<Name>): StatusItemHelper<`${Id}.${Name}`> {
    const id = contributionId(plugin.id, options.name, "状态栏条目");
    const {name: _name, title, alignment, order, priority, command, ...rest} = options;
    const declaration: Written<ItemDeclaration, "title"> = {
        ...rest,
        ...(title === undefined ? {} : {title}),
        alignment: alignment ?? "right",
        order: order ?? 0,
        priority: priority ?? 0,
        ...(command === undefined ? {} : {command: itemCommandOf(command)}),
    };
    return {
        id,
        contribution: {capability: WORKBENCH_STATUSBAR_ITEMS_POINT, id, declaration},
        where: "browser",
        activationEvents: [],
        implement: (implementation) => bound(WORKBENCH_STATUSBAR_ITEMS_POINT, id, implementation),
    };
}

export interface SceneProviderHelper<Id extends string> extends ContributionHelper<typeof WORKBENCH_THEME_SCENES_POINT, Id, SceneProviderDeclaration> {
    readonly where: "browser";
    implement(implementation: SceneProviderImplementation): BoundImplementation<typeof WORKBENCH_THEME_SCENES_POINT, Id>;
}

/**
 * 场景提供者（docs/specs/theme/skins.md 输出 18）：主题在声明里写 `sceneProvider: "<这里的贡献 id>"`，场景图由 `implement` 给的
 * `scene()` 画。实现要等入口激活才交出，工作台不替提供者激活入口，所以入口要写 `activationEvents: ["onStartup"]`。
 */
export function sceneProvider<const Id extends string, const Name extends string>(plugin: PluginBuilder<Id>, options: {readonly name: Name} & ShortNameRule<Name>): SceneProviderHelper<`${Id}.${Name}`> {
    const id = contributionId(plugin.id, options.name, "场景提供者");
    return {
        id,
        contribution: {capability: WORKBENCH_THEME_SCENES_POINT, id, declaration: {}},
        where: "browser",
        activationEvents: [],
        implement: (implementation) => bound(WORKBENCH_THEME_SCENES_POINT, id, implementation),
    };
}
