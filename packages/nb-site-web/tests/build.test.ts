/**
 * 前端的构建能跑通：真跑一次 `vite build`，看产物里有页面、有 CSS，CSS 里带着 nb-ui 的语义类、nbook 主题的变量与站点自己的原子类。
 * nb-ui 不发预编译的 CSS，它的样式由本包的 Tailwind 编译（`src/app.css`）；接法坏了（漏了 nb-ui 的入口、主题模块没带进来、站点的源码没被扫到）
 * 只有真构建一次才看得出来。主题在运行期有没有写到根元素上，由 `src/site.dom.test.ts` 管。
 *
 * 另外三条（t10 计划 3.10）：`index.html` 里没有内联脚本（内容安全策略的 `script-src` 只许 `'self'`，计划 3.8）；
 * ECharts 只在看板自己的块里，访客与普通用户的入口块不带它；看板块的 gzip 大小有上限，并记下入口块与看板块的大小（计划第 8 节风险 8）。
 * 入口块也有上限，且不带账号页才用的对话框与菜单（B4 审查第 19 条：nb-ui 的汇总出口把它们带进了入口，`vite.config.ts` 的 `treeshake`）。
 *
 * 构建只跑一次（`beforeAll`），几条测试读同一份产物。构建超过快速类 200 毫秒的预算（要几秒）：测的就是构建本身，没有更快的等价做法。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {readdir, readFile, rm} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {gzipSync} from "node:zlib";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");

/** 看板块 gzip 之后的上限（计划 3.10）：B5 量到 172.9 KB（几乎都是按需导入的 ECharts），留一点余量，挡住有人整包导入（约 390 KB）。 */
const DASHBOARD_GZIP_LIMIT = 200 * 1024;
/**
 * 入口块（含静态导入）gzip 之后的上限。登录页是首页，它的表单、状态行与社交图标都在入口里；2026-11-27 量到 81.2 KB，
 * B5 加上管理面板与看板的文字后 82.8 KB（B2 时约 59.3 KB，B4 把账号页的弹层带进来涨到 120 KB），留一成余量：
 * 正常加功能不会撞到，把一整组没用到的组件带进来就会。
 * 确实要加大时改这里并写明为什么。
 */
const ENTRY_GZIP_LIMIT = 90 * 1024;
/** 看板页在清单里的键（相对 Vite 的根 `src/`）。 */
const DASHBOARD_SOURCE = "pages/admin/DashboardPage.vue";
/** 管理面板的外壳：五页共用，单独一个块，也不在入口里（计划 3.13）。 */
const ADMIN_SHELL_SOURCE = "pages/admin/AdminShell.vue";
/**
 * 认一个包：块的 sourcemap 里 `sources` 有这个包目录下的文件。按来源认，不在压缩后的代码里找名字（名字会被改掉，也会
 * 出现在别的包的字符串里）。Bun 的工作区把包装在 `node_modules/.bun/<包@版本>/node_modules/<包>/` 下，所以中间可以隔几层。
 */
const fromPackage = (...names: readonly string[]): RegExp => new RegExp(`(?:^|/)node_modules/(?:.+/node_modules/)?(?:${names.join("|")})/`, "u");
/** ECharts 与它的渲染库 ZRender。 */
const ECHARTS_SOURCE = fromPackage("echarts", "zrender");
/** 必然在入口块里的包：先用它确认按来源认得出，免得 ECharts 那条因为读不到来源而空过。 */
const VUE_ROUTER_SOURCE = fromPackage("vue-router");
/**
 * 访客入口不该带的弹层与菜单：reka-ui 的对话框与菜单，nb-ui 包着它们的组件。只有账号页用，跟着账号页的块走。
 * nb-ui 是工作区包，来源路径是 `packages/nb-ui/src/…`，不在 `node_modules` 下。
 */
const POPUP_SOURCES: readonly RegExp[] = [
    new RegExp(`${fromPackage("reka-ui").source}dist/(?:Dialog|AlertDialog|Menu|DropdownMenu)/`, "u"),
    /\/nb-ui\/src\/components\/(?:feedback\/(?:Dialog|AlertDialog)|popup\/DropdownMenu)\.vue$/u,
];
/** 合同包的 schema 用的 TypeBox：浏览器只用合同包里的常量，产物里不该有它的运行时（`vite.config.ts` 的 `treeshake`）。 */
const TYPEBOX_SOURCE = fromPackage("typebox");
/** 一定在入口块里的 nb-ui 组件：先确认认得出 nb-ui 的来源，免得上面那条因为路径写错而空过。 */
const NB_UI_BUTTON_SOURCE = /\/nb-ui\/src\/components\/[^/]+\/Button\.vue$/u;

/** Vite 清单（`.vite/manifest.json`）里一个块的样子：`imports` 与 `dynamicImports` 是别的块在清单里的键。 */
interface ManifestChunk {
    readonly file: string;
    readonly isEntry?: boolean;
    readonly isDynamicEntry?: boolean;
    readonly imports?: readonly string[];
    readonly dynamicImports?: readonly string[];
}

let outDir = "";
let root = "";
let build: {readonly exitCode: number; readonly stderr: string} | undefined;

beforeAll(async () => {
    root = await createTestTmpRoot("nb-site-web-build", "nb-site-web vite build");
    outDir = join(root, "dist");
    const vite = join(dirname(createRequire(join(PACKAGE_ROOT, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
    // `--manifest`：按源文件认出块（看板块是 `DASHBOARD_SOURCE` 的块），不靠文件名里的哈希前缀。
    // `--sourcemap`：按 sourcemap 的 `sources` 认出块里有哪些包。只多出 `.map` 文件与每块末尾一行注释，代码本身与 `bun run build` 相同。
    const child = Bun.spawn([process.execPath, vite, "build", "--outDir", outDir, "--emptyOutDir", "--manifest", "--sourcemap", "--logLevel", "warn"], {
        cwd: PACKAGE_ROOT,
        // `bun test` 把 `NODE_ENV` 设成 `test`，子进程继承下来时 Vite 按它打出带开发版 Vue 的产物（入口块大三成多），
        // 量到的体积与线上不符。这里要的是与 `bun run build` 相同的产物。
        env: {...process.env, NODE_ENV: "production"},
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
    build = {exitCode, stderr};
}, 180_000);

afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

async function manifest(): Promise<Readonly<Record<string, ManifestChunk>>> {
    return JSON.parse(await readFile(join(outDir, ".vite", "manifest.json"), "utf8")) as Record<string, ManifestChunk>;
}

/**
 * 从这些块出发、顺着导入能到的全部块。只走静态导入（`imports`）时，是加载它们时浏览器一起下载的；连同动态导入（`dynamicImports`）
 * 时，是从那里点得到的全部页面。`skip` 里的块不进也不往下走。
 */
function closure(chunks: Readonly<Record<string, ManifestChunk>>, from: readonly string[], options: {readonly dynamic: boolean; readonly skip?: string}): Set<string> {
    const seen = new Set<string>();
    const pending = from.filter((key) => key !== options.skip);
    while (pending.length > 0) {
        const key = pending.pop()!;
        if (seen.has(key)) continue;
        seen.add(key);
        const chunk = chunks[key];
        const next = [...(chunk?.imports ?? []), ...(options.dynamic ? (chunk?.dynamicImports ?? []) : [])];
        pending.push(...next.filter((target) => target !== options.skip));
    }
    return seen;
}

/** gzip 之后的大小。去掉 `--sourcemap` 加在末尾的那行注释，与线上的产物一样大。 */
async function gzipBytes(files: Iterable<string>): Promise<number> {
    let total = 0;
    for (const file of files) total += gzipSync((await readFile(join(outDir, file), "utf8")).replace(/\n?\/\/# sourceMappingURL=\S+\s*$/u, "")).length;
    return total;
}

/**
 * 一个块的 sourcemap 里的来源路径。只由虚拟模块组成的块（几个页面共用的 `@vitejs/plugin-vue` 的 export helper）没有来源文件，
 * 构建不给它写 `.map`，末尾也没有 `sourceMappingURL` 那行注释：这样的块没有来自哪个包的代码，按没有来源算。有注释却读不到 `.map`
 * 照样抛出。
 */
async function sourcesOf(file: string): Promise<readonly string[]> {
    const code = await readFile(join(outDir, file), "utf8");
    if (!/\/\/# sourceMappingURL=\S+\s*$/u.test(code)) return [];
    return (JSON.parse(await readFile(join(outDir, `${file}.map`), "utf8")) as {readonly sources: readonly string[]}).sources;
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(2)} KB`;

describe("vite build", () => {
    test("以 0 退出、标准错误为空", () => {
        expect(build).toEqual({exitCode: 0, stderr: ""});
    });

    test("index.html 有挂载点，所有脚本都是外部文件，没有内联脚本", async () => {
        const html = await readFile(join(outDir, "index.html"), "utf8");
        expect(html).toContain('<div id="app"></div>');
        const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)].map((match) => ({attributes: match[1]!.trim(), body: match[2]!.trim()}));
        expect(scripts.length).toBeGreaterThan(0);
        expect(scripts.filter((script) => !/\bsrc=/iu.test(script.attributes) || script.body !== "")).toEqual([]);
    });

    test("CSS 里有 nb-ui 的语义类、nbook 主题与站点的原子类，每条 -webkit-backdrop-filter 都有同值的标准写法", async () => {
        const cssFiles = (await readdir(join(outDir, "assets"))).filter((name) => name.endsWith(".css"));
        expect(cssFiles.length).toBeGreaterThan(0);
        const css = (await Promise.all(cssFiles.map((name) => readFile(join(outDir, "assets", name), "utf8")))).join("\n");
        // 三样各来自一处，缺哪样就是哪处没接上：nb-ui 的语义类（`@import "@notnotype/nb-ui/tailwind.css"` 带来的 styles.css；
        // 主题的 vars.css 里也有 token，所以不拿 token 判断这一条）、nbook 主题的变量（main.ts 导入的主题模块）、
        // 站点自己源码里的原子类（Tailwind 扫到了站点的源码；取 `App.vue` 根元素上的那个，那里的注释写明了它是探针）。
        expect(css).toContain(".nb-ui-scrollbar-thin");
        expect(css).toMatch(/\[data-nb-theme=["']?nbook["']?\]/u);
        expect(css).toContain(".min-h-svh");

        // CSS 压缩不能丢掉不带前缀的 `backdrop-filter`：Lightning CSS 曾把它与后写的 `-webkit-` 那条合并成只剩后者，Chrome 不认，
        // 对话框背后的字透出来（dev-panel 的 `tests/web-build.test.ts` 同一条）。nb-ui 现在把前缀写在前面，用缺省的压缩就行；
        // 这条守着它以后不回退。
        const values = (pattern: RegExp): Set<string> => new Set([...css.matchAll(pattern)].map((match) => match[1]!.trim()));
        const prefixed = values(/-webkit-backdrop-filter:([^;}]+)/gu);
        const standard = values(/(?<![-\w])backdrop-filter:([^;}]+)/gu);
        expect(prefixed.has("var(--overlay-blur)")).toBe(true);
        expect([...prefixed].filter((value) => !standard.has(value))).toEqual([]);
    });

    test("看板与管理面板外壳是单独的块；ECharts 在看板自己的块里、别的块里没有；看板块与入口块的 gzip 不超过上限；入口不带对话框与菜单；哪个块都不带 TypeBox", async () => {
        const chunks = await manifest();
        const entries = Object.entries(chunks).filter(([, chunk]) => chunk.isEntry === true).map(([key]) => key);
        expect(entries.length).toBe(1);
        const dashboard = chunks[DASHBOARD_SOURCE];
        expect(dashboard?.isDynamicEntry).toBe(true);

        expect(chunks[ADMIN_SHELL_SOURCE]?.isDynamicEntry).toBe(true);

        const entryClosure = closure(chunks, entries, {dynamic: false});
        expect(entryClosure.has(DASHBOARD_SOURCE)).toBe(false);
        expect(entryClosure.has(ADMIN_SHELL_SOURCE)).toBe(false);
        // 看板自己的块：从看板出发静态能到的块里，绕开看板、从入口经任何导入都到不了的那些。与别的页共用的块（管理面板外壳、页面空壳）不算。
        const reachableWithoutDashboard = closure(chunks, entries, {dynamic: true, skip: DASHBOARD_SOURCE});
        const dashboardOnly = [...closure(chunks, [DASHBOARD_SOURCE], {dynamic: false})].filter((key) => !reachableWithoutDashboard.has(key));
        expect(dashboardOnly).toContain(DASHBOARD_SOURCE);
        console.info(`入口块：${[...entryClosure].map((key) => chunks[key]!.file).join("、")}`);

        const entryFiles = [...entryClosure].map((key) => chunks[key]!.file);
        const entrySources = (await Promise.all(entryFiles.map(sourcesOf))).flat();
        expect(entrySources.some((source) => VUE_ROUTER_SOURCE.test(source))).toBe(true);
        expect(entrySources.some((source) => NB_UI_BUTTON_SOURCE.test(source))).toBe(true);
        expect(entrySources.filter((source) => POPUP_SOURCES.some((pattern) => pattern.test(source)))).toEqual([]);

        const dashboardFiles = new Set(dashboardOnly.map((key) => chunks[key]!.file));
        const dashboardSources = (await Promise.all([...dashboardFiles].map(sourcesOf))).flat();
        expect(dashboardSources.some((source) => ECHARTS_SOURCE.test(source))).toBe(true);
        const jsFiles = (await readdir(join(outDir, "assets"))).filter((name) => name.endsWith(".js")).map((name) => `assets/${name}`);
        const withEcharts: string[] = [];
        for (const file of jsFiles) {
            if (!dashboardFiles.has(file) && (await sourcesOf(file)).some((source) => ECHARTS_SOURCE.test(source))) withEcharts.push(file);
        }
        expect(withEcharts).toEqual([]);
        const withTypebox: string[] = [];
        for (const file of jsFiles) if ((await sourcesOf(file)).some((source) => TYPEBOX_SOURCE.test(source))) withTypebox.push(file);
        expect(withTypebox).toEqual([]);

        const entryGzip = await gzipBytes(entryFiles);
        const dashboardGzip = await gzipBytes(dashboardFiles);
        // 体积记在测试输出里（计划第 8 节风险 8）：入口块是访客打开任何一页都要下载的脚本，含它静态导入的块。
        console.info(`入口块（含静态导入）gzip ${kb(entryGzip)}（上限 ${kb(ENTRY_GZIP_LIMIT)}）；看板自己的块 gzip ${kb(dashboardGzip)}（上限 ${kb(DASHBOARD_GZIP_LIMIT)}）`);
        expect(dashboardGzip).toBeLessThanOrEqual(DASHBOARD_GZIP_LIMIT);
        expect(entryGzip).toBeLessThanOrEqual(ENTRY_GZIP_LIMIT);
    });
});
