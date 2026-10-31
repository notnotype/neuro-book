/**
 * 网页包的构建记录与新旧检查（docs/specs/story/cli-skill.md 输出 5）：改了、删了记录里的源文件就是旧的，node_modules
 * 与虚拟模块不进记录，没有记录和没有网页包各是各的状态。用真实的文件，不替身。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, rm, utimes, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {checkWebFreshness, STAMP_FILE, writeWebStamp} from "./web-stamp";

let root = "";
let counter = 0;

beforeAll(async () => {
    root = await createTestTmpRoot("nb-story-web-stamp", "nb-story web-stamp");
});

afterAll(async () => {
    await rm(root, {recursive: true, force: true});
});

/** 一个包目录：自己的 src/web，旁边工作区里另一个包的源码，和已经打好的 dist/web（有 index.html）。 */
async function fixture() {
    counter += 1;
    const workspace = join(root, `case-${counter}`);
    const packageRoot = join(workspace, "nb-story");
    const own = join(packageRoot, "src", "web", "App.vue");
    const sibling = join(workspace, "nb-ui", "src", "Button.vue");
    const dependency = join(packageRoot, "node_modules", "left-pad", "index.js");
    const webRoot = join(packageRoot, "dist", "web");
    for (const [path, text] of [[own, "app v1"], [sibling, "button v1"], [dependency, "dep v1"], [join(webRoot, "index.html"), "<html>"]] as const) {
        await mkdir(join(path, ".."), {recursive: true});
        await writeFile(path, text);
    }
    // 打包时见到的模块 id：带查询串的子模块、虚拟模块、node_modules 里的依赖也在里面。
    const ids = [own, `${own}?vue&type=style&index=0&lang.css`, sibling, dependency, "\0plugin-vue:export-helper"];
    await writeWebStamp(webRoot, packageRoot, ids);
    return {packageRoot, webRoot, own, sibling, dependency};
}

describe("网页包新旧", () => {
    test("刚打完包：不旧；只改修改时间、内容不变也不旧", async () => {
        const f = await fixture();
        expect(await checkWebFreshness(f.webRoot, f.packageRoot)).toEqual({state: "fresh"});
        await utimes(f.own, new Date(2030, 0, 1), new Date(2030, 0, 1));
        expect(await checkWebFreshness(f.webRoot, f.packageRoot)).toEqual({state: "fresh"});
    });

    test("网页自己的源码或工作区里别的包的源码改了：旧，列出改了的文件（相对包目录）", async () => {
        const f = await fixture();
        await writeFile(f.own, "app v2");
        expect(await checkWebFreshness(f.webRoot, f.packageRoot)).toMatchObject({state: "stale", changed: ["src/web/App.vue"]});
        await writeFile(f.sibling, "button v2");
        const result = await checkWebFreshness(f.webRoot, f.packageRoot);
        expect(result).toMatchObject({state: "stale"});
        expect(result.state === "stale" && [...result.changed].sort()).toEqual(["../nb-ui/src/Button.vue", "src/web/App.vue"]);
    });

    test("记录里的源文件删了（改名）：旧", async () => {
        const f = await fixture();
        await rm(f.sibling);
        expect(await checkWebFreshness(f.webRoot, f.packageRoot)).toMatchObject({state: "stale", changed: ["../nb-ui/src/Button.vue"]});
    });

    test("node_modules 里的依赖改了不算：它不进记录", async () => {
        const f = await fixture();
        await writeFile(f.dependency, "dep v2");
        expect(await checkWebFreshness(f.webRoot, f.packageRoot)).toEqual({state: "fresh"});
    });

    test("有网页包没有记录（早先版本打的）：no-stamp；连网页包都没有：unbuilt", async () => {
        const f = await fixture();
        await rm(join(f.webRoot, STAMP_FILE));
        expect(await checkWebFreshness(f.webRoot, f.packageRoot)).toEqual({state: "no-stamp"});
        await rm(join(f.webRoot, "index.html"));
        expect(await checkWebFreshness(f.webRoot, f.packageRoot)).toEqual({state: "unbuilt"});
    });
});
