import {getInstalledTheme, installTheme, isThemeInstalled} from "@notnotype/nb-ui/theme";
import type {InstalledTheme} from "@notnotype/nb-ui/theme";
import macosTheme from "@notnotype/nb-ui/themes/macos";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";
import {productThemeIds, type ProductThemeId} from "nbook/shared/theme/theme-axes";

/**
 * 产品只装这两套主题包（nbook = 产品主题，macos = 同族的对照主题）。
 *
 * 装载顺序 = 设置里主题列表的显示顺序（`getInstalledThemes` 按装载顺序返回）。
 * 主题包自己 `import "./vars.css"`，样式交给打包器——这一点与 nb-ui 的 playground / Lab 是同一条路径。
 *
 * 「已装过就跳过」是必需的：`/lab` 也装 nbook / macos（lab-theme.ts），而 `installTheme`
 * 对重复 id 直接抛 duplicate-id。两个模块在同一页面先后求值时，后来的那个必须让路。
 */
for (const module of [nbookTheme, macosTheme]) {
    if (!isThemeInstalled(module.manifest.id)) {
        installTheme(module);
    }
}

/** 产品主题包登记表，顺序固定为 `productThemeIds`。 */
export const productThemes: InstalledTheme[] = productThemeIds
    .map((id) => getInstalledTheme(id))
    .filter((theme): theme is InstalledTheme => theme !== undefined);

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
