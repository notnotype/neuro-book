import {NB_UI_COLORWAY_HOST_CLASS} from "@notnotype/nb-ui/colorway";

import {SKIN_VARS} from "./skin-vars";

/** 写到文档根的一套主题：主题包、明暗与配色变量（docs/specs/theme/system.md）。 */
export interface DocumentTheme {
    readonly themeId: string;
    /** 主题目录里的 id；没有时用 `themeId`。换了它就是换了一套主题，整页渐变（同一个 id 下只改配色变量不渐变）。 */
    readonly skin?: string;
    readonly appearance: "light" | "dark";
    /** 配色变量与主题写的其它变量；都没有时为 undefined，只写主题包与明暗。 */
    readonly vars: Readonly<Partial<Record<string, string>>> | undefined;
    /** 这套主题有场景图（docs/specs/theme/skins.md）。 */
    readonly scene?: boolean;
}

export interface DocumentThemeWriter {
    /**
     * 覆盖上一次写下的主题。换了主题包或明暗时，浏览器支持的话整页渐变过去；首次写入、只改配色变量（编辑器里拖色）
     * 和偏好“减弱动效”时直接写（docs/specs/theme/system.md 运行时流程第 6 条）。
     */
    apply(theme: DocumentTheme): void;
    /** 去掉自己写下的属性、配色变量与配色宿主 class，文档根回到没有主题的样子。 */
    clear(): void;
}

/**
 * 一个页面对文档根的主题写入。主题只能写在 `<html>` 上，不能作用域到页面自己的根节点：主题包的变量声明在
 * `:root[data-nb-theme="…"]` 选择器下，且大量派生自配色变量（`color-mix(… var(--accent-main) …)`），自定义属性在
 * 声明处完成替换，配色不写在文档根的话派生值会算错。
 *
 * 写入方各建一个（产品的工作台页面一个、Lab 一个），偏好与状态各管各的；它只记自己写下的配色变量，清理时逐个
 * 删除，否则会残留在 `<html>` 上。同一文档里同一时刻只有一个页面在写（Lab 是离开时整页加载的独立页面）。
 */
export function createDocumentThemeWriter(): DocumentThemeWriter {
    let written: string[] = [];
    const clearVars = (): void => {
        for (const name of written) {
            document.documentElement.style.removeProperty(name);
            document.body.style.removeProperty(name);
        }
        written = [];
    };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    /**
     * 最近一次要求写下的主题。渐变的写入回调由浏览器在下一帧才调，这期间可能又来了新的 `apply`，或页面已经 `clear`；
     * 回调只在自己仍是最新一次时才写，否则迟到的旧主题会盖掉新的，或在页面卸载后把主题写回文档根。
     */
    let latest: DocumentTheme | undefined;
    const write = (theme: DocumentTheme): void => {
        const root = document.documentElement;
        root.dataset.nbTheme = theme.themeId;
        root.dataset.nbAppearance = theme.appearance;
        root.style.colorScheme = theme.appearance;
        if (theme.scene === true) root.dataset.nbSkinScene = "";
        else delete root.dataset.nbSkinScene;
        if (theme.vars?.[SKIN_VARS.frameLine] !== undefined) root.dataset.nbSkinFrame = "";
        else delete root.dataset.nbSkinFrame;
        clearVars();
        if (theme.vars !== undefined) {
            for (const target of [root, document.body]) {
                target.classList.add(NB_UI_COLORWAY_HOST_CLASS);
                for (const [name, value] of Object.entries(theme.vars)) {
                    if (value !== undefined) target.style.setProperty(name, value);
                }
            }
            written = Object.keys(theme.vars);
        }
    };
    return {
        apply(theme) {
            const previous = latest;
            latest = theme;
            const switched = previous !== undefined && ((previous.skin ?? previous.themeId) !== (theme.skin ?? theme.themeId) || previous.appearance !== theme.appearance);
            if (!switched || reducedMotion.matches || typeof document.startViewTransition !== "function") {
                write(theme);
                return;
            }
            document.startViewTransition(() => {
                if (latest === theme) write(theme);
            });
        },
        clear() {
            latest = undefined;
            const root = document.documentElement;
            delete root.dataset.nbTheme;
            delete root.dataset.nbAppearance;
            delete root.dataset.nbSkinScene;
            delete root.dataset.nbSkinFrame;
            root.style.removeProperty("color-scheme");
            clearVars();
            root.classList.remove(NB_UI_COLORWAY_HOST_CLASS);
            document.body.classList.remove(NB_UI_COLORWAY_HOST_CLASS);
        },
    };
}
