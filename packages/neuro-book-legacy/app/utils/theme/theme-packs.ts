import type {InstalledTheme} from "@notnotype/nb-ui/theme";
import macosTheme from "@notnotype/nb-ui/themes/macos";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";
import {installThemePacks} from "nbook/app/utils/theme/install-theme-packs";
import type {ProductThemeId} from "nbook/shared/theme/theme-axes";

/**
 * 产品主题包登记表：nbook = 产品主题，macos = 同族的对照主题。
 *
 * 装载顺序 = 设置里主题列表的显示顺序（`getInstalledThemes` 按装载顺序返回），
 * 所以这个数组的顺序就是 `productThemeIds` 的顺序——两边漂移由 theme-packs.test.ts 兜住。
 * 主题包自己 `import "./vars.css"`，样式交给打包器——这一点与 nb-ui 的 playground / Lab 是同一条路径。
 *
 * 「缺则装、已装则复用」由 install-theme-packs.ts 统一承担：`/lab` 也装 nbook / macos
 * （component-lab/lab-theme.ts），两个模块在同一页面先后求值时，后来的那个必须让路。
 */
export const productThemes: InstalledTheme[] = installThemePacks([nbookTheme, macosTheme]);

/** 按 id 取已装主题包；不认识（或没装上）的返回 undefined。 */
export function resolveProductTheme(themeId: string): InstalledTheme | undefined {
    return productThemes.find((theme) => theme.manifest.id === themeId);
}

/** 主题的展示信息：名字与一句话简介来自主题包 manifest，产品侧不再手抄一份。 */
export type ProductThemeOption = {
    id: ProductThemeId;
    name: string;
    tagline: string;
};

export const productThemeOptions: ProductThemeOption[] = productThemes.map((theme) => ({
    id: theme.manifest.id as ProductThemeId,
    name: theme.manifest.name,
    tagline: theme.manifest.tagline ?? "",
}));
