import {describe, expect, it} from "bun:test";

import type {ComponentSurface} from "./api-components";
import {compareReport, formatEntry, parseReport, rewritePaths, toolVersions, unreleased} from "./api-report";
import type {EntrySurface} from "./api-surface";

const HEADER = ["// tool typescript 6.0.3 (report)", "// tool vue 3.5.0"];

const entry: EntrySurface = {
    entry: "vue",
    names: [
        {name: "Box", kind: "component", stability: "experimental", deprecated: false, references: ["Extent"], unexportedReferences: [], declarations: []},
        {name: "size", kind: "function", stability: "stable", deprecated: true, references: ["Extent"], unexportedReferences: ["Hidden"], declarations: ["declare function size(): Extent;"]},
    ],
    unexported: [{name: "Hidden", kind: "type", references: ["Extent"], unexportedReferences: [], declarations: ["type Hidden = 1;"]}],
};
const box: ComponentSurface = {props: ["extent: Extent"], attrs: ["→ 根元素"], events: ["change(value: number)"], slots: [], exposed: [], propNames: ["extent"]};

const report = (overrides: {header?: readonly string[]; declaration?: string; stability?: "stable" | "experimental"} = {}) =>
    formatEntry(
        "./vue",
        {...entry, names: [entry.names[0]!, {...entry.names[1]!, stability: overrides.stability ?? "stable", declarations: [overrides.declaration ?? "declare function size(): Extent;"]}]},
        new Map([["Box", box]]),
        overrides.header ?? HEADER,
    );

describe("api-report：格式", () => {
    it("头、每个名字一段（标注、种类、弃用、引用、声明或组件五段）、没导出的声明一节", () => {
        expect(report()).toBe(
            [
                "// API 报告：@notnotype/nb-layout/vue（bun run api:report 生成，不手改）",
                ...HEADER,
                "",
                "### experimental component Box",
                "引用：Extent",
                "props:",
                "  extent: Extent",
                "attrs:",
                "  → 根元素",
                "events:",
                "  change(value: number)",
                "",
                "### stable function size @deprecated",
                "引用：Extent",
                "引用（没导出）：Hidden",
                "declare function size(): Extent;",
                "",
                "## 由公开名字引到、没有导出的声明",
                "",
                "### type Hidden",
                "引用：Extent",
                "type Hidden = 1;",
                "",
            ].join("\n"),
        );
    });

    it("拆回头与按名字的段；没导出的那一节不算名字", () => {
        const parsed = parseReport(report());
        expect(parsed.header).toEqual(HEADER);
        expect([...parsed.segments.keys()]).toEqual(["Box", "size"]);
        expect(parsed.segments.get("size")).toEqual({stability: "stable", text: "### stable function size @deprecated\n引用：Extent\n引用（没导出）：Hidden\ndeclare function size(): Extent;"});
    });

    it("绝对路径换成包名或去掉包目录：换一个检出位置报告不变", () => {
        const at = (root: string) => rewritePaths(`a: import("${root}/node_modules/vue/dist/vue").Ref; b: "${root}/packages/nb-layout/src/x"`, [`${root}/packages/nb-layout`, root]);
        expect(at("/home/a/repo")).toBe(`a: import("vue/dist/vue").Ref; b: "src/x"`);
        expect(at("/tmp/other")).toBe(at("/home/a/repo"));
    });

    it("头里的工具版本各自解析，七行", () => {
        const lines = toolVersions();
        expect(lines).toHaveLength(7);
        for (const line of lines) expect(line).toMatch(/^\/\/ tool [\w-]+ \d+\.\d+\.\d+/u);
    });
});

describe("api-report：比对", () => {
    const changelog = (text: string) => `# 变更记录\n\n## [Unreleased]\n\n${text}\n\n## [0.1.0]\n\n- 写过 \`size\`。\n`;

    it("相同：没有错误", () => {
        expect(compareReport("api/vue.api.txt", report(), report(), changelog(""))).toEqual({headerChanged: false, changedNames: [], errors: [], hints: []});
    });

    it("只有头不同：不算公开面变了，提示单独提交", () => {
        const result = compareReport("api/vue.api.txt", report(), report({header: ["// tool typescript 6.1.0 (report)", "// tool vue 3.5.0"]}), changelog(""));
        expect(result.errors).toEqual([]);
        expect(result.headerChanged).toBe(true);
        expect(result.hints).toEqual(["api/vue.api.txt: toolchain versions changed; the regenerated report belongs in its own commit"]);
    });

    it("`@experimental` 名字变了：失败，只要求重跑 api:report", () => {
        const before = report({stability: "experimental"});
        const result = compareReport("api/vue.api.txt", before, report({stability: "experimental", declaration: "declare function size(scale: number): Extent;"}), changelog(""));
        expect(result.changedNames).toEqual(["size"]);
        expect(result.errors).toEqual(["api/vue.api.txt: public surface changed (size); review, then run bun run api:report"]);
    });

    it("`@stable` 名字变了：另要求 [Unreleased] 里有提到它的记录；旧版本里的记录不算", () => {
        const after = report({declaration: "declare function size(scale: number): Extent;"});
        expect(compareReport("api/vue.api.txt", report(), after, changelog("")).errors).toContain("api/vue.api.txt: @stable size changed; CHANGELOG.md [Unreleased] must have an entry naming `size`");
        expect(compareReport("api/vue.api.txt", report(), after, changelog("- 不兼容：`size` 多了参数。")).errors).toEqual(["api/vue.api.txt: public surface changed (size); review, then run bun run api:report"]);
    });

    it("`@stable` 降级成 `@experimental` 也算 `@stable` 名字的改动", () => {
        const result = compareReport("api/vue.api.txt", report(), report({stability: "experimental"}), changelog(""));
        expect(result.errors).toContain("api/vue.api.txt: @stable size changed; CHANGELOG.md [Unreleased] must have an entry naming `size`");
    });

    it("快照格式的名字变了：提示核对工作台层的版本与迁移", () => {
        const snapshot = (body: string) => `${HEADER.join("\n")}\n\n### experimental type GridSnapshot\n${body}\n`;
        expect(compareReport("api/index.api.txt", snapshot("type GridSnapshot = 1;"), snapshot("type GridSnapshot = 2;"), changelog("")).hints).toEqual([
            "api/index.api.txt: GridSnapshot changed; check the workbench layer's LAYOUT_DOC_VERSION and its migration (ADR 0054 item 10)",
        ]);
    });

    it("还没有报告：失败并提示生成", () => {
        expect(compareReport("api/vue.api.txt", null, report(), changelog("")).errors).toEqual(["api/vue.api.txt: missing; run bun run api:report"]);
    });

    it("[Unreleased] 只取到下一个版本标题为止", () => {
        expect(unreleased(changelog("- 新"))).toBe("## [Unreleased]\n\n- 新\n");
        expect(unreleased("# 无\n")).toBe("");
    });
});
