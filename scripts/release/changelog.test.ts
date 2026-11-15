import {describe, expect, it} from "vitest";

import {finalizeUnreleased, mergeSections, parseChangelog} from "#scripts/release/changelog";

const SAMPLE = `# 变更记录

说明文字，随便写。

## [Unreleased]

### 修复

- 修好了 A（[#3](https://github.com/notnotype/neuro-book/issues/3)）

## [0.13.1] - 2026-11-20

### 新增

- 新增 B
  续行也算这一条

### 修复

- 修好了 C

## [0.13.0] - 2026-11-15

### 新增

- 第一个桌面版
`;

describe("解析变更记录", () => {
    it("读出 [Unreleased] 与各版本段，条目的续行接在条目后", () => {
        const {unreleased, releases} = parseChangelog(SAMPLE);
        expect([...unreleased]).toEqual([["修复", ["修好了 A（[#3](https://github.com/notnotype/neuro-book/issues/3)）"]]]);
        expect(releases.map((release) => [release.version, release.date])).toEqual([["0.13.1", "2026-11-20"], ["0.13.0", "2026-11-15"]]);
        expect(releases[0]?.section.get("新增")).toEqual(["新增 B\n续行也算这一条"]);
    });

    it("不认识的分类、分类外的条目、读不懂的行、重复的版本、开头不是 [Unreleased]：都报错，不丢条目", () => {
        expect(() => parseChangelog(SAMPLE.replace("### 修复\n\n- 修好了 C", "### Fixed\n\n- 修好了 C"))).toThrow("不认识的分类“Fixed”");
        expect(() => parseChangelog("## [Unreleased]\n\n- 没有分类\n")).toThrow("不在任何分类下");
        expect(() => parseChangelog("## [Unreleased]\n\n### 新增\n\n一段散文\n")).toThrow("读不懂的一行");
        expect(() => parseChangelog(`${SAMPLE}\n## [0.13.0] - 2026-11-15\n`)).toThrow("[0.13.0] 出现了两次");
        expect(() => parseChangelog("## [0.13.0] - 2026-11-15\n")).toThrow("第一个 ## 标题要是 ## [Unreleased]");
        expect(() => parseChangelog("## [Unreleased]\n\n## [0.13.0]\n")).toThrow("不是 ## [<版本>] - <YYYY-MM-DD>");
    });
});

describe("发版时定稿", () => {
    it("[Unreleased] 变成版本段，上方留一个空的 [Unreleased]，别的不动", () => {
        const result = finalizeUnreleased(SAMPLE, "0.13.2", "2026-11-25");
        const {unreleased, releases} = parseChangelog(result);
        expect(unreleased.size).toBe(0);
        expect(releases.map((release) => release.version)).toEqual(["0.13.2", "0.13.1", "0.13.0"]);
        expect(releases[0]?.section.get("修复")).toEqual(["修好了 A（[#3](https://github.com/notnotype/neuro-book/issues/3)）"]);
        expect(result.replace("## [Unreleased]\n\n## [0.13.2] - 2026-11-25", "## [Unreleased]")).toBe(SAMPLE);
    });

    it("[Unreleased] 没有条目、版本段已存在：拒绝", () => {
        expect(() => finalizeUnreleased("## [Unreleased]\n\n## [0.13.0] - 2026-11-15\n\n### 新增\n\n- x\n", "0.13.1", "2026-11-20")).toThrow("没有条目");
        expect(() => finalizeUnreleased(SAMPLE, "0.13.1", "2026-11-25")).toThrow("已经有 [0.13.1]");
    });
});

describe("合并几个版本段", () => {
    it("按分类次序合并；同一条目只留最新那条", () => {
        const {releases} = parseChangelog(SAMPLE.replace("- 第一个桌面版", "- 第一个桌面版\n\n### 修复\n\n- 修好了 C"));
        const merged = mergeSections(releases.map((release) => release.section));
        expect([...merged]).toEqual([
            ["新增", ["新增 B\n续行也算这一条", "第一个桌面版"]],
            ["修复", ["修好了 C"]],
        ]);
        const onlyFix = parseChangelog("## [Unreleased]\n\n## [0.2.0] - 2026-11-20\n\n### 修复\n\n- 新的修复\n\n## [0.1.0] - 2026-11-15\n\n### 新增\n\n- 旧的新增\n");
        expect([...mergeSections(onlyFix.releases.map((release) => release.section)).keys()]).toEqual(["新增", "修复"]);
    });
});
