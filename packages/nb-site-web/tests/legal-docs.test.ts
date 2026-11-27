/**
 * 条款正文的读法与发布构建的判定（`build/legal-docs.ts`）。插件在真实构建里的样子由 `build.test.ts` 跑子进程量；这里只测
 * 写错的正文与环境变量被拒在哪一步、报的是哪份文件。
 */

import {describe, expect, test} from "bun:test";

import {LegalDocumentError, isReleaseBuild, legalProblems, parseLegalDocument} from "../build/legal-docs";
import type {LegalSource} from "../build/legal-docs";

const document = (frontMatter: string, body = "## 一节\n\n正文。\n"): string => `---\n${frontMatter}\n---\n${body}`;

function rejection(text: string): string {
    try {
        parseLegalDocument(text, "src/legal/zh-CN/x.md");
    } catch (error) {
        if (error instanceof LegalDocumentError) return error.message;
        throw error;
    }
    throw new Error("没有被拒");
}

describe("读一份正文", () => {
    test("读出版本、是否占位与 front matter 之后的正文；Windows 换行也认", () => {
        expect(parseLegalDocument(document("version: 2026-11-20\nplaceholder: true"), "a.md")).toEqual({version: "2026-11-20", placeholder: true, body: "## 一节\n\n正文。\n"} satisfies LegalSource);
        expect(parseLegalDocument(document("version: 2026-11-20").replaceAll("\n", "\r\n"), "a.md")).toEqual({version: "2026-11-20", placeholder: false, body: "## 一节\n\n正文。\n"});
    });

    test("没有 front matter、版本不是真实的日期、多出别的项、正文里有一级标题：拒绝，消息带文件名", () => {
        const cases = [
            "## 一节\n",
            document("placeholder: true"),
            document("version: 2026-11"),
            document("version: 2026-02-30"),
            document("version: 2026-11-20\nplaceholder: false"),
            document("version: 2026-11-20\nlang: zh-CN"),
            document("version: 2026-11-20", "# 隐私政策\n\n正文。\n"),
            document("version: 2026-11-20", "- 列表\n\n  # 藏在列表里的一级标题\n"),
        ];
        for (const text of cases) expect({text, message: rejection(text).startsWith("src/legal/zh-CN/x.md：")}).toEqual({text, message: true});
    });
});

describe("几份正文合起来", () => {
    const source = (version: string, placeholder: boolean): LegalSource => ({version, placeholder, body: ""});

    test("版本不一样时任何构建都不收；发布构建还不收占位正文，逐份列出", () => {
        expect(legalProblems([{label: "a.md", source: source("2026-11-01", true)}, {label: "b.md", source: source("2026-11-01", false)}], false)).toEqual([]);
        expect(legalProblems([{label: "a.md", source: source("2026-11-01", false)}, {label: "b.md", source: source("2026-11-02", false)}], false)).toHaveLength(1);
        const release = legalProblems([{label: "a.md", source: source("2026-11-01", true)}, {label: "b.md", source: source("2026-11-01", false)}], true);
        expect(release).toHaveLength(1);
        expect(release[0]).toStartWith("a.md：");
    });

    test("NB_SITE_RELEASE 只认 1；没设或空着不是发布构建；别的值报错", () => {
        expect([isReleaseBuild({}), isReleaseBuild({NB_SITE_RELEASE: ""}), isReleaseBuild({NB_SITE_RELEASE: "1"})]).toEqual([false, false, true]);
        for (const value of ["true", "0", "yes"]) expect(() => isReleaseBuild({NB_SITE_RELEASE: value})).toThrow("NB_SITE_RELEASE");
    });
});
