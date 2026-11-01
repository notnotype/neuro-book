/**
 * 设置窗口的模型（docs/specs/settings/settings-window.md）：左栏、当前分区与标签、尺寸、通用列表的写入与 page 分区的加载。
 * `SettingsWindow.vue` 只呈现这里的状态、把动作交回来；命令 `nbook.settings.open` 与公开键 `nbook.settings/windowOpen`
 * 也读写这里。由 `nbook.settings` 的窗口入口按激活创建，随入口这一代释放。
 *
 * 左栏与配置项的落位在第一次用到时（打开窗口、读左栏）算一次：分区目录与已接受的配置项声明在入口的一生里不变（插件
 * 集合不变）。窗口入口在每个页面启动即激活，没打开过设置的页面不必为它排序，指向不存在的分区的诊断也在那时才记。
 *
 * page 分区的实例在这里而不在组件里：离开分区时页面卸载，回到分区时用缓存的组件定义重新创建（输出 6），缓存要比页面活得
 * 久。交付撤回时同步作废缓存：撤回与再次交付可能挨在同一轮里发生，等到界面刷新再看就分不出句柄换过。
 *
 * 页面上下文按“一次显示”给：页面挂着（窗口开着、分区是当前分区、当前标签下可用、没在搜索、页面已就绪）的这段时间用同一个
 * 上下文，切换标签时不变；这段结束（离开、关窗口、重新加载、撤回）时它作废，未保存的标记随之清掉，旧页面晚到的
 * `dirty` 调用不再算数。会离开当前页面的动作都经 `requestLeave`：页面报了未保存时先等用户确认（输出 22）。
 */

import {computed, effectScope, markRaw, readonly, ref, shallowReactive, shallowRef, watch} from "@vue/reactivity";
import type {ComputedRef, Ref} from "@vue/reactivity";
import type {Component} from "vue";

import type {FormOptionSources} from "@notnotype/nb-form/vue";
import type {TextParams} from "@notnotype/nb-ui/text";

import type {CommandResult} from "nbook/plugins/commands/shared/contracts";
import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";
import type {DisplayLocale, DisplayText, TextResolver} from "nbook/shared/localized-text";
import {settingsFailureText} from "nbook/ui/settings/setting-text";
import type {SettingDefinition, SettingLayer, SettingsFailure, SettingsService, SettingUpdateOptions, SettingWriteResult} from "nbook/shared/settings";

import {SETTINGS_SECTION_CATEGORIES} from "../shared/contracts";
import type {SettingsSectionCategory} from "../shared/contracts";
import type {LayerTextPosition} from "../shared/layers";
import {settingsText} from "../shared/text";
import type {SettingsTextKey} from "../shared/text";
import type {LayerFile} from "../shared/remote-link";
import type {SettingsPageContext, SettingsPageWriteFailure} from "./contracts";
import type {SettingsPageDelivery, SettingsSectionEntry} from "./sections";
import type {SettingsWindowSource, WindowSetting} from "./window-source";

/** “其它”分区的 id：不是贡献，取一个分区声明写不出来的 id（只有一段），不会与贡献撞名。 */
export const OTHER_SECTION_ID = "other";

/** “设置文件”视图的 id（输出 23）：窗口自己的一项，同“其它”只有一段，分区贡献写不出来。 */
export const FILE_SECTION_ID = "file";

export interface SettingsWindowSize {
    readonly width: number;
    readonly height: number;
}

export const DEFAULT_SETTINGS_WINDOW_SIZE: SettingsWindowSize = {width: 960, height: 640};
/** 拖动调整的下限：左栏加一列控件还放得下。 */
export const MIN_SETTINGS_WINDOW_SIZE: SettingsWindowSize = {width: 600, height: 400};

/** 窗口尺寸的记录（`nbook.settings` 的一条 user/local 记录，见 `window-size.ts`）。 */
export interface SettingsWindowSizeStore {
    /** 记住的尺寸；没记过、读不到或记录坏了为 null，窗口用缺省尺寸。 */
    readonly remembered: Readonly<Ref<SettingsWindowSize | null>>;
    remember(size: SettingsWindowSize): void;
}

export interface SettingsWindowOptions {
    readonly source: SettingsWindowSource;
    /** `nbook.settings` 自己的配置服务：读任何已声明项。 */
    readonly settings: SettingsService;
    readonly bound: boolean;
    /** 绑定作品的书名；没有绑定为 null。 */
    readonly projectTitle: string | null;
    readonly locale: Readonly<Ref<DisplayLocale>>;
    /** 声明里的文字（分区标题、配置项标题与说明）经它解析；`TextRef` 查窗口的目录。 */
    readonly text: TextResolver;
    readonly size: SettingsWindowSizeStore;
    /** 工作台的通知（写入失败、结果未知）。 */
    readonly notify: (input: NotificationInput) => void;
    /** 作者能修的问题：配置项指向不存在的分区或小组、page 入口重试失败。 */
    readonly report: (message: string) => void;
}

export interface SettingsNavItem {
    readonly id: string;
    readonly title: string;
    readonly icon: string;
    /** 当前标签下不可用的原因；可用为 null。 */
    readonly unavailable: string | null;
}

export interface SettingsNavGroup {
    readonly category: SettingsSectionCategory;
    readonly items: ReadonlyArray<SettingsNavItem>;
}

export interface SettingsListGroup {
    /** 小组 id；分区最前、没有小标题的一组为 null，“其它”里是声明者插件 id。 */
    readonly id: string | null;
    readonly title: string | null;
    /**
     * 所属分区名：只有搜索结果里的组带（组标题写“分区名 › 小组名”，输出 21）；分区最前、没有小标题的一组，`title`
     * 就是分区名、这里为 null。
     */
    readonly parent?: string | null;
    readonly settings: ReadonlyArray<WindowSetting>;
}

interface SectionHeading {
    readonly id: string;
    readonly title: string;
    readonly description: string | null;
    /** 当前标签下不可用的原因：右边原位显示它（输出 8）；可用为 null。 */
    readonly unavailable: string | null;
}

export type SettingsListView = SectionHeading & {
    readonly kind: "list";
    readonly groups: ReadonlyArray<SettingsListGroup>;
    /** 当前标签的层不允许、因此没列出的项的标题（输出 12 的分区末尾说明）。 */
    readonly excluded: ReadonlyArray<string>;
};

/** 搜索命中的 page 分区：只给“打开”。 */
export interface SettingsPageHit {
    readonly id: string;
    readonly title: string;
    readonly description: string | null;
}

export type SettingsSectionView =
    | SettingsListView
    | (SectionHeading & {readonly kind: "page"; readonly layout: "column" | "fill"})
    /** 设置文件视图（输出 23）：`layer` 是它编辑的那一层，`path` 是这一层的文件路径（层快照带时，用户层不带）。 */
    | (SectionHeading & {readonly kind: "file"; readonly layer: SettingLayer; readonly path: string | null})
    /** 搜索结果（输出 21）：`list` 按分区与小组分组；`words` 是搜索词拆成的词（小写），标题与说明里命中的字据此标底色；`id` 是 `search`。 */
    | (SectionHeading & {readonly kind: "search"; readonly query: string; readonly words: ReadonlyArray<string>; readonly list: SettingsListView; readonly pages: ReadonlyArray<SettingsPageHit>});

/** 会离开当前页面、因此先要确认放弃未保存改动的动作（输出 22）。 */
export type SettingsLeaveTarget =
    | {readonly kind: "section"; readonly id: string}
    | {readonly kind: "layer"; readonly layer: SettingLayer}
    | {readonly kind: "close"}
    | {readonly kind: "open"; readonly section?: string; readonly layer?: SettingLayer}
    | {readonly kind: "file"; readonly layer: SettingLayer; readonly position: LayerTextPosition | null}
    | {readonly kind: "search"; readonly query: string};

/**
 * 当前标签那一层的说明（输出 13）；层正常时为 null。无效时 `reason`、`position` 来自层快照（configuration.md 输出 5），
 * 读不出文件这类没有语法位置的无效为 null：只写 `detail`、打开文件时不定位。
 */
export type SettingsLayerNotice =
    | {readonly kind: "invalid"; readonly path: string | null; readonly detail: string; readonly reason: string | null; readonly position: LayerTextPosition | null}
    | {readonly kind: "unavailable"};

/** 等设置文件视图用一次的定位（输出 13）：`layer` 是要定位的那一层的文件。 */
export interface SettingsFileLocation {
    readonly layer: SettingLayer;
    readonly position: LayerTextPosition;
}

export type SettingsPageStatus = "waiting" | "loading" | "ready" | "load-failed" | "render-failed";

export interface SettingsPageView {
    readonly delivery: SettingsPageDelivery;
    readonly status: SettingsPageStatus;
    readonly component: Component | null;
    readonly error: string | null;
    /** 每次加载与每次渲染重试加一：页面组件以它作 key，换了就重建。 */
    readonly generation: number;
    /** 一次“重试”“重新加载”进行中。 */
    readonly busy: boolean;
    readonly context: SettingsPageContext;
}

export interface SettingsWindowOpenArgs {
    readonly section?: string;
    readonly layer?: SettingLayer;
}

export interface SettingsWindow {
    /** 绑定了作品（有“本作品”标签）；在入口这一代里不变。 */
    readonly bound: Readonly<Ref<boolean>>;
    readonly locale: Readonly<Ref<DisplayLocale>>;
    /** 声明里的文字（分区标题、配置项标题与说明）经它解析；`TextRef` 查窗口的目录。 */
    readonly text: TextResolver;
    /** 绑定作品的书名；没有绑定为 null。 */
    readonly projectTitle: Readonly<Ref<string | null>>;
    readonly open: Readonly<Ref<boolean>>;
    /** 已开着时再打开加一：窗口据此把焦点拉回自己。 */
    readonly focusRequest: Readonly<Ref<number>>;
    readonly layer: Readonly<Ref<SettingLayer>>;
    /** 当前分区 id；没有任何分区时为 null。搜索时仍是搜索之前的分区。 */
    readonly section: Readonly<Ref<string | null>>;
    /** 搜索词；不在搜索时为空串。 */
    readonly query: Readonly<Ref<string>>;
    /** 当前显示的页面或设置文件视图有未保存的改动。 */
    readonly unsaved: ComputedRef<boolean>;
    /** 等用户确认放弃改动的离开；没有为 null。 */
    readonly leaving: Readonly<Ref<SettingsLeaveTarget | null>>;
    readonly size: ComputedRef<SettingsWindowSize>;
    readonly nav: ComputedRef<ReadonlyArray<SettingsNavGroup>>;
    readonly current: ComputedRef<SettingsSectionView | null>;
    readonly layerNotice: ComputedRef<SettingsLayerNotice | null>;
    /** 当前标签那一层能写：没有 `invalid`、`unavailable`（输出 13）；页面经 `context.writable` 拿到同一个值。 */
    readonly writable: ComputedRef<boolean>;
    /** 等设置文件视图用的定位；没有为 null。视图读完文件后经 `takeFileLocation` 取走。 */
    readonly fileLocation: Readonly<Ref<SettingsFileLocation | null>>;
    /** 给通用列表的 `SettingsRow` 用的配置服务：读同 `settings`，写走用户编辑路径（configuration.md 输出 19）。 */
    readonly editing: SettingsService;
    /** 选项提供者的选项源（对象本身不变）：通用列表交给每个字段，page 页面经 `context.options` 拿到同一份。 */
    options(): FormOptionSources;
    /** 命令 `nbook.settings.open`（输出 15）：参数不对时不打开、不改变窗口。 */
    openWindow(args: SettingsWindowOpenArgs): CommandResult<null>;
    /** 关窗口；页面有未保存的改动时先确认。 */
    close(): void;
    select(sectionId: string): void;
    /**
     * 打开这一层的设置文件并把光标定位到 `position`（输出 13 的层警告）：与别的离开动作一样先过未保存确认，确认后切到
     * “设置文件”分区、位置留在 `fileLocation` 等视图用；取消则不切、不留。没有 `position` 时只打开。
     */
    openFile(layer: SettingLayer, position?: LayerTextPosition): void;
    /** 取走 `layer` 这一层等着的定位并清掉（只用一次）；没有或不是这一层的为 null，不清。 */
    takeFileLocation(layer: SettingLayer): LayerTextPosition | null;
    setLayer(layer: SettingLayer): void;
    /** 改搜索词（输出 21）；空串回到原分区。从有未保存改动的页面开始搜索时先确认。 */
    search(query: string): void;
    /** 设置文件视图这一层的读写路；窗口没有绑定作品时项目层为 undefined。 */
    file(layer: SettingLayer): LayerFile | undefined;
    /** 设置文件视图报告有没有未保存的改动（输出 22、23）；它卸载时报 false。 */
    fileDirty(value: boolean): void;
    /** 放弃未保存的改动，执行等着的离开。 */
    confirmLeave(): void;
    /** 留在原处。 */
    cancelLeave(): void;
    resize(size: Partial<SettingsWindowSize>): void;
    /** 通用控件改值：写当前标签那一层；结算之前控件显示这次的值，失败后回到层里的实际值并发通知（输出 14）。 */
    write(setting: WindowSetting, value: unknown): Promise<void>;
    /** 这一项在当前标签下正在写入的值；没有在写为 undefined。 */
    pending(key: string): {readonly value: unknown} | undefined;
    /** `SettingsRow` 自己的写入（恢复默认、移除本作品的设置）没有成功。 */
    rowFailed(setting: WindowSetting, failure: {readonly code: SettingsFailure; readonly detail: string}): void;
    page(sectionId: string): SettingsPageView;
    reloadPage(sectionId: string): void;
    retryPageEntry(sectionId: string): Promise<void>;
    pageRenderFailed(sectionId: string, generation: number, message: string): void;
    retryPageRender(sectionId: string): void;
    /** 停止响应式计算并关闭窗口；入口这一代释放时调用。 */
    dispose(): void;
}

/** 搜索结果视图的 id：不是分区，与“其它”一样只有一段，分区贡献写不出来。 */
export const SEARCH_VIEW_ID = "search";

interface CatalogSection {
    readonly id: string;
    readonly title: DisplayText;
    readonly description: DisplayText | null;
    readonly icon: string;
    readonly category: SettingsSectionCategory;
    readonly order: number;
    /** `file`：窗口自己的“设置文件”视图（输出 23）。 */
    readonly kind: "list" | "page" | "file";
    readonly layout: "column" | "fill";
    readonly layers: ReadonlyArray<SettingLayer>;
    readonly groups: ReadonlyArray<{readonly id: string | null; readonly title: DisplayText | null; readonly settings: ReadonlyArray<WindowSetting>}>;
    /** page 分区：声明的搜索词与指向它、由页面画的配置项（都只用于搜索）。 */
    readonly keywords: ReadonlyArray<DisplayText>;
    readonly pageSettings: ReadonlyArray<WindowSetting>;
}

interface PageInstance {
    status: SettingsPageStatus;
    component: Component | null;
    error: string | null;
    generation: number;
    busy: boolean;
}

const LAYERS: ReadonlyArray<SettingLayer> = ["user", "project"];

const byCodeUnit = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const settingOrder = (left: WindowSetting, right: WindowSetting): number => (left.definition.declaration.order ?? 0) - (right.definition.declaration.order ?? 0) || byCodeUnit(left.definition.key, right.definition.key);

function placed(list: ReadonlyArray<CatalogSection>): {readonly list: ReadonlyArray<CatalogSection>; readonly byId: ReadonlyMap<string, CatalogSection>} {
    return {list, byId: new Map(list.map((section) => [section.id, section]))};
}

/** 左栏与配置项的落位（输出 1、2）：分区按组、`order`、id 排；配置项按 `section`、`group` 落位，落不进去的进“其它”。 */
function buildCatalog(source: SettingsWindowSource, report: (message: string) => void): ReadonlyArray<CatalogSection> {
    const declared = new Map(source.sections().map((entry) => [entry.id, entry]));
    const listed = new Map<string, Map<string | null, WindowSetting[]>>();
    const other = new Map<string, WindowSetting[]>();
    const paged = new Map<string, WindowSetting[]>();
    const place = (map: Map<string | null, WindowSetting[]>, group: string | null, setting: WindowSetting): void => {
        map.set(group, [...(map.get(group) ?? []), setting]);
    };
    for (const setting of source.settings()) {
        const {key, declaration} = setting.definition;
        const section = declaration.section === undefined ? undefined : declared.get(declaration.section);
        if (section === undefined) {
            if (declaration.section !== undefined) report(`Setting ${key} points to section ${declaration.section}, which does not exist; it goes under "Other"`);
            other.set(setting.plugin, [...(other.get(setting.plugin) ?? []), setting]);
            continue;
        }
        // 指向 page 分区的项由页面负责，不在列表里画；搜索时它们命中就列出这个页面。
        if (section.kind === "page") {
            paged.set(section.id, [...(paged.get(section.id) ?? []), setting]);
            continue;
        }
        const groups = listed.get(declaration.section!) ?? new Map<string | null, WindowSetting[]>();
        listed.set(declaration.section!, groups);
        const known = declaration.group !== undefined && (section.declaration.groups ?? []).some((group) => group.id === declaration.group);
        if (declaration.group !== undefined && !known) report(`Setting ${key} points to group ${declaration.group}, which section ${declaration.section!} does not declare; it goes first in the section`);
        place(groups, known ? declaration.group! : null, setting);
    }

    const fromEntry = (entry: SettingsSectionEntry): CatalogSection => {
        const {id, declaration} = entry;
        const heading = {
            id,
            title: declaration.title,
            description: declaration.description ?? null,
            icon: declaration.icon,
            category: declaration.category,
            order: declaration.order ?? 0,
        };
        if (entry.kind === "page") return {...heading, kind: "page", layout: entry.declaration.layout ?? "column", layers: entry.declaration.layers ?? LAYERS, groups: [], keywords: entry.declaration.keywords ?? [], pageSettings: paged.get(id) ?? []};
        const groups = listed.get(id) ?? new Map<string | null, WindowSetting[]>();
        return {
            ...heading,
            kind: "list",
            layout: "column",
            layers: LAYERS,
            groups: [
                {id: null, title: null, settings: [...(groups.get(null) ?? [])].sort(settingOrder)},
                ...(entry.declaration.groups ?? []).map((group) => ({id: group.id, title: group.title, settings: [...(groups.get(group.id) ?? [])].sort(settingOrder)})),
            ],
            keywords: [],
            pageSettings: [],
        };
    };
    const sections = [...declared.values()].map(fromEntry);
    const ordered = SETTINGS_SECTION_CATEGORIES.flatMap((category) => sections.filter((section) => section.category === category).sort((left, right) => left.order - right.order || byCodeUnit(left.id, right.id)));
    const file: CatalogSection = {
        id: FILE_SECTION_ID,
        title: settingsText("model.fileTitle"),
        description: settingsText("model.fileDescription"),
        icon: "i-lucide-file-json",
        category: "plugins",
        order: 0,
        kind: "file",
        layout: "column",
        layers: LAYERS,
        groups: [],
        keywords: [settingsText("model.fileKeyword")],
        pageSettings: [],
    };
    if (other.size === 0) return [...ordered, file];
    return [...ordered, {
        id: OTHER_SECTION_ID,
        title: settingsText("model.otherTitle"),
        description: settingsText("model.otherDescription"),
        icon: "i-lucide-ellipsis",
        category: "plugins",
        order: 0,
        kind: "list",
        layout: "column",
        layers: LAYERS,
        groups: [...other].sort(([left], [right]) => byCodeUnit(left, right)).map(([plugin, settings]) => ({id: plugin, title: plugin, settings: [...settings].sort(settingOrder)})),
        keywords: [],
        pageSettings: [],
    }, file];
}

/** 一项配置在搜索里比对的文字：标题、说明、键与固定选项名，两种语言都在（输出 21）。 */
function settingText(setting: WindowSetting, resolver: TextResolver): string {
    const {key, declaration} = setting.definition;
    const texts: Array<DisplayText | undefined> = [declaration.title, declaration.description];
    const choices = declaration.choices;
    if (Array.isArray(choices)) texts.push(...choices.map((choice) => choice.title));
    return [key, ...texts.flatMap((text) => (text === undefined ? [] : resolver.variants(text)))].join("\n").toLocaleLowerCase();
}

function localizedText(texts: ReadonlyArray<DisplayText | null>, resolver: TextResolver): string {
    return texts.flatMap((text) => (text === null ? [] : resolver.variants(text))).join("\n").toLocaleLowerCase();
}

/** 按空白分词、不分大小写，每个词都要出现。 */
function matches(haystack: string, words: ReadonlyArray<string>): boolean {
    return words.every((word) => haystack.includes(word));
}

export function createSettingsWindow(options: SettingsWindowOptions): SettingsWindow {
    const {source} = options;
    const scope = effectScope(true);
    let built: {readonly list: ReadonlyArray<CatalogSection>; readonly byId: ReadonlyMap<string, CatalogSection>} | null = null;
    const catalog = (): ReadonlyArray<CatalogSection> => (built ??= placed(buildCatalog(source, options.report))).list;
    const sectionOf = (id: string): CatalogSection | undefined => {
        catalog();
        return built?.byId.get(id);
    };
    const text = (key: SettingsTextKey, params?: TextParams): string => options.text.t(settingsText(key, params));

    const open = ref(false);
    const focusRequest = ref(0);
    const layer = ref<SettingLayer>("user");
    /** 用户或命令选过的分区；没选过时是左栏的第一个（刷新后回到第一个分区）。 */
    const chosen = ref<string | null>(null);
    const section = computed(() => chosen.value ?? catalog()[0]?.id ?? null);
    const query = ref("");
    /** 搜索词拆成的词：空时不在搜索。 */
    const words = computed(() => query.value.toLocaleLowerCase().split(/\s+/u).filter((word) => word !== ""));

    /** 分区在这个标签下不可用的原因（输出 8）；可用为 null。 */
    const unavailableIn = (entry: CatalogSection, tab: SettingLayer): string | null => {
        const reason = tab === "project" ? "model.userOnlySection" : "model.projectOnlySection";
        if (entry.kind === "page") return entry.layers.includes(tab) ? null : text(reason);
        if (entry.kind === "file") return null;
        const all = entry.groups.flatMap((group) => group.settings);
        if (all.length === 0) return text("model.emptySection");
        return all.some((setting) => setting.definition.declaration.layers.includes(tab)) ? null : text(reason);
    };

    const view = (entry: CatalogSection, tab: SettingLayer): SettingsSectionView => {
        const heading = {
            id: entry.id,
            title: options.text.t(entry.title),
            description: entry.description === null ? null : options.text.t(entry.description),
            unavailable: unavailableIn(entry, tab),
        };
        if (entry.kind === "page") return {...heading, kind: "page", layout: entry.layout};
        if (entry.kind === "file") {
            const state = source.layer(tab);
            return {...heading, kind: "file", layer: tab, path: state.status === "ok" || state.status === "invalid" ? state.path : null};
        }
        const allowed = (setting: WindowSetting): boolean => setting.definition.declaration.layers.includes(tab);
        return {
            ...heading,
            kind: "list",
            groups: entry.groups
                .map((group) => ({id: group.id, title: group.title === null ? null : options.text.t(group.title), settings: group.settings.filter(allowed)}))
                .filter((group) => group.settings.length > 0),
            excluded: entry.groups.flatMap((group) => group.settings.filter((setting) => !allowed(setting))).map((setting) => options.text.t(setting.definition.declaration.title)),
        };
    };

    // ── 写入 ───────────────────────────────────────────────────────────────

    let writeToken = 0;
    const writes = shallowReactive(new Map<string, {readonly token: number; readonly value: unknown}>());
    const pendingKey = (tab: SettingLayer, key: string): string => `${tab}\n${key}`;

    // 通知交文字引用，视口显示时才翻（docs/specs/workbench/notifications.md 输出 9），切换语言后已显示的通知随之换文字；代入的
    // 设置项标题与失败原因只能是字符串，是发通知时按当前语言翻好的片段。
    const notifyNotSaved = (title: string, reason: string, uncertain: boolean): void => {
        options.notify({tone: "warning", title: settingsText(uncertain ? "model.unknownTitle" : "model.notSavedTitle"), message: settingsText("model.notSaved", {title, reason})});
    };
    const notifyFailure = (setting: WindowSetting, code: SettingsFailure, detail: string): void => {
        notifyNotSaved(options.text.t(setting.definition.declaration.title), settingsFailureText(code, detail, options.text), code === "unknown-outcome");
    };

    const editing: SettingsService = {
        get: (setting) => options.settings.get(setting),
        inspect: (setting) => options.settings.inspect(setting),
        declaration: (setting) => options.settings.declaration(setting),
        onDidChange: (listener) => options.settings.onDidChange(listener),
        // `SettingsRow` 总给出层；没给时写当前标签那一层，与通用控件一致。
        update: <T>(setting: SettingDefinition<T>, value: T | undefined, update: SettingUpdateOptions = {}): Promise<SettingWriteResult> => {
            const target = update.layer === undefined || update.layer === "auto" ? layer.value : update.layer;
            return value === undefined ? source.unset(setting.key, target) : source.edit(setting.key, target, value);
        },
    };

    // ── page 分区 ──────────────────────────────────────────────────────────

    /**
     * 实例表本身不是响应式的：界面渲染时第一次问到某个分区会建实例，在渲染里改响应式的表会让读它的组件再渲染一遍。
     * 每个实例是浅层响应式，界面读它的字段。
     */
    const pages = new Map<string, PageInstance>();
    /**
     * 每个分区当前这次显示的上下文（见模块头）：显示期间切换标签时页面拿到的是同一个对象，`layer` 跟着变（输出 6）；这次
     * 显示结束时从表里删掉，下次显示另建一个。
     */
    const visits = new Map<string, {readonly token: number; readonly context: SettingsPageContext}>();
    let visitToken = 0;
    /**
     * 显示结束时加一：`page()` 读它，界面里缓存 `page()` 结果的计算值因此重算、拿到新的上下文。表本身不是响应式的（见上面
     * 实例表的说明），不读它的话关窗再开、分区与实例都没变，计算值会一直交出作废的上下文。
     */
    const visitVersion = shallowRef(0);
    /** 报了未保存改动的那次显示；没有为 null。 */
    const dirtyVisit = ref<number | null>(null);
    const projectTitle = readonly(ref(options.projectTitle));
    const readonlyLayer = readonly(layer);
    /** 当前标签那一层的说明（输出 13）；层正常时为 null。 */
    const layerNotice = computed<SettingsLayerNotice | null>(() => {
        const state = source.layer(layer.value);
        if (state.status === "invalid") return {kind: "invalid", path: state.path, detail: state.detail, reason: state.reason ?? null, position: state.position ?? null};
        if (state.status === "unavailable" || state.status === "pending") return {kind: "unavailable"};
        return null;
    });
    const writable = computed(() => layerNotice.value === null);

    const contextOf = (id: string): SettingsPageContext => {
        let visit = visits.get(id);
        if (visit === undefined) {
            const token = (visitToken += 1);
            const dirty = (value: boolean): void => {
                // 这次显示已经结束（旧页面晚到的调用）：不算数。
                if (visits.get(id)?.token !== token) return;
                if (value) dirtyVisit.value = token;
                else if (dirtyVisit.value === token) dirtyVisit.value = null;
            };
            const reportWriteFailure = (subject: string, failure: SettingsPageWriteFailure): void => notifyNotSaved(subject, failure.reason, failure.uncertain === true);
            visit = {token, context: markRaw({id, layer: readonlyLayer as Readonly<Ref<SettingLayer>>, projectTitle: projectTitle as Readonly<Ref<string | null>>, writable, options: source.options(), dirty, reportWriteFailure})};
            visits.set(id, visit);
        }
        return visit.context;
    };

    const endVisit = (id: string): void => {
        const visit = visits.get(id);
        if (visit === undefined) return;
        visits.delete(id);
        if (dirtyVisit.value === visit.token) dirtyVisit.value = null;
        visitVersion.value += 1;
    };

    const instanceOf = (id: string): PageInstance => {
        let instance = pages.get(id);
        if (instance === undefined) {
            instance = shallowReactive<PageInstance>({status: "waiting", component: null, error: null, generation: 0, busy: false});
            pages.set(id, instance);
        }
        return instance;
    };

    const load = async (id: string): Promise<void> => {
        const instance = instanceOf(id);
        // 新的一次加载是新的一次显示：加载中就给出去的上下文（渲染占位时取的）随之作废。
        endVisit(id);
        const generation = (instance.generation += 1);
        Object.assign(instance, {status: "loading", component: null, error: null});
        const result = await source.load(id);
        // 等待期间交付被撤回、窗口关闭（两者都让实例回到 waiting）或又发起了新加载：这次结果作废。
        if (instance.generation !== generation || instance.status !== "loading") return;
        if (result.status === "stale") instance.status = "waiting";
        else if (result.status === "failed") Object.assign(instance, {status: "load-failed", error: result.error instanceof Error ? result.error.message : String(result.error)});
        else Object.assign(instance, {status: "ready", component: markRaw(result.component)});
    };

    scope.run(() => {
        // 交付撤回：卸掉组件、丢弃已加载的定义（输出 4 的状态表）。同步执行，见模块头。
        for (const entry of source.sections()) {
            if (entry.kind !== "page") continue;
            watch(() => source.delivery(entry.id).kind === "available", (available) => {
                const instance = pages.get(entry.id);
                if (available || instance === undefined || instance.status === "waiting") return;
                instance.generation += 1;
                Object.assign(instance, {status: "waiting", component: null, error: null});
            });
        }
        // 按需激活（输出 4）：每次显示一个 page 分区（窗口开着、它是当前分区、当前标签下可用）都请注册表看一次；停在
        // 这个分区时交付状态变了（例如入口从受阻恢复成未激活）也再看一次。注册表只在入口未激活时触发。
        const shownPage = (): string | null => {
            if (!open.value) return null;
            const id = section.value;
            const entry = id === null ? undefined : sectionOf(id);
            return entry?.kind === "page" && entry.layers.includes(layer.value) ? entry.id : null;
        };
        watch([shownPage, () => {
            const id = shownPage();
            return id === null ? null : source.delivery(id).kind;
        }], ([id]) => {
            if (id !== null) source.activate(id);
        }, {immediate: true});
        // 第一次显示时加载（输出 5）：窗口开着、它是当前分区、当前标签下可用、句柄已发布。
        // 一次显示的起止（见模块头）：页面挂着时是“分区 + 代际”，不挂时为 null；变了就结束上一次显示。同步执行：卸载与
        // 新页面的挂载之间，旧上下文已经作废。
        watch(() => {
            if (!open.value || words.value.length > 0) return null;
            const id = section.value;
            const entry = id === null ? undefined : sectionOf(id);
            if (entry?.kind !== "page" || !entry.layers.includes(layer.value)) return null;
            const instance = instanceOf(entry.id);
            return instance.status === "ready" ? {id: entry.id, generation: instance.generation} : null;
        }, (next, previous) => {
            if (previous !== null && previous !== undefined && (next === null || next.id !== previous.id || next.generation !== previous.generation)) endVisit(previous.id);
        });
        watch(() => {
            // 先看开着与否：关着时不读当前分区，落位不必提前算。
            if (!open.value) return null;
            const id = section.value;
            const entry = id === null ? undefined : sectionOf(id);
            if (entry?.kind !== "page" || !entry.layers.includes(layer.value)) return null;
            return source.delivery(entry.id).kind === "available" ? entry.id : null;
        }, (id) => {
            if (id !== null && instanceOf(id).status === "waiting") void load(id);
        }, {immediate: true});
    });

    // ── 窗口 ───────────────────────────────────────────────────────────────

    const size = computed(() => options.size.remembered.value ?? DEFAULT_SETTINGS_WINDOW_SIZE);
    const nav = computed(() => SETTINGS_SECTION_CATEGORIES
        .map((category) => ({
            category,
            items: catalog().filter((entry) => entry.category === category).map((entry) => ({id: entry.id, title: options.text.t(entry.title), icon: entry.icon, unavailable: unavailableIn(entry, layer.value)})),
        }))
        .filter((group) => group.items.length > 0));
    /** 搜索结果（输出 21）：只列当前标签这一层允许的项与可用的 page 分区。 */
    const searchView = (tab: SettingLayer): SettingsSectionView => {
        const allowed = (setting: WindowSetting): boolean => setting.definition.declaration.layers.includes(tab);
        const groups: SettingsListGroup[] = [];
        const pageHits: SettingsPageHit[] = [];
        for (const entry of catalog()) {
            const title = options.text.t(entry.title);
            if (entry.kind === "page" || entry.kind === "file") {
                if (!entry.layers.includes(tab)) continue;
                const own = localizedText([entry.title, entry.description, ...entry.keywords], options.text);
                if (matches(own, words.value) || entry.pageSettings.some((setting) => matches(settingText(setting, options.text), words.value))) {
                    pageHits.push({id: entry.id, title, description: entry.description === null ? null : options.text.t(entry.description)});
                }
                continue;
            }
            for (const group of entry.groups) {
                const hits = group.settings.filter((setting) => allowed(setting) && matches(settingText(setting, options.text), words.value));
                if (hits.length === 0) continue;
                const groupTitle = group.title === null ? null : options.text.t(group.title);
                // 同一个分区的几个小组各是一组，id 要区分开（键与 `data-settings-group`）。
                groups.push({id: `${entry.id}#${group.id ?? ""}`, title: groupTitle ?? title, parent: groupTitle === null ? null : title, settings: hits});
            }
        }
        const heading = {id: SEARCH_VIEW_ID, title: text("model.searchTitle"), description: null, unavailable: null};
        return {...heading, kind: "search", query: query.value, words: words.value, list: {...heading, kind: "list", groups, excluded: []}, pages: pageHits};
    };
    const current = computed(() => {
        if (words.value.length > 0) return searchView(layer.value);
        const entry = section.value === null ? undefined : sectionOf(section.value);
        return entry === undefined ? null : view(entry, layer.value);
    });
    const fileUnsaved = ref(false);
    const unsaved = computed(() => dirtyVisit.value !== null || fileUnsaved.value);
    const leaving = ref<SettingsLeaveTarget | null>(null);
    /** 确认通过的“打开设置文件并定位”留给设置文件视图的位置：视图读完文件取走一次；之后的任何别的动作都作废它。 */
    const fileLocation = ref<SettingsFileLocation | null>(null);

    const performClose = (): void => {
        open.value = false;
        // 关窗口结束所有的显示，包括还在加载、从没挂上的页面的上下文。
        for (const id of [...visits.keys()]) endVisit(id);
        // 搜索词不记（输出 21）。
        query.value = "";
        // 进行中的加载作废（输出 5）：结果回来时不挂组件、不记为失败；实例回到 waiting，重开时按当前句柄重新加载。
        for (const instance of pages.values()) {
            if (instance.status !== "loading") continue;
            instance.generation += 1;
            instance.status = "waiting";
        }
    };

    const perform = (target: SettingsLeaveTarget): void => {
        // 没取走的定位只属于紧接着的那一次打开文件：去别处、关窗口之后不再有效。
        fileLocation.value = null;
        switch (target.kind) {
            case "section":
                query.value = "";
                chosen.value = target.id;
                return;
            case "layer":
                layer.value = target.layer;
                return;
            case "close":
                performClose();
                return;
            case "open":
                if (target.section !== undefined) {
                    query.value = "";
                    chosen.value = target.section;
                }
                if (target.layer !== undefined) layer.value = target.layer;
                return;
            case "file":
                query.value = "";
                chosen.value = FILE_SECTION_ID;
                layer.value = target.layer;
                if (target.position !== null) fileLocation.value = {layer: target.layer, position: target.position};
                return;
            case "search":
                query.value = target.query;
                return;
        }
    };

    /** 会离开当前页面的动作：页面报了未保存时先等确认；确认框开着时又来一个，等着的换成后来的（输出 22）。 */
    const requestLeave = (target: SettingsLeaveTarget): void => {
        if (unsaved.value) leaving.value = target;
        else perform(target);
    };

    return {
        bound: readonly(ref(options.bound)),
        locale: options.locale,
        text: options.text,
        projectTitle,
        open: readonly(open),
        focusRequest: readonly(focusRequest),
        layer: readonlyLayer,
        section,
        query: readonly(query),
        unsaved,
        leaving: readonly(leaving) as Readonly<Ref<SettingsLeaveTarget | null>>,
        size,
        nav,
        current,
        layerNotice,
        writable,
        fileLocation: readonly(fileLocation) as Readonly<Ref<SettingsFileLocation | null>>,
        editing,
        options: () => source.options(),
        openWindow: (args) => {
            if (args.section !== undefined && sectionOf(args.section) === undefined) return {ok: false, code: "invalid-args", reason: text("model.unknownSection", {section: args.section})};
            if (args.layer === "project" && !options.bound) return {ok: false, code: "unavailable", reason: text("model.noProject")};
            const target: SettingsLeaveTarget = {kind: "open", ...(args.section === undefined ? {} : {section: args.section}), ...(args.layer === undefined ? {} : {layer: args.layer})};
            if (open.value) {
                const moves = (args.section !== undefined && (args.section !== section.value || query.value !== "")) || (args.layer !== undefined && args.layer !== layer.value);
                if (moves) requestLeave(target);
                focusRequest.value += 1;
            } else {
                perform(target);
                open.value = true;
            }
            return {ok: true, value: null};
        },
        close: () => requestLeave({kind: "close"}),
        select: (id) => {
            if (sectionOf(id) === undefined) return;
            if (id === section.value && query.value === "") return;
            requestLeave({kind: "section", id});
        },
        openFile: (target, position) => {
            if (target === "project" && !options.bound) return;
            requestLeave({kind: "file", layer: target, position: position ?? null});
        },
        takeFileLocation: (target) => {
            const pending = fileLocation.value;
            if (pending === null || pending.layer !== target) return null;
            fileLocation.value = null;
            return pending.position;
        },
        setLayer: (tab) => {
            if ((tab === "user" || options.bound) && tab !== layer.value) requestLeave({kind: "layer", layer: tab});
        },
        search: (next) => {
            if (next === query.value) return;
            // 从不在搜索变成在搜索会卸载当前页面，要先过未保存保护；只有空白的搜索词不算在搜索（页面还挂着）。
            const starting = words.value.length === 0 && next.trim() !== "";
            if (starting) requestLeave({kind: "search", query: next});
            else query.value = next;
        },
        confirmLeave: () => {
            const target = leaving.value;
            if (target === null) return;
            leaving.value = null;
            // 放弃改动：结束这次显示。切换标签时页面本来不重建，这里换一个代际让它重建，草稿随之丢掉。设置文件视图换了
            // 标签或卸载时自己丢掉草稿。
            fileUnsaved.value = false;
            const id = section.value;
            if (id !== null && visits.has(id)) {
                const instance = pages.get(id);
                if (instance?.status === "ready") instance.generation += 1;
                endVisit(id);
            }
            perform(target);
        },
        cancelLeave: () => {
            leaving.value = null;
        },
        file: (tab) => source.file(tab),
        fileDirty: (value) => {
            fileUnsaved.value = value;
        },
        resize: (next) => {
            const width = Math.max(MIN_SETTINGS_WINDOW_SIZE.width, Math.round(next.width ?? size.value.width));
            const height = Math.max(MIN_SETTINGS_WINDOW_SIZE.height, Math.round(next.height ?? size.value.height));
            if (width === size.value.width && height === size.value.height) return;
            options.size.remember({width, height});
        },
        write: async (setting, value) => {
            const tab = layer.value;
            const key = pendingKey(tab, setting.definition.key);
            const token = (writeToken += 1);
            writes.set(key, {token, value});
            try {
                const result = await source.edit(setting.definition.key, tab, value);
                if (!result.ok) notifyFailure(setting, result.code, result.detail);
            } finally {
                // 期间同一项又写了一次：留着那一次的值，等它自己结算。
                if (writes.get(key)?.token === token) writes.delete(key);
            }
        },
        pending: (key) => {
            const entry = writes.get(pendingKey(layer.value, key));
            return entry === undefined ? undefined : {value: entry.value};
        },
        rowFailed: (setting, failure) => notifyFailure(setting, failure.code, failure.detail),
        page: (id) => {
            void visitVersion.value;
            const instance = instanceOf(id);
            return {delivery: source.delivery(id), status: instance.status, component: instance.component, error: instance.error, generation: instance.generation, busy: instance.busy, context: contextOf(id)};
        },
        reloadPage: (id) => {
            if (instanceOf(id).status === "load-failed") void load(id);
        },
        retryPageEntry: async (id) => {
            const instance = instanceOf(id);
            if (instance.busy) return;
            instance.busy = true;
            try {
                const result = await source.retry(id);
                if (result.status === "failed") options.report(`Retrying the entry of page section ${id} did not succeed: ${result.reason}`);
            } finally {
                instance.busy = false;
            }
        },
        pageRenderFailed: (id, generation, message) => {
            const instance = instanceOf(id);
            if (instance.generation !== generation || instance.status !== "ready") return;
            Object.assign(instance, {status: "render-failed", error: message});
        },
        retryPageRender: (id) => {
            const instance = instanceOf(id);
            if (instance.status !== "render-failed" || instance.component === null) return;
            instance.generation += 1;
            Object.assign(instance, {status: "ready", error: null});
        },
        dispose: () => {
            open.value = false;
            leaving.value = null;
            scope.stop();
        },
    };
}
