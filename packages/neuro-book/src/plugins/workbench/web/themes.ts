/**
 * 已接受的主题（docs/specs/theme/skins.md）：按贡献点收，算出一个明暗下要写到文档根的东西。声明是数据，这里不认识具体哪一套。
 */

import {shallowRef} from "@vue/reactivity";

import type {ContributionDescriptor, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {ProductTheme} from "nbook/ui/theme/product-theme-shape";
import {SKIN_VARS} from "nbook/ui/theme/skin-vars";

import {DEFAULT_THEME_ID} from "../shared/themes";
import type {ThemeDeclaration} from "../shared/themes";

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
    }
    return {vars, scene: url !== null};
}

export class ThemeCatalog {
    readonly #entries = shallowRef<ReadonlyMap<string, ThemeEntry>>(new Map());
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

    get list(): ReadonlyArray<ThemeEntry> {
        return [...this.#entries.value.values()];
    }

    has(id: string): boolean {
        return this.#entries.value.has(id);
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
        const entry = this.#entries.value.get(id) ?? this.#entries.value.get(DEFAULT_THEME_ID);
        if (entry === undefined) return {base: DEFAULT_THEME_ID, vars: {}, scene: false};
        return {base: entry.declaration.base, ...themeVars(entry, appearance, this.#assetUrl)};
    }
}
