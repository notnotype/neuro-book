/**
 * 引用的目标分类与解析（docs/specs/workspace/markdown-dialect.md 输出 18、27）。
 */

import {describe, expect, it} from "bun:test";

import {relativeTarget} from "@notnotype/nb-markdown";

import {parseResource} from "nbook/plugins/files/shared/contracts";

import {classifyTarget, encodeFileTarget} from "./targets";

const BASE = "project://正文/第一卷/第一章.md";

describe("Spec workspace.markdown-dialect 输出 18、27：引用的目标", () => {
    it("相对地址按所在文件的目录解析，`/` 开头按作品根；带 `..` 越出根的不显示", () => {
        expect(classifyTarget("../设定/林雪.md", BASE)).toEqual({kind: "work", address: "project://正文/设定/林雪.md", name: "林雪.md"});
        expect(classifyTarget("images/a.png", BASE)).toEqual({kind: "work", address: "project://正文/第一卷/images/a.png", name: "a.png"});
        expect(classifyTarget("/设定/林雪.md", BASE)).toEqual({kind: "work", address: "project://设定/林雪.md", name: "林雪.md"});
        expect(classifyTarget("../../../外面.md", BASE)).toEqual({kind: "work", address: null, name: "外面.md"});
        expect(classifyTarget("./a%20b.png#片段", BASE)).toEqual({kind: "work", address: "project://正文/第一卷/a b.png", name: "a b.png"});
    });

    it("`user://` 下的文件里 `/` 开头按用户资产根；带方案的作品与用户地址照常解析", () => {
        expect(classifyTarget("/图库/封面.png", "user://模板/说明.md")).toEqual({kind: "user", address: "user://图库/封面.png", name: "封面.png"});
        expect(classifyTarget("project://设定/林雪.md", null)).toEqual({kind: "work", address: "project://设定/林雪.md", name: "林雪.md"});
        expect(classifyTarget("user://a.png", BASE)).toEqual({kind: "user", address: "user://a.png", name: "a.png"});
    });

    it("没有所在文件（Composer、展示器）：`/` 开头按作品根，相对地址解析不了归为其它", () => {
        expect(classifyTarget("/设定/林雪.md", null)).toEqual({kind: "work", address: "project://设定/林雪.md", name: "林雪.md"});
        expect(classifyTarget("设定/林雪.md", null)).toEqual({kind: "other", address: null, name: "林雪.md"});
    });

    it("外部链接、附件与别的方案（包括旧应用的领域地址）", () => {
        expect(classifyTarget("https://example.com/a.png", BASE).kind).toBe("external");
        expect(classifyTarget("mailto:me@example.com", BASE).kind).toBe("external");
        expect(classifyTarget("session://attachments/截图.png", null)).toEqual({kind: "attachment", address: null, name: "截图.png"});
        expect(classifyTarget("SESSION://attachments/%E6%88%AA%E5%9B%BE.png", null)).toEqual({kind: "attachment", address: null, name: "截图.png"});
        // 会话工作区里别的文件不是附件。
        expect(classifyTarget("session://plan.md", null)).toEqual({kind: "other", address: null, name: ""});
        expect(classifyTarget("chapter://c1", null)).toEqual({kind: "other", address: null, name: ""});
    });
});

describe("Spec workbench.markdown-editing 输出 57：新建链接与图片的相对地址", () => {
    /** 固定种子的伪随机数：不依赖第三方库，每次跑到同样的组合。 */
    function random(seed: number): () => number {
        let state = seed;
        return () => {
            state = (state + 0x6d2b79f5) | 0;
            let t = Math.imul(state ^ (state >>> 15), 1 | state);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    // 名字里的 `%`、`#`、`?`、`:`、空格、括号、已经是编码样子的 `%20`、`%2F` 都要读回同一个文件。
    const NAMES = ["a", "甲", "a b", "图#1", "100%", "a?b", "a:b", "(x)", "a%20b", "%2F", "x.png", "林雪的设定.md", "a#b?c%d:e"];

    it("任意两个作品地址：写出的相对地址经真实的解析读回原来的目标", () => {
        const next = random(20261117);
        const pick = (): string => NAMES[Math.floor(next() * NAMES.length)] as string;
        const path = (): string => Array.from({length: 1 + Math.floor(next() * 4)}, pick).join("/");
        let checked = 0;
        for (let round = 0; round < 4000; round += 1) {
            const from = `project://${path()}`;
            const to = `project://${path()}`;
            if (!parseResource(from).ok || !parseResource(to).ok) continue;
            const written = relativeTarget(from, to, {classify: () => ({kind: "other", name: ""}), encodeFile: encodeFileTarget});
            expect(written).not.toBeNull();
            // 读回：第一段不能被当成方案。
            expect(classifyTarget(written as string, from)).toMatchObject({kind: "work", address: to});
            checked += 1;
        }
        expect(checked).toBeGreaterThan(2000);
    });

    it("读不回的写法被拦下：不带 ./ 的 a:b.md 会被当成方案", () => {
        expect(classifyTarget("a:b.md", "project://x.md").kind).toBe("other");
        expect(relativeTarget("project://x.md", "project://a:b.md", {classify: () => ({kind: "other", name: ""}), encodeFile: encodeFileTarget})).toBe("./a:b.md");
    });
});
