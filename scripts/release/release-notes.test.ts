import {readFileSync} from "node:fs";

import {describe, expect, it} from "vitest";

import {releaseNotes, type NotesInput, type SourcePackage} from "#scripts/release/release-notes";

const TEMPLATE = readFileSync(new URL("./desktop-release-notes.md", import.meta.url), "utf8");

const APP = `# 变更记录

## [Unreleased]

## [0.13.2] - 2026-11-25

### 修复

- 修好了 A

## [0.13.1] - 2026-11-20

### 新增

- 新增 B

### 修复

- 修好了 A

### 数据与升级

- 书库格式升到 3，旧版本读不了

## [0.13.0] - 2026-11-15

### 新增

- 第一个桌面版
`;

const nbUi = (overrides: Partial<SourcePackage> = {}): SourcePackage => ({dir: "nb-ui", name: "@notnotype/nb-ui", version: "0.4.1", previousVersion: "0.4.0", changelog: "## [Unreleased]\n\n## [0.4.1] - 2026-11-25\n\n### 修复\n\n- x\n", ...overrides});
const nbStory = (overrides: Partial<SourcePackage> = {}): SourcePackage => ({dir: "nb-story", name: "@notnotype/nb-story", version: "0.2.3", previousVersion: "0.2.3", changelog: null, ...overrides});

function input(overrides: Partial<NotesInput> = {}): NotesInput {
    return {version: "0.13.2", stage: "canary", previous: "v0.13.0", repo: "notnotype/neuro-book", appChangelog: APP, packages: [nbUi(), nbStory()], template: TEMPLATE, ...overrides};
}

describe("Release 说明", () => {
    it("开头写阶段；数据与升级放在变更之前；上一个桌面版本之后的版本段都并进来，重复的条目只留一条", () => {
        const {markdown, problems} = releaseNotes(input());
        expect(problems).toEqual([]);
        expect(markdown.split("\n")[0]).toContain("**canary（早期验证版）**");
        const order = ["## 数据与升级", "书库格式升到 3", "## 变更", "### 新增", "- 新增 B", "### 修复", "- 修好了 A", "## 下载哪个"].map((text) => markdown.indexOf(text));
        expect(order.every((position) => position >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(markdown.split("- 修好了 A")).toHaveLength(2);
        // 上一个桌面版本自己的条目不算。
        expect(markdown).not.toContain("第一个桌面版");
        expect(markdown).toContain("**完整对比**：[v0.13.0...v0.13.2](https://github.com/notnotype/neuro-book/compare/v0.13.0...v0.13.2)");
    });

    it("同时发布的 npm 包：只列版本号变了的，链到这个标签下它的 CHANGELOG", () => {
        const {markdown} = releaseNotes(input());
        expect(markdown).toContain("- [`@notnotype/nb-ui` 0.4.1](https://github.com/notnotype/neuro-book/blob/v0.13.2/packages/nb-ui/CHANGELOG.md)");
        expect(markdown).not.toContain("nb-story");
    });

    it("第一个桌面版本（没有上一个）：只取本次的版本段，不列 npm 包、不出对比链接；stable 不加阶段说明", () => {
        const {markdown, problems} = releaseNotes(input({version: "0.13.0", previous: null, stage: "stable"}));
        expect(problems).toEqual([]);
        expect(markdown.split("\n")[0]).toBe("NeuroBook 0.13.0 的 Windows 桌面版。");
        expect(markdown).toContain("- 第一个桌面版");
        expect(markdown).not.toContain("修好了 A");
        expect(markdown).not.toContain("同时发布的 npm 包");
        expect(markdown).not.toContain("完整对比");
    });

    it("应用没有本次的版本段、[Unreleased] 还有条目、提了版本的包没有 CHANGELOG 或没有对应段：逐条报出", () => {
        const withUnreleased = APP.replace("## [Unreleased]\n", "## [Unreleased]\n\n### 新增\n\n- 还没发的\n");
        const {problems} = releaseNotes(input({
            version: "0.13.3",
            appChangelog: withUnreleased,
            packages: [nbUi({changelog: "## [Unreleased]\n"}), nbStory({version: "0.2.4", changelog: null})],
        }));
        expect(problems).toEqual([
            expect.stringContaining("没有 [0.13.3]"),
            expect.stringContaining("[Unreleased] 还有条目"),
            expect.stringContaining("packages/nb-ui/CHANGELOG.md 没有 [0.4.1]"),
            expect.stringContaining("packages/nb-story 的版本从 0.2.3 改成了 0.2.4，却没有 CHANGELOG.md"),
        ]);
    });

    it("preview 的阶段说明；条目的续行缩进成同一项", () => {
        const app = APP.replace("- 修好了 A\n\n## [0.13.1]", "- 修好了 A\n  第二行\n\n## [0.13.1]");
        const {markdown} = releaseNotes(input({stage: "preview", appChangelog: app}));
        expect(markdown.split("\n")[0]).toContain("**preview（预览版）**");
        expect(markdown).toContain("- 修好了 A\n  第二行");
    });
});
