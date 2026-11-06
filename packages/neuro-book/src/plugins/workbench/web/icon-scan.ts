/**
 * 读页面里已加载的样式表，得到“产品此刻能画的 lucide 图标”（docs/specs/theme/editor.md 输出 21）。
 *
 * 产品的图标是 `[class*="i-lucide-"]` 垫片加每个图标类自己的 `--svg` 规则（`@layer utilities` 里，插件用到的图标在
 * `@layer components` 里），没有规则的类画不出来，所以样式表里有 `.i-lucide-<名>` 规则就是产品能画这个图标；覆盖没有规则的名字
 * 没有效果。不缓存：Vite 开发服务会在同一个 `<style>` 上原地改文本，样式表集合的长度与节点都不变，按它们失效的缓存会漏掉更新；
 * 约一千条规则，扫一次很便宜。
 */

import {parseIconSelector} from "./icon-catalog";
import type {CatalogIcon} from "./icon-catalog";

/** 主题自己的图标覆盖表（`document-theme.ts` 写的）带这个属性：里面的名字是用户换上去的，不是“产品能画的”。 */
const OVERRIDE_SHEET_ATTRIBUTE = "nbSkinIcons";

export interface IconScan {
    /** 按名字排序。同名多条规则时取最先出现的：宿主的样式表排在插件的 `<link>` 前，而宿主在更高的层里，也是层叠里赢的那条。 */
    readonly icons: ReadonlyArray<CatalogIcon>;
    /** 读不了的样式表数量（跨域样式表读 `cssRules` 会抛 `SecurityError`）；产品页面里应为 0，非 0 说明目录可能不全。 */
    readonly unreadable: number;
}

/** 规则里带 `cssRules` 的都往里走：`@layer`、`@media`、`@supports` 的块，以及（不会出现的）嵌套样式规则。 */
function visit(rules: CSSRuleList, found: Map<string, string>): void {
    for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
            const svg = rule.style.getPropertyValue("--svg").trim();
            if (svg !== "") for (const name of parseIconSelector(rule.selectorText)) if (!found.has(name)) found.set(name, svg);
        }
        const nested = (rule as {cssRules?: CSSRuleList}).cssRules;
        if (nested !== undefined) visit(nested, found);
    }
}

export function scanIconCatalog(sheets: Iterable<CSSStyleSheet> = document.styleSheets): IconScan {
    const found = new Map<string, string>();
    let unreadable = 0;
    for (const sheet of Array.from(sheets)) {
        if (sheet.ownerNode instanceof HTMLElement && OVERRIDE_SHEET_ATTRIBUTE in sheet.ownerNode.dataset) continue;
        try {
            visit(sheet.cssRules, found);
        } catch (error) {
            // 只有跨域样式表会抛 SecurityError；别的错误是真问题，不当作“读不了”吞掉。
            if (!(error instanceof DOMException && error.name === "SecurityError")) throw error;
            unreadable += 1;
        }
    }
    return {icons: [...found].map(([name, svg]) => ({name, svg})).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)), unreadable};
}
