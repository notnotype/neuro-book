/**
 * 已接受的主题（docs/specs/theme/skins.md）：按贡献点收，算出一个明暗下要写到文档根的东西。声明是数据，这里不认识具体哪一套。
 */

import {shallowRef} from "@vue/reactivity";

import type {ContributionDescriptor, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {ProductTheme} from "nbook/ui/theme/product-theme-shape";
import {SKIN_VARS} from "nbook/ui/theme/skin-vars";

import {rawUrlOf, THEME_ASSET_DIRECTORY_ADDRESS} from "nbook/plugins/files/shared/contracts";

import {DEFAULT_THEME_ID} from "../shared/themes";
import type {ThemeDeclaration} from "../shared/themes";
import {USER_THEME_PLUGIN, userThemeProblem} from "../shared/user-themes";
import type {UserTheme} from "../shared/user-themes";

export interface ThemeEntry {
    readonly id: string;
    readonly plugin: string;
    readonly declaration: ThemeDeclaration;
}

export type ThemeAssetUrl = (plugin: string, path: string) => string | null;

/** 算出一个明暗下的变量。写字符串是因为这些只进 CSS；没写的不出现，各位置看到变量没有就和没有主题一样。 */
export function themeVars(entry: ThemeEntry, appearance: "light" | "dark", assetUrl: ThemeAssetUrl): {readonly vars: Readonly<Record<string, string>>; readonly scene: boolean} {
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
    const url = look.scene === undefined ? null : assetUrl(plugin, look.scene);
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
    return {vars, scene: url !== null};
}

/** “我的主题”的场景图在 `user://theme-assets/` 下，经已有的字节读取路由显示。 */
export const userThemeSceneUrl = (path: string): string | null => rawUrlOf(`${THEME_ASSET_DIRECTORY_ADDRESS}/${path}`, null);

/** 编辑器开着时用来画文档根的那一套（docs/specs/theme/editor.md 输出 4）：不改设置，关掉编辑器就清掉。 */
export interface ThemePreview {
    readonly id: string;
    readonly appearance: "light" | "dark";
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

    constructor(initial: ReadonlyArray<ContributionDescriptor<ThemeDeclaration>>, assetUrl: ThemeAssetUrl, report: (id: string) => void) {
        this.#assetUrl = assetUrl;
        this.#report = report;
        this.#entries.value = new Map(initial.map((item) => [item.id, {id: item.id, plugin: item.plugin, declaration: item.declaration}]));
    }

    /** 插件的启停以后会走到这里，所以目录不只取激活时的快照。 */
    receiver(): ContributionReceiver<ThemeDeclaration> {
        return {
            published: (handle) => {
                const next = new Map(this.#entries.value);
                next.set(handle.id, {id: handle.id, plugin: handle.plugin, declaration: handle.declaration});
                this.#entries.value = next;
            },
            revoke: (handle) => {
                const next = new Map(this.#entries.value);
                next.delete(handle.id);
                this.#entries.value = next;
            },
        };
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

    /** 一个明暗下要写的东西；id 不在目录里时用缺省主题（退回的顺序由调用方决定，这里只保证总有得画）。 */
    resolve(id: string, appearance: "light" | "dark"): ProductTheme {
        const entry = this.#entry(id) ?? this.#entry(DEFAULT_THEME_ID);
        if (entry === undefined) return {base: DEFAULT_THEME_ID, vars: {}, scene: false};
        return {base: entry.declaration.base, ...themeVars(entry, appearance, this.#assetUrl)};
    }
}
