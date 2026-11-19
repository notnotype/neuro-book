import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

/**
 * README 的起步例子与仓库 Lab 的 `starter` 场景是同一份代码：场景能编译（应用的类型检查）、能在真实浏览器里跑
 * （`lab-grid-structure.e2e.ts` 的“起步例子”），这里核对 README 里那段与它一字不差，改了库的接口而忘了改 README 会红。
 */

const PACKAGE = join(import.meta.dir, "..");
const REPO = join(PACKAGE, "..", "..");
const MARKER = /<!-- starter: (\S+)/u;

describe("README", () => {
    it("起步例子与 Lab 的 starter 场景一字不差", () => {
        const readme = readFileSync(join(PACKAGE, "README.md"), "utf8");
        const marker = MARKER.exec(readme);
        if (marker === null) throw new Error("README 里没有 starter 标记");
        const after = readme.slice(marker.index);
        const block = /```vue\n([\s\S]*?)\n```/u.exec(after);
        if (block === null) throw new Error("starter 标记后面没有 vue 代码块");
        const scene = readFileSync(join(REPO, marker[1]!), "utf8");
        expect(block[1]).toBe(scene.replace(/\n$/u, ""));
    });

    it("随包发布的文档不引 Spec 的编号，也不用指向仓库别处的相对链接（npm 上会断）", () => {
        const docs = ["README.md", ...readdirSync(join(PACKAGE, "src"), {recursive: true, encoding: "utf8"}).filter((file) => file.endsWith(".md")).map((file) => join("src", file))];
        const problems = docs.flatMap((file) => {
            const text = readFileSync(join(PACKAGE, file), "utf8");
            const cited = [...text.matchAll(/输出 [0-9]+/gu)].map((match) => `${file}: ${match[0]}`);
            // 包内文件之间的相对链接可以（`src` 随包发布）；跳出包目录的不行。
            const outside = [...text.matchAll(/\]\(([^)#]+)/gu)]
                .map((match) => match[1]!)
                .filter((target) => !/^[a-z]+:/u.test(target) && !join(PACKAGE, file, "..", target).startsWith(PACKAGE))
                .map((target) => `${file}: ${target}`);
            return [...cited, ...outside];
        });
        expect(problems).toEqual([]);
    });
});
