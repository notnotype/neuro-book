/**
 * 主题声明里的素材引用（docs/specs/theme/editor.md 的“素材”）：场景图与工作态场景是位图（`scene`），图标是 SVG（`icon`）。
 * 复制插件主题、导出、导入都是“找出全部引用、各换成另一种写法”：包内路径与素材文件名互换，这里把这件事写一次。纯函数，不碰网络。
 */

import type {ThemeDeclaration} from "../../../shared/themes";
import {THEME_ASSET_NAME, THEME_ICON_NAME} from "../../../shared/user-themes";

export type AssetKind = "scene" | "icon";
export interface AssetRef {
    readonly kind: AssetKind;
    readonly path: string;
}

type Look = ThemeDeclaration["light"];
const LOOKS = ["light", "dark"] as const;

/** 全部素材引用，同一个种类与路径只列一次（两套明暗共用一个文件时）。 */
export function assetRefs(declaration: ThemeDeclaration): ReadonlyArray<AssetRef> {
    const found = new Map<string, AssetRef>();
    const add = (kind: AssetKind, path: string | undefined): void => {
        if (path !== undefined) found.set(`${kind}\n${path}`, {kind, path});
    };
    for (const appearance of LOOKS) {
        const look = declaration[appearance];
        add("scene", look.scene);
        add("scene", look.workingScene);
        for (const path of Object.values(look.icons ?? {})) add("icon", path);
    }
    return [...found.values()];
}

/** 把每个素材引用换成 `rename` 给的写法；返回新对象，不改入参。 */
export function renameAssets(declaration: ThemeDeclaration, rename: (kind: AssetKind, path: string) => string): ThemeDeclaration {
    const next = structuredClone(declaration);
    for (const appearance of LOOKS) {
        const look = next[appearance];
        if (look.scene !== undefined) look.scene = rename("scene", look.scene);
        if (look.workingScene !== undefined) look.workingScene = rename("scene", look.workingScene);
        if (look.icons !== undefined) look.icons = Object.fromEntries(Object.entries(look.icons).map(([name, path]) => [name, rename("icon", path)]));
    }
    return next;
}

/** 只留“我的素材”写法的引用（内容摘要加扩展名）：插件包内的相对路径在用户层解析不了，去掉；图标一个不剩时去掉 `icons`。 */
export function keepUserAssets(declaration: ThemeDeclaration): ThemeDeclaration {
    const next = structuredClone(declaration);
    for (const appearance of LOOKS) {
        const look: Look = next[appearance];
        if (look.scene !== undefined && !THEME_ASSET_NAME.test(look.scene)) delete look.scene;
        if (look.workingScene !== undefined && !THEME_ASSET_NAME.test(look.workingScene)) delete look.workingScene;
        if (look.icons !== undefined) {
            const kept = Object.entries(look.icons).filter(([, name]) => THEME_ICON_NAME.test(name));
            if (kept.length === 0) delete look.icons;
            else look.icons = Object.fromEntries(kept);
        }
    }
    return next;
}
