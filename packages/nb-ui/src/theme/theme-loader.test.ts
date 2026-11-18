import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {NB_UI_VERSION} from "../version";
import {satisfiesRange} from "./semver-range";
import {
    NbThemeInstallError,
    getInstalledTheme,
    getInstalledThemes,
    installTheme,
    resetInstalledThemes,
    uninstallTheme,
} from "./theme-loader";
import type {NbThemeModule} from "./theme-manifest";


function themeModule(overrides: Partial<NbThemeModule["manifest"]> = {}, rest: Partial<NbThemeModule> = {}): NbThemeModule {
    return {
        manifest: {
            id: "probe",
            name: "Probe",
            version: "1.0.0",
            hostVersion: `^${NB_UI_VERSION.split("-")[0]}`,
            ...overrides,
        },
        ...rest,
    };
}

afterEach(() => {
    resetInstalledThemes();
});

describe("nb-ui theme loader", () => {
    // 主题包用 hostVersion 对着它校验，两边漂了就会莫名其妙全拒或全放
    it("keeps NB_UI_VERSION in sync with package.json", () => {
        const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf-8")) as {
            version: string;
        };

        expect(NB_UI_VERSION).toBe(pkg.version);
    });

    // 提 nb-ui 的版本号时，自带主题的 hostVersion 要一起改：漏了，宿主装载时把它们全部拒掉（w00046 t11 发布演练的
    // nbstory 查看器卡在加载页）。在这里失败，比等到发布冒烟才发现早。
    it("bundled themes accept the current NB_UI_VERSION", async () => {
        const themesDir = join(import.meta.dirname, "..", "..", "themes");
        const names = readdirSync(themesDir, {withFileTypes: true}).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
        expect(names.length).toBeGreaterThan(0);
        const rejected: string[] = [];
        for (const name of names) {
            const {manifest} = (await import(join(themesDir, name, "manifest.ts"))) as {manifest: NbThemeModule["manifest"]};
            if (!satisfiesRange(NB_UI_VERSION, manifest.hostVersion)) rejected.push(`${name}: ${manifest.hostVersion}`);
        }
        expect(rejected).toEqual([]);
    });

    it("installs a minimal declarative theme", () => {
        const entry = installTheme(themeModule());

        expect(entry.manifest.id).toBe("probe");
        expect(getInstalledTheme("probe")).toBe(entry);
        expect(getInstalledThemes()).toHaveLength(1);
    });

    it("uninstalls by id", () => {
        installTheme(themeModule());

        expect(uninstallTheme("probe")).toBe(true);
        expect(uninstallTheme("probe")).toBe(false);
        expect(getInstalledThemes()).toHaveLength(0);
    });

    it("writes declared fallbacks into a :root layer", () => {
        installTheme(
            themeModule({
                declares: [{name: "--glass-blur", fallback: "none"}, {name: "--window-backdrop", fallback: "none"}],
            }),
        );

        const style = document.getElementById("nb-theme-var-fallbacks");
        expect(style?.textContent).toContain("--glass-blur: none;");
        expect(style?.textContent).toContain("--window-backdrop: none;");
        // 兜底层必须停在 :root，主题自己的取值挂 [data-nb-theme] 才能靠特异性压过它
        expect(style?.textContent?.trimStart().startsWith(":root {")).toBe(true);
    });

    it("drops the fallback layer once the last theme is gone", () => {
        installTheme(themeModule({declares: [{name: "--glass-blur", fallback: "none"}]}));
        uninstallTheme("probe");

        expect(document.getElementById("nb-theme-var-fallbacks")).toBeNull();
    });

    it("keeps colorways on the installed entry", () => {
        const entry = installTheme(
            themeModule(
                {providesColorways: ["probe-dark"]},
                {
                    colorways: {"probe-dark": {"--color-scheme": "dark", "--bg-main": "#000"}},
                    colorwayMeta: {"probe-dark": {label: "Probe Dark", appearance: "dark"}},
                },
            ),
        );

        expect(entry.colorways["probe-dark"]?.["--bg-main"]).toBe("#000");
        expect(entry.colorwayMeta["probe-dark"]?.appearance).toBe("dark");
    });
});

/*
 * 负例是这套设计的核心防线。市场场景下静默半坏比直接失败糟得多——用户会当成产品的 bug，
 * 而且没有任何线索指回主题。所以每一条都必须「拒绝装载 + 给出可读原因」。
 */
describe("nb-ui theme loader rejections", () => {
    it("rejects a theme built for another host version", () => {
        expect(() => installTheme(themeModule({hostVersion: "^9.0.0"}))).toThrow(NbThemeInstallError);
        expect(() => installTheme(themeModule({hostVersion: "^9.0.0"}))).toThrow(/当前 nb-ui 是/);
        expect(getInstalledThemes()).toHaveLength(0);
    });

    it("rejects an unsupported hostVersion range instead of judging it false", () => {
        expect(() => installTheme(themeModule({hostVersion: ">=0.1.0 <9.0.0"}))).toThrow(/不支持复合版本范围/);
    });

    it("rejects a declaration without a fallback", () => {
        // @ts-expect-error 故意造一个缺 fallback 的声明：契约要求必填，这里验运行期也会拒
        expect(() => installTheme(themeModule({declares: [{name: "--glass-blur"}]}))).toThrow(
            /没有 fallback/,
        );
        expect(() => installTheme(themeModule({declares: [{name: "--glass-blur", fallback: "  "}]}))).toThrow(
            /没有 fallback/,
        );
    });

    it("rejects a declaration that shadows a colorway or token variable", () => {
        expect(() => installTheme(themeModule({declares: [{name: "--bg-main", fallback: "#fff"}]}))).toThrow(
            /已经在配色契约或设计 token 里/,
        );
        expect(() => installTheme(themeModule({declares: [{name: "--radius-control", fallback: "4px"}]}))).toThrow(
            /已经在配色契约或设计 token 里/,
        );
    });

    it("rejects installing the same id twice", () => {
        installTheme(themeModule());

        expect(() => installTheme(themeModule())).toThrow(/同名主题已经装过/);
    });

    /*
     * SVG 的 id 是全文档级的：装载器按主题 id 分隐藏容器，但容器不隔离 id。
     * 两套主题都定义 <filter id="lens"> 时 url(#lens) 取先装的那一个，浏览器不报任何错，
     * 现象是「装了 A 之后 B 的折射强度变了」，没有线索指回主题。所以在装载时就拒。
     *
     * 与「两套主题声明同一个 CSS 变量名」刚好相反，那一条是允许的：CSS 变量按特异性分胜负，
     * 结果确定，且重名本身是「配色契约漏了个角色」的有用信号。
     */
    it("rejects an svg defs id another installed theme already owns", () => {
        const defs = '<filter id="lens"><feGaussianBlur stdDeviation="2" /></filter>';
        installTheme(themeModule({id: "first"}, {svgDefs: defs}));

        expect(() => installTheme(themeModule({id: "second"}, {svgDefs: defs}))).toThrow(/与已装主题 "first" 重名/);
        expect(getInstalledThemes()).toHaveLength(1);
    });

    it("lets a theme keep its own svg defs ids after another theme is uninstalled", () => {
        // 拒绝的是并存，不是这个 id 本身——卸掉占用方之后应该装得上
        const defs = '<filter id="lens"><feGaussianBlur stdDeviation="2" /></filter>';
        installTheme(themeModule({id: "first"}, {svgDefs: defs}));
        uninstallTheme("first");

        expect(() => installTheme(themeModule({id: "second"}, {svgDefs: defs}))).not.toThrow();
    });

    // 与 override-mismatch 同源：manifest 说有两套配色而实际只有一套，市场页展示的就是假的
    it("rejects a manifest and entry that disagree about colorways", () => {
        expect(() => installTheme(themeModule({providesColorways: ["probe-dark"]}))).toThrow(
            /没有给出它的取值表/,
        );

        expect(() =>
            installTheme(
                themeModule(
                    {},
                    {
                        colorways: {"probe-dark": {"--bg-main": "#000"}},
                        colorwayMeta: {"probe-dark": {label: "Probe Dark", appearance: "dark"}},
                    },
                ),
            ),
        ).toThrow(/providesColorways 没有列出它/);
    });

    it("rejects a bundled colorway without meta", () => {
        // 明暗归属在 meta 里，缺了它主题就没法按 data-nb-appearance 分档
        expect(() =>
            installTheme(
                themeModule({providesColorways: ["probe-dark"]}, {colorways: {"probe-dark": {"--bg-main": "#000"}}}),
            ),
        ).toThrow(/缺 colorwayMeta/);
    });

    it("rejects a bundled colorway that shadows a built-in id", () => {
        // 否则「切到 dark」在装不装这套主题时是两种颜色，用户无从知道为什么
        expect(() =>
            installTheme(
                themeModule(
                    {providesColorways: ["dark"]},
                    {
                        colorways: {dark: {"--bg-main": "#000"}},
                        colorwayMeta: {dark: {label: "Probe Dark", appearance: "dark"}},
                    },
                ),
            ),
        ).toThrow(/与内置配色重名/);
    });

    it("rejects a defaultColorway that points at nothing, or at the wrong appearance", () => {
        expect(() => installTheme(themeModule({defaultColorway: {light: "nope", dark: "dark"}}))).toThrow(
            /既不在本主题自带的配色里，也不是内置配色/,
        );

        // 亮色槽指向一套暗色配色：装得上但一进来就是黑的，且看不出是主题写错了
        expect(() => installTheme(themeModule({defaultColorway: {light: "dark", dark: "dark"}}))).toThrow(
            /appearance 是 dark/,
        );
    });

    it("accepts a defaultColorway mixing the built-in dark with the theme's own light", () => {
        /*
         * 内置配色只剩 dark 一套（两套亮色 sepia / light 已下线），所以 light 槽只能指向
         * 主题自带的配色。这就是「主题自带配色」这个扩展点从可选变成必需的那一刻。
         */
        expect(() =>
            installTheme(
                themeModule(
                    {providesColorways: ["probe-light"], defaultColorway: {light: "probe-light", dark: "dark"}},
                    {
                        colorways: {"probe-light": {"--bg-main": "#fff"}},
                        colorwayMeta: {"probe-light": {label: "Probe Light", appearance: "light"}},
                    },
                ),
            ),
        ).not.toThrow();
    });
});
