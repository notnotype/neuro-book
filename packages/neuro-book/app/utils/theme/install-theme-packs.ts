import {getInstalledTheme, installTheme} from "@notnotype/nb-ui/theme";
import type {InstalledTheme, NbThemeModule} from "@notnotype/nb-ui/theme";

/**
 * 装入一批主题包：**缺则装，已装过则复用已有登记项**。
 *
 * 同一页面里两处代码各装各的清单是常态：产品侧装 nbook / macos（`theme-packs.ts`），
 * `/lab` 还要拿 editorial / aurora 当对照（`component-lab/lab-theme.ts`）。
 * 而 `installTheme` 对重复 id 直接抛 duplicate-id——这条不许放宽：装载是带全局副作用的动作
 * （写 fallback 兜底层、往文档里挂 svgDefs），装两遍没有意义。于是后求值的那个模块必须让路。
 *
 * 让路的判据只认 nb-ui 的已装登记表，**不认异常**：拿 try/catch 吞掉 duplicate-id 会把
 * 「早就装好了」和「这次真的装不上」混成同一个结果，后者会被静默吃掉——那正是最需要看见的报错。
 *
 * 返回登记项，顺序与入参一致：调用方拿到的可能是刚装上的那一个，也可能是先前那次装好的那一个。
 */
export function installThemePacks(modules: readonly NbThemeModule[]): InstalledTheme[] {
    return modules.map((module) => getInstalledTheme(module.manifest.id) ?? installTheme(module));
}
