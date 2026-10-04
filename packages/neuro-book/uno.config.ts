/**
 * 应用自己的原子 CSS。nb-ui 自带一份预编译的 Tailwind v4 样式（`@notnotype/nb-ui/styles.css`），页面上同时有两套引擎。
 */

import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

import {defineConfig, presetIcons, presetWind3} from "unocss";

/**
 * nb-ui 发货的位移、缩放、旋转、斜切类名，在这里封禁。两边都会生成 `.translate-x-4`、`.rotate-180` 这类同名类，
 * 但 Tailwind v4 写独立的 `translate:`/`rotate:` 属性，UnoCSS 写 `transform`，同名类同时命中时位移与角度翻倍
 * （Switch 的滑块溢出轨道，chevron 转 180° 变成 360°）。封禁后这些类名只有 nb-ui 那一份实现。
 *
 * 名单从 nb-ui 的样式产物现读：nb-ui 改了用法，重启开发服务后自动跟上。只封 nb-ui 真正发货的名字，整个家族一起封
 * 会让应用自己用、nb-ui 没有的类（例如 `hover:-translate-y-0.5`）静默失效。
 */
function nbUiTransformClasses(): string[] {
    const css = readFileSync(fileURLToPath(import.meta.resolve("@notnotype/nb-ui/styles.css")), "utf8");
    const names = new Set<string>();
    for (const rule of css.matchAll(/(?:^|[},])\s*([^{}]+?)\s*\{/gu)) {
        for (const match of (rule[1] as string).matchAll(/\.((?:\\[^\s]|[A-Za-z0-9_-])+)/gu)) {
            const className = (match[1] as string).replace(/\\(.)/gu, "$1");
            if (/(?:^|:)-?(?:translate|scale|rotate|skew)-/u.test(className)) names.add(className);
        }
    }
    return [...names].sort();
}

export default defineConfig({
    presets: [presetWind3(), presetIcons()],
    blocklist: nbUiTransformClasses(),
    // 缺省只扫描模板类文件；图标名等类名也写在 `.ts` 里（例如视图描述的 `icon`），一并提取。
    content: {pipeline: {include: [/\.(?:vue|ts)(?:$|\?)/u]}},
});
