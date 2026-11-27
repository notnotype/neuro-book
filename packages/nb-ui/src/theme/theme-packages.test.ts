import {readFileSync} from "node:fs";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import auroraTheme from "../../themes/aurora";
import editorialTheme from "../../themes/editorial";
import macosTheme from "../../themes/macos";
import nbookTheme from "../../themes/nbook";
import type {NbThemeModule} from "./theme-manifest";
import {collectSvgDefsIds} from "./svg-defs";
import {installTheme, resetInstalledThemes} from "./theme-loader";

/**
 * 随库发布的四套主题必须真的装得上（Task 146 批 3）。
 *
 * 这一份是**格式的自证**：一方主题（含默认的 nbook）和第三方主题走同一条装载路径，
 * 所以只要一方主题装不上，就说明格式或库的哪一条变了而没人跟着改。
 * 「先在自己身上验证一遍」这句话的落点就是这个文件。
 */

const THEMES: {dir: string; module: NbThemeModule}[] = [
    {dir: "editorial", module: editorialTheme},
    {dir: "macos", module: macosTheme},
    {dir: "aurora", module: auroraTheme},
    {dir: "nbook", module: nbookTheme},
];

function readVarsCss(dir: string): string {
    return readFileSync(join(import.meta.dirname, "..", "..", "themes", dir, "vars.css"), "utf-8");
}

/*
 * 只留声明、剥掉注释。**凡是扫 vars.css 找「有没有出现 X」的断言都要走这个**，
 * 否则它扫的是散文不是代码。
 *
 * 这个坑本仓已经踩到第二次：第一次是「不许出现字面色」被注释里引用的 Apple 原件取值绊倒，
 * 第二次是下面那条「用了就必须声明」被一段解释「这里曾经有 --glass-sheen，已删」的注释绊倒——
 * 变量确实删干净了，报的却是它还在用。两次的共同点是**注释写得越认真越容易触发**，
 * 而修法只能是剥注释：把取值来源和删除理由从注释里拿掉，才是真的损失。
 */
function readVarsDeclarations(dir: string): string {
    return readVarsCss(dir).replaceAll(/\/\*[\s\S]*?\*\//g, "");
}

afterEach(() => {
    resetInstalledThemes();
});

describe("shipped theme packages", () => {
    it.each(THEMES)("installs $dir", ({module}) => {
        expect(() => installTheme(module)).not.toThrow();
    });

    it("installs all four side by side", () => {
        // 市场形态下「装了 N 套、激活 1 套」是常态，所以并存本身要能过
        for (const {module} of THEMES) {
            installTheme(module);
        }

        expect(THEMES.map(({module}) => module.manifest.id)).toEqual(["editorial", "macos", "aurora", "nbook"]);
    });

    it.each(THEMES)("uses its directory name as the theme id: $dir", ({dir, module}) => {
        expect(module.manifest.id).toBe(dir);
    });

    /*
     * 主题与配色正交：任意主题 × 任意配色都应该成立。一旦 vars.css 里出现字面颜色，
     * 换一套配色就会露出一块与配色无关的死色，而且现象是「某个主题下颜色不对」，很难定位。
     *
     * 唯一的例外是纯白与纯黑的低透明度叠层——镜面高光和内阴影表达的是**光**不是颜色，
     * 没有对应的配色变量可用。所以规则收紧成：不许出现 hex，rgb() 只许是白或黑。
     */
    it.each(THEMES)("keeps literal colours out of $dir/vars.css", ({dir}) => {
        /*
         * 先剥注释再扫，和下面 data-nb-colorway 那条同一个理由：这条规则管的是**声明**，
         * 不是散文。注释里引用原件取值（比如 Apple 官方 UI Kit 读到的 #DBDBDB）是**证据**，
         * 把它删掉才是真的损失——取值的来源没了，下一个人只能重新目测一遍。
         */
        const css = readVarsDeclarations(dir);

        expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], `${dir}/vars.css 出现了 hex 字面色`).toEqual([]);

        const functional = css.match(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)/g) ?? [];
        const notLight = functional.filter((value) => !/^rgb\(\s*(?:255\s+255\s+255|0\s+0\s+0)\s*\//.test(value));

        expect(notLight, `${dir}/vars.css 里这些取值既不是配色变量也不是纯白/纯黑叠层`).toEqual([]);
    });

    /*
     * 声明了却不在自己的主题块里取值 = 这个变量永远只有 fallback 那一个值，
     * 声明本身没有意义，且会白白占用一个全局变量名。
     */
    it.each(THEMES)("gives every declared variable a value in $dir/vars.css", ({dir, module}) => {
        const css = readVarsDeclarations(dir);
        const unused = (module.manifest.declares ?? []).filter((declaration) => !css.includes(`${declaration.name}:`));

        expect(unused.map((declaration) => declaration.name), `${dir} 声明了这些变量却没给取值`).toEqual([]);
    });

    /*
     * 主题要按明暗分档就必须挂配色的**明暗属性**。绑配色身份（[data-nb-colorway="dark"]）
     * 对用户自定义的暗色配色一律失效，而失效时看不出任何报错，只是「换了个暗色配色玻璃就不对了」。
     */
    it.each(THEMES)("never keys off a colourway id in $dir/vars.css", ({dir}) => {
        // 只看真实选择器：注释里提到这个属性是允许的（正是用来解释为什么不能用）
        expect(readVarsDeclarations(dir)).not.toContain("data-nb-colorway");
    });

    /*
     * 两套玻璃主题走同一组判据。上一轮实测查出的洞是整套玻璃配方只按亮色调过——
     * brightness 与高光 alpha 在暗色下方向是反的，而这在亮色下完全看不出来。
     * nbook 从 macos 衍生，最容易的一种走样就是把亮色配方抄全、暗色分档抄漏。
     */
    const GLASS_THEMES: {dir: string; module: NbThemeModule}[] = [
        {dir: "macos", module: macosTheme},
        {dir: "nbook", module: nbookTheme},
    ];

    it.each(GLASS_THEMES)("gives $dir a dark-appearance glass recipe that dims instead of brightens", ({dir}) => {
        const css = readVarsDeclarations(dir);
        const dark = css.slice(css.indexOf('[data-nb-appearance="dark"]'));

        expect(dark, `${dir} 缺暗色分档`).not.toBe("");
        expect(dark).toContain("--glass-blur:");
        expect(dark).toContain("--glass-rim:");
        // 亮色是 brightness(1.0x)（提亮），暗色必须是压暗
        expect(/brightness\(0\.\d+\)/.test(dark), `${dir} 的暗色玻璃仍在提亮，方向反了`).toBe(true);
    });

    it.each(GLASS_THEMES)("declares every glass variable $dir uses", ({dir, module}) => {
        // 主题用了却没声明的变量拿不到 fallback，别的主题激活时引用它就是空值
        const css = readVarsDeclarations(dir);
        const declared = new Set((module.manifest.declares ?? []).map((declaration) => declaration.name));
        const used = new Set(css.match(/--(?:glass|window)-[a-z-]+/g) ?? []);
        const undeclared = [...used].filter((name) => !declared.has(name as `--${string}`));

        expect(undeclared, `${dir} 用了这些变量但 manifest 没声明`).toEqual([]);
    });

    it.each(GLASS_THEMES)("prefixes $dir's refraction filter ids with its own theme id", ({dir, module}) => {
        /*
         * 滤镜 id 是全文档级的，两套主题共用 id 时 url(#id) 静默取先装的那一个。
         * 装载器会拒绝重名，但那是「已经撞上了」才报——这条要求的是从命名上就不可能撞。
         */
        for (const svgId of collectSvgDefsIds(module.svgDefs ?? "")) {
            expect(svgId.startsWith(dir === "macos" ? "nb-" : `${dir}-`), `#${svgId} 没有带主题前缀`).toBe(true);
        }
    });

    /*
     * nbook 的三条不变量。都在配色表里，不在 vars.css 里——vars.css 不许出现字面色，
     * 「纸比桌亮」只能靠 --page-surface 取 --bg-panel + 配色表保证 panel 恒亮于 main 来成立。
     * 所以这里必须验配色表本身，验 CSS 是验不到的。
     */
    describe("nbook colourway invariants", () => {
        /** sRGB 加权亮度。只用来比大小，不做对比度判定（对比度在应用的 builtin-colorways-contrast.dom.test.ts），所以不做 gamma 线性化 */
        function luminance(hex: string): number {
            const value = Number.parseInt(hex.slice(1), 16);
            return (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
        }

        const CASES = Object.entries(nbookTheme.colorways ?? {});

        it.each(CASES)("keeps the page brighter than the desk in %s", (_id, vars) => {
            // 整套主题的支点：稿面消费 --bg-panel，窗体底消费 --bg-main。反过来就退回成普通 IDE
            expect(luminance(vars["--bg-panel"] as string)).toBeGreaterThan(luminance(vars["--bg-main"] as string));
        });

        it.each(CASES)("never sinks the input below the panel it sits on in %s", (_id, vars) => {
            /*
             * 上一轮实测查出的洞：macos-dark 的 --bg-input（#161618）比窗体底（#1c1c1e）还暗，
             * 输入框成了挖在面板上的黑洞，用户的原话是「浏览器原生的那一条黑线好像没有删掉」。
             * 主题层的 --control-surface 已经改成从面上抬起，但 Select / Dialog 取消按钮
             * 这类组件今天仍直接引用 --bg-input（阶段 2 的债），所以配色表这一层也得守住。
             */
            expect(luminance(vars["--bg-input"] as string)).toBeGreaterThanOrEqual(
                luminance(vars["--bg-panel"] as string),
            );
        });

        it.each(CASES)("keeps the accent distinct from the warning status in %s", (_id, vars) => {
            /*
             * 内置 dark 这两项是同一个色值（#f59e0b），于是「当前章节」和「草稿状态」
             * 在屏幕上分不出来——而写作工具里满屏都是草稿。nbook 不许重蹈。
             */
            expect(vars["--accent-main"]).not.toBe(vars["--status-warning"]);
        });

        it("gives the page shadow a separate recipe per appearance", () => {
            // 同一个百分比在暖黑桌面上几乎看不见，在米色桌面上又太重
            const css = readVarsCss("nbook");
            const dark = css.slice(css.indexOf('[data-nb-appearance="dark"]'));
            const light = css.slice(css.indexOf('[data-nb-appearance="light"]'));

            expect(dark, "nbook 缺暗色分档").not.toBe("");
            expect(dark).toContain("--page-lift:");
            expect(light).toContain("--page-lift:");
            expect(dark.slice(0, light.length)).not.toBe(light);
        });

        it("drops negative letter-spacing that only suits SF's latin glyphs", () => {
            /*
             * macOS 的 --tracking-ui 是 -0.006em，那是给 SF Pro 的拉丁字形调的。
             * 本轮检索没有查到任何依据支持把负字距套到汉字上，反而查到「请勿据此直接套用」
             * 的明确提醒，所以中文主题必须归零——抄过来是最容易发生的一种走样。
             */
            expect(readVarsCss("nbook")).toContain("--tracking-ui: 0;");
        });
    });

    /*
     * SVG 资源的 id 在整个文档里是全局的，装载器按主题分容器但不隔离 id。
     * 两套主题定义同名滤镜时 url(#id) 取先装的那一个且不报错——现象是「装了 A 之后
     * B 的折射变弱了」。随库发布的主题自己先不许犯。
     */
    it("never reuses an SVG defs id across shipped themes", () => {
        const seen = new Map<string, string>();
        for (const {module} of THEMES) {
            for (const svgId of collectSvgDefsIds(module.svgDefs ?? "")) {
                expect(seen.has(svgId), `${module.manifest.id} 与 ${seen.get(svgId)} 都定义了 #${svgId}`).toBe(false);
                seen.set(svgId, module.manifest.id);
            }
        }
        // 环境里没有 DOMParser 时 collectSvgDefsIds 返回空数组，这条断言防止上面变成空跑
        expect(seen.size).toBeGreaterThan(0);
    });
});
