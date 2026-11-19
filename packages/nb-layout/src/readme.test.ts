import {describe, expect, it} from "bun:test";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join, sep} from "node:path";

import {moduleExports} from "@notnotype/neuro-book-test-support/module-exports";

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

    it("随包发布的文档不引 Spec 的编号，也不用指向仓库别处的相对链接（npm 上会断）；包内的相对链接指向存在的文件", () => {
        const docs = ["README.md", ...readdirSync(join(PACKAGE, "src"), {recursive: true, encoding: "utf8"}).filter((file) => file.endsWith(".md")).map((file) => join("src", file))];
        const problems = docs.flatMap((file) => {
            const text = readFileSync(join(PACKAGE, file), "utf8");
            // Spec 的条目编号：输出、失败、验收。只管随包的 .md；源码注释里的编号不在本条的范围（Task 记录里写明）。
            const cited = [...text.matchAll(/(?:输出|失败|验收) ?[0-9]+/gu)].map((match) => `${file}: ${match[0]}`);
            const links = [...text.matchAll(/\]\(([^)#\s]+)/gu)].map((match) => match[1]!).filter((target) => !/^[a-z]+:/u.test(target));
            const broken = links.flatMap((target) => {
                if (target.startsWith("/")) return [`${file}: ${target}（根相对路径）`];
                const resolved = join(PACKAGE, file, "..", target);
                if (resolved !== PACKAGE && !resolved.startsWith(PACKAGE + sep)) return [`${file}: ${target}（跳出了包目录）`];
                return existsSync(resolved) ? [] : [`${file}: ${target}（文件不存在）`];
            });
            return [...cited, ...broken];
        });
        expect(problems).toEqual([]);
    });

    it("“我要做 X 用哪个导出”表里的名字，都从那一行写的入口导出", () => {
        const readme = readFileSync(join(PACKAGE, "README.md"), "utf8");
        const section = readme.slice(readme.indexOf("## 我要做 X 用哪个导出"), readme.indexOf("## 约定"));
        const entries: Readonly<Record<string, string>> = {"根": "src/index.ts", "./vue": "src/vue/index.ts", "./text": "src/vue/text.ts", "./locales": "src/locales/index.ts"};
        const exported = new Map(Object.entries(entries).map(([entry, file]) => [entry, new Set(moduleExports(readFileSync(join(PACKAGE, file), "utf8")).map((item) => item.name))]));
        const rows = section.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| 要做的事") && !line.startsWith("|---"));
        expect(rows.length).toBeGreaterThan(10);
        const missing = rows.flatMap((row) => {
            // 行首的 `|` 前面是空串，然后是“要做的事”“用这个”“从哪个入口”三列。
            const [, , names = "", from = ""] = row.split("|").map((cell) => cell.trim());
            const listed = Object.keys(entries).filter((entry) => from.includes(entry));
            // 只核对裸名字：带点的是方法（`grid.splitLeaf`），带括号的取括号前的名字。
            const identifiers = [...names.matchAll(/`([^`]+)`/gu)].map((match) => match[1]!.replace(/\(.*$/u, "")).filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name));
            return identifiers.filter((name) => !listed.some((entry) => exported.get(entry)?.has(name))).map((name) => `${name}（${from}）`);
        });
        expect(missing).toEqual([]);
    });
});
