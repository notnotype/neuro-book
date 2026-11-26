/**
 * 前端的构建能跑通：真跑一次 `vite build`，看产物里有页面、有 CSS，CSS 里带着 nb-ui 的语义类、nbook 主题的变量与站点自己的原子类。
 * nb-ui 不发预编译的 CSS，它的样式由本包的 Tailwind 编译（`src/app.css`）；接法坏了（漏了 nb-ui 的入口、主题模块没带进来、站点的源码没被扫到）
 * 只有真构建一次才看得出来。主题在运行期有没有写到根元素上，由 `src/site.dom.test.ts` 管。
 *
 * 另外三条（t10 计划 3.10）：`index.html` 里没有内联脚本（内容安全策略的 `script-src` 只许 `'self'`，计划 3.8）；
 * ECharts 只在看板自己的块里，访客与普通用户的入口块不带它；看板块的 gzip 大小有上限，并记下入口块与看板块的大小（计划第 8 节风险 8）。
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

/** 看板块 gzip 之后的上限（计划 3.10）：ECharts 按需导入约 178 KB，留一点余量，挡住有人整包导入。 */
const DASHBOARD_GZIP_LIMIT = 200 * 1024;
/** 看板页在清单里的键（相对 Vite 的根 `src/`）。 */
const DASHBOARD_SOURCE = "pages/admin/DashboardPage.vue";
/** 认 ECharts 与它的渲染库 ZRender 的代码。现在还没装 ECharts，这条只是空过；B5 装上后先确认看板块真能被它认出来，再加一条“看板块里有”的正向断言。 */
const ECHARTS_CODE = /echarts|zrender/iu;

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
    const child = Bun.spawn([process.execPath, vite, "build", "--outDir", outDir, "--emptyOutDir", "--manifest", "--logLevel", "warn"], {
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

async function gzipBytes(files: Iterable<string>): Promise<number> {
    let total = 0;
    for (const file of files) total += gzipSync(await readFile(join(outDir, file))).length;
    return total;
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

    test("看板是单独的块；ECharts 只在看板自己的块里；看板块的 gzip 不超过上限", async () => {
        const chunks = await manifest();
        const entries = Object.entries(chunks).filter(([, chunk]) => chunk.isEntry === true).map(([key]) => key);
        expect(entries.length).toBe(1);
        const dashboard = chunks[DASHBOARD_SOURCE];
        expect(dashboard?.isDynamicEntry).toBe(true);

        const entryClosure = closure(chunks, entries, {dynamic: false});
        expect(entryClosure.has(DASHBOARD_SOURCE)).toBe(false);
        // 看板自己的块：从看板出发静态能到的块里，绕开看板、从入口经任何导入都到不了的那些。与别的页共用的块（管理面板外壳、页面空壳）不算。
        const reachableWithoutDashboard = closure(chunks, entries, {dynamic: true, skip: DASHBOARD_SOURCE});
        const dashboardOnly = [...closure(chunks, [DASHBOARD_SOURCE], {dynamic: false})].filter((key) => !reachableWithoutDashboard.has(key));
        expect(dashboardOnly).toContain(DASHBOARD_SOURCE);
        console.info(`入口块：${[...entryClosure].map((key) => chunks[key]!.file).join("、")}`);

        const dashboardFiles = new Set(dashboardOnly.map((key) => chunks[key]!.file));
        const jsFiles = (await readdir(join(outDir, "assets"))).filter((name) => name.endsWith(".js")).map((name) => `assets/${name}`);
        const withEcharts: string[] = [];
        for (const file of jsFiles) {
            if (!dashboardFiles.has(file) && ECHARTS_CODE.test(await readFile(join(outDir, file), "utf8"))) withEcharts.push(file);
        }
        expect(withEcharts).toEqual([]);

        const entryGzip = await gzipBytes([...entryClosure].map((key) => chunks[key]!.file));
        const dashboardGzip = await gzipBytes(dashboardFiles);
        // 体积记在测试输出里（计划第 8 节风险 8）：入口块是访客打开任何一页都要下载的脚本，含它静态导入的块。
        console.info(`入口块（含静态导入）gzip ${kb(entryGzip)}；看板自己的块 gzip ${kb(dashboardGzip)}（上限 ${kb(DASHBOARD_GZIP_LIMIT)}）`);
        expect(dashboardGzip).toBeLessThanOrEqual(DASHBOARD_GZIP_LIMIT);
    });
});
