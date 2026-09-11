import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {clearThemeVars, applyThemeVars} from "nbook/app/utils/theme/apply-theme";
import {ideThemeIds, themeTokens, themeVarKeys, type IdeTheme, type ThemeVarKey, type ThemeVars} from "nbook/app/utils/theme/theme-tokens";

const fallbackCssPath = fileURLToPath(new URL("../../styles/theme-vars.css", import.meta.url));
const settingsDialogPath = fileURLToPath(new URL("../../components/novel-ide/NovelIdeSettingsDialog.vue", import.meta.url));
const settingsViewPath = fileURLToPath(new URL("../../components/novel-ide/settings/sections/NovelIdeSettingsView.vue", import.meta.url));
const profileTemplateNodePath = fileURLToPath(new URL("../../components/profile-template-editor/ProfileTemplateNodeView.vue", import.meta.url));

const semanticStatusKeys = [
    "--status-info",
    "--status-info-bg",
    "--status-info-border",
    "--status-success",
    "--status-success-bg",
    "--status-success-border",
    "--status-warning",
    "--status-warning-bg",
    "--status-warning-border",
    "--status-danger",
    "--status-danger-bg",
    "--status-danger-border",
] as const;

/**
 * 转义 CSS 变量名，供同步锁正则匹配使用。
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 从 fallback CSS 中读取变量值。
 */
function readFallbackValue(css: string, key: ThemeVarKey): string | null {
    const match = css.match(new RegExp(`${escapeRegExp(key)}:\\s*([^;]+);`));
    return match?.[1]?.trim() ?? null;
}

describe("theme semantic status tokens", () => {
    it("keeps complete semantic status tokens for every IDE theme", () => {
        for (const [theme, vars] of Object.entries(themeTokens) as Array<[IdeTheme, ThemeVars]>) {
            for (const key of semanticStatusKeys) {
                expect(vars[key], `${theme} should define ${key}`).toBeTruthy();
            }
        }
    });

    it("includes semantic status tokens in applied and cleared theme keys", () => {
        for (const key of semanticStatusKeys) {
            expect(themeVarKeys).toContain(key);
        }

        const styleValues = new Map<string, string>();
        const host = {
            style: {
                getPropertyValue: (key: string): string => styleValues.get(key) ?? "",
                removeProperty: (key: string): string => {
                    const previousValue = styleValues.get(key) ?? "";
                    styleValues.delete(key);
                    return previousValue;
                },
                setProperty: (key: string, value: string): void => {
                    styleValues.set(key, value);
                },
            },
        } as HTMLElement;
        applyThemeVars(host, themeTokens.sepia);
        expect(host.style.getPropertyValue("--status-warning")).toBe(themeTokens.sepia["--status-warning"]);

        clearThemeVars(host);
        expect(host.style.getPropertyValue("--status-warning")).toBe("");
    });
});

describe("theme v2.1 token table", () => {
    it("keeps the built-in theme table locked to the 36 variable contract", () => {
        expect(themeVarKeys).toHaveLength(36);
        for (const themeId of ideThemeIds) {
            expect(Object.keys(themeTokens[themeId]).sort()).toEqual([...themeVarKeys].sort());
        }
    });

    it("keeps SSR fallback aligned with sepia tokens", async () => {
        const css = await readFile(fallbackCssPath, "utf8");
        for (const key of themeVarKeys) {
            expect(readFallbackValue(css, key)).toBe(themeTokens.sepia[key]);
        }
        expect(css).toContain(".novel-ide-theme ::selection");
        expect(css).toContain("background: var(--selection-bg);");
    });

    it("keeps ordinary UI chrome on theme variables instead of fixed palette colors", async () => {
        const settingsShell = await readFile(settingsViewPath, "utf8");
        const settingsDialog = await readFile(settingsDialogPath, "utf8");
        const profileTemplateNode = await readFile(profileTemplateNodePath, "utf8");

        // 设置界面的常规 chrome 已经搬进外壳视图，主题变量由它消费。
        expect(settingsShell).toContain("var(--divider)");
        expect(settingsDialog).not.toContain("shadow-[0_24px_80px_rgba(0,0,0,0.10)]");
        expect(profileTemplateNode).toContain("color: var(--status-danger);");
    });
});
