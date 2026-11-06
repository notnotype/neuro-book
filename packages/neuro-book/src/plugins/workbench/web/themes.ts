/**
 * 已接受的主题（docs/specs/theme/skins.md）：按贡献点收，算出一个明暗下要写到文档根的东西。声明是数据，这里不认识具体哪一套。
 */

import {shallowRef} from "@vue/reactivity";

import type {ContributionDescriptor, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {ProductTheme} from "nbook/ui/theme/product-theme-shape";
import {SKIN_VARS} from "nbook/ui/theme/skin-vars";

import {rawUrlOf, THEME_ASSET_DIRECTORY_ADDRESS} from "nbook/plugins/files/shared/contracts";

import {DEFAULT_THEME_ID} from "../shared/themes";
import type {SceneProviderDeclaration, SceneProviderImplementation, ThemeDeclaration} from "../shared/themes";
import {USER_THEME_PLUGIN, userThemeProblem} from "../shared/user-themes";
import {SceneProviders} from "./scene-providers";
import type {PublishedProvider} from "./scene-providers";
import type {SceneProviderOptions} from "./scene-providers";
import type {UserTheme} from "../shared/user-themes";

export interface ThemeEntry {
    readonly id: string;
    readonly plugin: string;
    readonly declaration: ThemeDeclaration;
}

export type ThemeAssetUrl = (plugin: string, path: string) => string | null;

/** 算出一个明暗下的变量。写字符串是因为这些只进 CSS；没写的不出现，各位置看到变量没有就和没有主题一样。 */
export function themeVars(entry: ThemeEntry, appearance: "light" | "dark", assetUrl: ThemeAssetUrl, working = false, sceneOverride?: string): {readonly vars: Readonly<Record<string, string>>; readonly scene: boolean; readonly icons: Readonly<Record<string, string>>} {
    const {declaration, plugin} = entry;
    const look = declaration[appearance];
    const vars: Record<string, string> = {...look.colors, ...look.vars};
    const set = (name: string, value: string | undefined): void => {
        if (value !== undefined) vars[name] = value;
    };
    set(SKIN_VARS.fontDisplay, declaration.fonts?.display);
    set(SKIN_VARS.fontProse, declaration.fonts?.prose);
    set(SKIN_VARS.frameLine, look.frame?.line);
    set(SKIN_VARS.activityBarSurface, look.activityBar?.surface);
    set(SKIN_VARS.activityBarForeground, look.activityBar?.foreground);
    set(SKIN_VARS.activityBarActive, look.activityBar?.active);
    set(SKIN_VARS.activityBarOrnament, look.activityBar?.ornament);
    if (look.activityBar !== undefined) vars[SKIN_VARS.activityBarHover] = "color-mix(in srgb, currentColor 14%, transparent)";
    if (look.activityBar?.ornament !== undefined) {
        vars[SKIN_VARS.activityBarOrnamentSize] = "5px";
        vars[SKIN_VARS.activityBarOrnamentWidth] = "1px";
    }
    // 工作中且写了工作态场景、并且它解析得出时用它；其余情形都是平常的场景图。
    const workingUrl = working && look.workingScene !== undefined ? assetUrl(plugin, look.workingScene) : null;
    // 提供者画好的图（已解码的对象 URL）优先；没有时是后备的静态图。
    const url = sceneOverride ?? workingUrl ?? (look.scene === undefined ? null : assetUrl(plugin, look.scene));
    if (url !== null) {
        const {crop} = declaration;
        vars[SKIN_VARS.scene] = `url("${url}")`;
        set(SKIN_VARS.emptyPosition, crop?.empty?.position);
        // 内容中心在 contentX 处，等于内容区右边多留 (1 - 2x) 的宽度。
        if (crop?.empty?.contentX !== undefined) vars[SKIN_VARS.emptyShift] = `${String((1 - 2 * crop.empty.contentX) * 100)}%`;
        set(SKIN_VARS.marginLeftSize, crop?.marginLeft?.size);
        set(SKIN_VARS.marginLeftPosition, crop?.marginLeft?.position);
        set(SKIN_VARS.marginRightSize, crop?.marginRight?.size);
        set(SKIN_VARS.marginRightPosition, crop?.marginRight?.position);
        set(SKIN_VARS.sidebarCornerSize, crop?.sidebarCorner?.size);
        set(SKIN_VARS.sidebarCornerPosition, crop?.sidebarCorner?.position);
        set(SKIN_VARS.auxiliaryCornerSize, crop?.auxiliaryCorner?.size);
        set(SKIN_VARS.auxiliaryCornerPosition, crop?.auxiliaryCorner?.position);
    }
    // 图标文件解析不出（不在插件的素材表里）的那一个不换，别的照常。
    const icons: Record<string, string> = {};
    for (const [name, path] of Object.entries(look.icons ?? {})) {
        const iconUrl = assetUrl(plugin, path);
        if (iconUrl !== null) icons[name] = iconUrl;
    }
    return {vars, scene: url !== null, icons};
}

/** “我的主题”的素材（场景图、工作态场景、图标）在 `user://theme-assets/` 下，经已有的字节读取路由显示。 */
export const userThemeAssetUrl = (path: string): string | null => rawUrlOf(`${THEME_ASSET_DIRECTORY_ADDRESS}/${path}`, null);

/** 编辑器开着时用来画文档根的那一套（docs/specs/theme/editor.md 输出 4）：不改设置，关掉编辑器就清掉。 */
export interface ThemePreview {
    readonly id: string;
    readonly appearance: "light" | "dark";
    /** 强制预览哪种 Agent 状态的场景（docs/specs/theme/editor.md 输出 19）；缺省跟随真实状态。 */
    readonly working?: boolean;
}

export class ThemeCatalog {
    /** 插件贡献的主题。 */
    readonly #entries = shallowRef<ReadonlyMap<string, ThemeEntry>>(new Map());
    /** “我的主题”：从 Storage 的用户记录读来，和插件主题进同一个列表。 */
    readonly #mine = shallowRef<ReadonlyMap<string, ThemeEntry>>(new Map());
    readonly #preview = shallowRef<ThemePreview | null>(null);
    readonly #assetUrl: ThemeAssetUrl;
    readonly #report: (id: string) => void;
    readonly #reported = new Set<string>();
    readonly #scenes: SceneProviders;

    constructor(initial: ReadonlyArray<ContributionDescriptor<ThemeDeclaration>>, assetUrl: ThemeAssetUrl, report: (id: string) => void, scenes: SceneProviderOptions = {}) {
        this.#assetUrl = assetUrl;
        this.#report = report;
        this.#scenes = new SceneProviders(scenes);
        this.#entries.value = new Map(initial.map((item) => [item.id, {id: item.id, plugin: item.plugin, declaration: item.declaration}]));
    }

    /** 插件的启停以后会走到这里，所以目录不只取激活时的快照。 */
    receiver(): ContributionReceiver<ThemeDeclaration> {
        return {
            published: (handle) => {
                this.#scenes.entryChanged(handle.id);
                const next = new Map(this.#entries.value);
                next.set(handle.id, {id: handle.id, plugin: handle.plugin, declaration: handle.declaration});
                this.#entries.value = next;
            },
            revoke: (handle) => {
                this.#scenes.entryChanged(handle.id);
                const next = new Map(this.#entries.value);
                next.delete(handle.id);
                this.#entries.value = next;
            },
        };
    }

    /** `workbench.theme-scenes` 的接收者：提供者发布后可用，撤回时取消它名下在飞的请求、撤销它画过的图。 */
    sceneReceiver(): ContributionReceiver<SceneProviderDeclaration, SceneProviderImplementation> {
        return this.#scenes.receiver();
    }

    /** 页面卸载时：取消在飞的请求、清定时器、撤销全部对象 URL。 */
    dispose(): void {
        this.#scenes.dispose();
    }

    /**
     * 换上一份新的“我的主题”。逐条过 `userThemeProblem`：不合格的那一条不进目录，原因交给 `reportProblem`（调用方按 id 去重地记诊断），
     * 别的照常。
     */
    setUserThemes(themes: ReadonlyArray<unknown>, reportProblem: (id: string, problem: string) => void): void {
        const next = new Map<string, ThemeEntry>();
        for (const theme of themes) {
            const problem = userThemeProblem(theme);
            if (problem !== null) {
                reportProblem(typeof theme === "object" && theme !== null && "id" in theme ? String((theme as {id: unknown}).id) : "?", problem);
                continue;
            }
            const {id, declaration} = theme as UserTheme;
            next.set(id, {id, plugin: USER_THEME_PLUGIN, declaration});
        }
        // 换了提供者或删掉的我的主题：它名下画好的图作废（缓存键不含提供者，不清就会拿到旧提供者的图）。
        for (const [id, previous] of this.#mine.value) {
            if (next.get(id)?.declaration.sceneProvider !== previous.declaration.sceneProvider) this.#scenes.entryChanged(id);
        }
        this.#mine.value = next;
    }

    /** 编辑器开着时的预览；`null` 清掉。 */
    setPreview(preview: ThemePreview | null): void {
        this.#preview.value = preview;
    }

    get preview(): ThemePreview | null {
        return this.#preview.value;
    }

    /** 一个主题在某个明暗下的场景图地址（插件主题走插件文件端点，我的主题走字节读取路由）；没有场景图或解析不出时为 null。 */
    sceneUrl(entry: ThemeEntry, appearance: "light" | "dark"): string | null {
        const scene = entry.declaration[appearance].scene;
        return scene === undefined ? null : this.#assetUrl(entry.plugin, scene);
    }

    /** 主题里的一个素材路径解析成的地址（插件主题走插件文件端点，我的主题走字节读取路由）；解析不出时为 null。 */
    assetUrl(entry: ThemeEntry, path: string): string | null {
        return this.#assetUrl(entry.plugin, path);
    }

    /** 当前已发布的场景提供者（贡献 id 与可选的显示名），供编辑器的下拉用。 */
    get sceneProviders(): ReadonlyArray<PublishedProvider> {
        return this.#scenes.published;
    }

    get list(): ReadonlyArray<ThemeEntry> {
        return [...this.#entries.value.values(), ...this.#mine.value.values()];
    }

    has(id: string): boolean {
        return this.#entries.value.has(id) || this.#mine.value.has(id);
    }

    #entry(id: string): ThemeEntry | undefined {
        return this.#entries.value.get(id) ?? this.#mine.value.get(id);
    }

    /** 按候选（项目层、用户层这样从近到远）取第一个认识的，都不认识用缺省主题；设置不改写，插件回来后自然恢复。没认出的 id 只报一次。 */
    effectiveId(candidates: ReadonlyArray<string | undefined>): string {
        for (const id of candidates) {
            if (id === undefined) continue;
            if (this.has(id)) return id;
            if (!this.#reported.has(id)) {
                this.#reported.add(id);
                this.#report(id);
            }
        }
        return DEFAULT_THEME_ID;
    }

    /** 一个明暗下要写的东西；`working` 为真且主题写了工作态场景时换那一张；id 不在目录里时用缺省主题（退回的顺序由调用方决定，这里只保证总有得画）。 */
    resolve(id: string, appearance: "light" | "dark", working = false): ProductTheme {
        const entry = this.#entry(id) ?? this.#entry(DEFAULT_THEME_ID);
        if (entry === undefined) return {base: DEFAULT_THEME_ID, skin: DEFAULT_THEME_ID, vars: {}, scene: false, icons: {}};
        const dynamic = this.#scenes.sceneFor(entry, appearance, working);
        return {base: entry.declaration.base, skin: entry.id, ...themeVars(entry, appearance, this.#assetUrl, working, dynamic)};
    }
}
