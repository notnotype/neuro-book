import {describe, expect, it} from "vitest";
import {productAppearances, productThemeIds} from "nbook/shared/theme/theme-axes";
import {productThemeOptions, productThemes} from "nbook/app/utils/theme/theme-packs";

/**
 * 装载的主题包 = 配置白名单（shared/theme/theme-axes.ts）。
 *
 * 两边一旦漂移，坏的不是报错而是静默：白名单里多一套主题，设置里就会给出一个
 * 解析不出取值的选择；少一套，用户切过去的主题会被服务端判成非法并重置默认。
 */
describe("product theme packs", () => {
    it("装载的正是配置白名单里的主题包，顺序也一致", () => {
        expect(productThemes.map((theme) => theme.manifest.id)).toEqual([...productThemeIds]);
    });

    it("每套主题包都自带明暗两档配色，默认配色指向自己那两套", () => {
        for (const theme of productThemes) {
            for (const appearance of productAppearances) {
                const colorwayId = theme.manifest.defaultColorway?.[appearance];
                expect(colorwayId, `${theme.manifest.id} 缺 ${appearance} 默认配色`).toBeDefined();
                expect(theme.colorways[colorwayId ?? ""], `${theme.manifest.id} 的 ${colorwayId ?? ""} 不在配色表里`).toBeDefined();
                expect(theme.colorwayMeta[colorwayId ?? ""]?.appearance).toBe(appearance);
            }
        }
    });

    it("设置里的主题选项取自主题包 manifest", () => {
        expect(productThemeOptions.map((option) => option.id)).toEqual([...productThemeIds]);
        for (const option of productThemeOptions) {
            const theme = productThemes.find((candidate) => candidate.manifest.id === option.id);
            expect(option.name).toBe(theme?.manifest.name);
        }
    });
});
