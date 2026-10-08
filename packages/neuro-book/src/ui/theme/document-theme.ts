import {NB_UI_COLORWAY_HOST_CLASS, applyColorway} from "@notnotype/nb-ui/colorway";
import type {NbColorwayVars} from "@notnotype/nb-ui/colorway";

/** 写到文档根的一套主题：主题包、明暗与配色变量（docs/specs/theme/system.md）。 */
export interface DocumentTheme {
    readonly themeId: string;
    readonly appearance: "light" | "dark";
    /** 配色变量；主题包没有对应明暗的配色时为 undefined，只写主题包与明暗。 */
    readonly vars: NbColorwayVars | undefined;
}

export interface DocumentThemeWriter {
    /** 覆盖上一次写下的主题。 */
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
    return {
        apply(theme) {
            const root = document.documentElement;
            root.dataset.nbTheme = theme.themeId;
            root.dataset.nbAppearance = theme.appearance;
            root.style.colorScheme = theme.appearance;
            clearVars();
            if (theme.vars !== undefined) {
                applyColorway(root, theme.vars);
                applyColorway(document.body, theme.vars);
                written = Object.keys(theme.vars);
            }
        },
        clear() {
            const root = document.documentElement;
            delete root.dataset.nbTheme;
            delete root.dataset.nbAppearance;
            root.style.removeProperty("color-scheme");
            clearVars();
            root.classList.remove(NB_UI_COLORWAY_HOST_CLASS);
            document.body.classList.remove(NB_UI_COLORWAY_HOST_CLASS);
        },
    };
}
