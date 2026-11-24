/**
 * 前端的构建能跑通：真跑一次 `vite build`，看产物里有页面、有 CSS，CSS 里带着 nb-ui 的语义类、nbook 主题的变量与站点自己的原子类。
 * nb-ui 不发预编译的 CSS，它的样式由本包的 Tailwind 编译（`src/app.css`）；接法坏了（漏了 nb-ui 的入口、主题模块没带进来、站点的源码没被扫到）
 * 只有真构建一次才看得出来。
 *
 * 这条测试超过快速类 200 毫秒的预算（一次构建要几秒）：它测的就是构建本身，没有更快的等价做法。
 */

import {afterEach, expect, test} from "bun:test";
import {readdir, readFile, rm} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

test("vite build 以 0 退出、标准错误为空，产物有 index.html，CSS 里有 nb-ui 的语义类、nbook 主题与站点的原子类", async () => {
    const root = await createTestTmpRoot("nb-site-web-build", "nb-site-web vite build");
    roots.push(root);
    const outDir = join(root, "dist");
    const vite = join(dirname(createRequire(join(PACKAGE_ROOT, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
    const child = Bun.spawn([process.execPath, vite, "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "warn"], {
        cwd: PACKAGE_ROOT,
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
    expect([exitCode, stderr]).toEqual([0, ""]);

    expect(await readFile(join(outDir, "index.html"), "utf8")).toContain('<div id="app"></div>');
    const cssFiles = (await readdir(join(outDir, "assets"))).filter((name) => name.endsWith(".css"));
    expect(cssFiles.length).toBeGreaterThan(0);
    const css = (await Promise.all(cssFiles.map((name) => readFile(join(outDir, "assets", name), "utf8")))).join("\n");
    // 三样各来自一处，缺哪样就是哪处没接上：nb-ui 的语义类（`@import "@notnotype/nb-ui/tailwind.css"` 带来的 styles.css；
    // 主题的 vars.css 里也有 token，所以不拿 token 判断这一条）、nbook 主题的变量（main.ts 导入的主题模块）、
    // 站点自己源码里的原子类（Tailwind 扫到了站点的源码，取 App.vue 用到的一个）。
    expect(css).toContain(".nb-ui-scrollbar-thin");
    expect(css).toMatch(/\[data-nb-theme=["']?nbook["']?\]/u);
    expect(css).toContain(".min-h-svh");
}, 180_000);
