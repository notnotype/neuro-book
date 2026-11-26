import {afterEach, describe, expect, test} from "bun:test";
import {cp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {siteSourceHash} from "./types";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("任务的版本", () => {
    test("站点的页面、站点模块或共用部件改了，站点源文件的哈希就变；别的站的页面改了不影响这个站", async () => {
        const root = await createTestTmpRoot("neuro-book-browser-eval", "版本");
        roots.push(root);
        const copy = async (name: string) => {
            const dir = join(root, name);
            await cp(join(import.meta.dir, "../sites"), dir, {recursive: true});
            return dir;
        };
        const base = siteSourceHash("author", await copy("base"));
        expect(siteSourceHash("author", await copy("same"))).toBe(base);
        const page = await copy("page");
        await writeFile(join(page, "pages/author/publish.html"), "<p>changed</p>");
        expect(siteSourceHash("author", page)).not.toBe(base);
        const shared = await copy("shared");
        await writeFile(join(shared, "kit.ts"), "// changed\n", {flag: "a"});
        expect(siteSourceHash("author", shared)).not.toBe(base);
        const other = await copy("other");
        await writeFile(join(other, "pages/forum/index.html"), "<p>changed</p>");
        expect(siteSourceHash("author", other)).toBe(base);
    });
});
