// @vitest-environment jsdom
import {beforeEach, describe, expect, it} from "vitest";
import {productAppearances, productThemeIds} from "nbook/shared/theme/theme-axes";
import {productThemes} from "nbook/app/utils/theme/theme-packs";
import {useProductTheme} from "nbook/app/utils/theme/theme-session";

/**
 * 四个组合（nbook / macos × light / dark）在文档根上解析出的配色取值，
 * 必须与 nb-ui 主题包自己给的那一份**逐项相等**。
 *
 * 取值全部从主题包读（`installed.themes[...].colorways[...]`），测试里不抄任何字面量：
 * 抄一份就等于给颜色建了第二个事实源，主题包改色时这边静默漂移。
 */
describe("product theme session", () => {
    const session = useProductTheme();

    beforeEach(() => {
        session.applyStoredAxes({});
    });

    it("四个组合把主题包自带的配色逐项写到 <html>", () => {
        for (const themeId of productThemeIds) {
            const pack = productThemes.find((theme) => theme.manifest.id === themeId);
            expect(pack, `主题包 ${themeId} 必须已装载`).toBeDefined();
            const defaultColorway = pack?.manifest.defaultColorway;
            expect(defaultColorway, `主题包 ${themeId} 必须给出默认配色`).toBeDefined();

            for (const appearance of productAppearances) {
                session.applyStoredAxes({themeId, appearance});

                const colorwayId = defaultColorway?.[appearance];
                const expected = colorwayId === undefined ? undefined : pack?.colorways[colorwayId];
                expect(expected, `${themeId} 缺 ${appearance} 配色`).toBeDefined();

                const root = document.documentElement;
                expect(root.dataset.nbTheme).toBe(themeId);
                expect(root.dataset.nbAppearance).toBe(appearance);
                expect(root.style.colorScheme).toBe(appearance);

                for (const [name, value] of Object.entries(expected ?? {})) {
                    expect(root.style.getPropertyValue(name), `${themeId}/${appearance} 的 ${name}`).toBe(value);
                }

                // 与 nb-ui 配色 store 一致：body 上也写一份，浮层与视口才跟随同一套取值。
                expect(document.body.style.getPropertyValue("--bg-panel")).toBe(expected?.["--bg-panel"]);
                expect(session.colorwayId.value).toBe(colorwayId);
            }
        }
    });

    it("老体系取值与缺失字段一律回落默认，不做映射", () => {
        for (const legacyThemeId of ["sepia", "light", "dark", "tokyo-night", "custom-night", "missing-theme", ""]) {
            session.applyStoredAxes({themeId: legacyThemeId, appearance: "sepia"});
            expect(session.themeId.value).toBe("nbook");
            expect(session.appearance.value).toBe("light");
        }

        session.applyStoredAxes({themeId: "macos", appearance: "dark"});
        session.applyStoredAxes({themeId: undefined, appearance: undefined});
        expect(session.themeId.value).toBe("nbook");
        expect(session.appearance.value).toBe("light");
    });
});
