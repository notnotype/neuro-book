import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {checkDocumentation} from "#scripts/ci/check-documentation";

const fixtureRoots: string[] = [];
const REQUIRED_INDEXES = [
    "docs/README.md",
    "docs/AGENTS.md",
    "docs/specs/README.md",
    "docs/specs/AGENTS.md",
    "docs/standards/README.md",
    "docs/standards/code/README.md",
    "docs/proposals/README.md",
    "docs/testing/README.md",
    "docs/adr/README.md",
    "docs/research/README.md",
    "docs/archived/README.md",
] as const;

const SPEC_REGISTRY = `# NeuroBook 规范编程

## 已实现规范

| 功能域 | 当前规范 | 说明 |
|---|---|---|

## 待实现规范

| 功能域 | 目标规范 | 说明 |
|---|---|---|

## 冻结过渡规范

| 功能域 | 当前规范 | 固定目标 |
|---|---|---|
`;

function specDocument(options: {capability: string; status?: "planned" | "implemented"; body?: string; owners?: readonly string[]}): string {
    const status = options.status ?? "planned";
    const requiredBody = [
        ...[
            "目标与非目标",
            "术语与参与者",
            "输入与前置条件",
            "输出与可观察行为",
            "状态与转换",
            "副作用与数据",
            "失败与恢复",
            "边界与兼容",
            "验收与 Smoke",
        ].map((heading) => `## ${heading}\n\n有效说明。`),
        ...(status === "implemented" ? ["## 实现合同\n\n有效实现合同。"] : []),
        "## 证据\n\n- 批准依据：[Registry](../README.md)",
    ].join("\n\n");
    return `---
schema: nbook.spec/v1
kind: behavior
status: ${status}
capability: ${options.capability}
owners:
${(options.owners ?? ["test-module"]).map((owner) => `  - ${owner}`).join("\n")}
---

# Test Spec

${options.body ?? requiredBody}
`;
}

function adrDocument(number: string, title: string, frontmatter = "schema: nbook.adr/v1\nstatus: accepted\ndecided: 2026-10-07\nsuperseded-by: null"): string {
    return `---\n${frontmatter}\n---\n\n# ADR ${number}：${title}\n`;
}

function proposalDocument(frontmatter: string): string {
    return `---\nschema: nbook.proposal/v1\n${frontmatter}\n---\n\n# Proposal\n`;
}

/** behavior Spec 的九个固定章节都有内容；`overrides` 替换其中几节的正文。 */
function behaviorBody(overrides: Readonly<Record<string, string>>, evidence: string): string {
    return [
        ...["目标与非目标", "术语与参与者", "输入与前置条件", "输出与可观察行为", "状态与转换", "副作用与数据", "失败与恢复", "边界与兼容", "验收与 Smoke"]
            .map((heading) => `## ${heading}\n\n${overrides[heading] ?? "有效说明。"}`),
        `## 证据\n\n${evidence}`,
    ].join("\n\n");
}

afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("documentation governance gate", () => {
    it("合法目录、ADR 和相对链接通过", async () => {
        const fixture = await createDocumentationFixture({
            "docs/standards/rules.md": "# Rules\n\n[Architecture](../specs/architecture.md)\n",
            "docs/specs/architecture.md": specDocument({capability: "test.architecture"}),
            "docs/adr/0001-first-decision.md": adrDocument("0001", "First decision"),
        }, {
            planned: ["docs/specs/architecture.md"],
        });

        expect(checkDocumentation(fixture.root, {paths: fixture.paths})).toEqual({
            failures: [],
            warnings: [],
            checkedFiles: fixture.paths.length,
        });
    });

    it("坏相对链接报告来源和解析目标", async () => {
        const fixture = await createDocumentationFixture({
            "docs/standards/rules.md": "# Rules\n\n[Missing](missing.md)\n",
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toContain("相对链接目标不存在：docs/standards/rules.md -> missing.md（docs/standards/missing.md）");
    });

    it("重复 ADR 编号同时报告两个文件", async () => {
        const fixture = await createDocumentationFixture({
            "docs/adr/0001-first-decision.md": adrDocument("0001", "First decision"),
            "docs/adr/0001-second-decision.md": adrDocument("0001", "Second decision"),
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toContain("ADR 编号重复 0001：docs/adr/0001-first-decision.md, docs/adr/0001-second-decision.md");
    });

    it("拒绝 docs 根层正文", async () => {
        const fixture = await createDocumentationFixture({
            "docs/stray.md": "# Stray\n",
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toContain("docs 根层只允许 README.md 和 AGENTS.md：docs/stray.md");
    });


    it("拒绝缺少 frontmatter 或行为章节的 Spec", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/missing-frontmatter.md": "# Missing metadata\n",
            "docs/specs/incomplete.md": specDocument({capability: "test.incomplete", body: "## 目标与非目标\n"}),
        }, {
            planned: ["docs/specs/missing-frontmatter.md", "docs/specs/incomplete.md"],
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toContain("Spec 缺少 YAML frontmatter：docs/specs/missing-frontmatter.md");
        expect(report.failures).toContain("Behavior Spec 缺少“输入与前置条件”章节：docs/specs/incomplete.md");
    });

    it("拒绝成熟度登记错位和重复 capability", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/first.md": specDocument({capability: "test.duplicate", status: "implemented", body: [
                "## 目标与非目标",
                "## 术语与参与者",
                "## 输入与前置条件",
                "## 输出与可观察行为",
                "## 状态与转换",
                "## 副作用与数据",
                "## 失败与恢复",
                "## 边界与兼容",
                "## 验收与 Smoke",
                "## 实现合同",
                "## 证据",
            ].join("\n\n")}),
            "docs/specs/second.md": specDocument({capability: "test.duplicate"}),
        }, {
            planned: ["docs/specs/first.md", "docs/specs/second.md"],
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toContain("Spec 未登记在“已实现规范”：docs/specs/first.md");
        expect(report.failures).toContain("Spec 登记的成熟度与 frontmatter 不一致：docs/specs/first.md（implemented）");
        expect(report.failures).toContain("Spec capability 重复 test.duplicate：docs/specs/first.md, docs/specs/second.md");
    });

    it("允许模块 README、AGENTS 和省略 md 的具体 Spec 登记", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/editor/README.md": "# Editor Specs\n",
            "docs/specs/editor/AGENTS.md": "# Editor Spec Agent\n",
            "docs/specs/editor/html.md": specDocument({capability: "editor.html"}),
        }, {
            planned: ["docs/specs/editor/html"],
        });

        expect(checkDocumentation(fixture.root, {paths: fixture.paths}).failures).toEqual([]);
    });

    it("拒绝空壳章节、模板占位值和缺失分类证据", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/editor/empty.md": specDocument({
                capability: "editor.empty",
                body: [
                    ...["目标与非目标", "术语与参与者", "输入与前置条件", "输出与可观察行为", "状态与转换", "副作用与数据", "失败与恢复", "边界与兼容", "验收与 Smoke"].map((heading) => `## ${heading}\n\nTODO`),
                    "## 证据\n\n待补",
                ].join("\n\n"),
            }),
            "docs/specs/editor/template-copy.md": specDocument({
                capability: "<稳定的点分标识>",
                owners: ["<负责行为与数据边界的模块或插件>"],
            }),
            "docs/specs/editor/fake-implemented.md": specDocument({
                capability: "editor.fake-implemented",
                status: "implemented",
                body: [
                    ...["目标与非目标", "术语与参与者", "输入与前置条件", "输出与可观察行为", "状态与转换", "副作用与数据", "失败与恢复", "边界与兼容", "验收与 Smoke"].map((heading) => `## ${heading}\n\n有效说明。`),
                    "## 实现合同\n\n尚未实现",
                    "## 证据\n\n只有口头说明。",
                ].join("\n\n"),
            }),
        }, {
            planned: ["docs/specs/editor/empty.md", "docs/specs/editor/template-copy.md"],
            implemented: ["docs/specs/editor/fake-implemented.md"],
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toContain("Behavior Spec 的“目标与非目标”章节没有实义内容：docs/specs/editor/empty.md");
        expect(report.failures).toContain("Planned Spec 的“证据”章节没有实义内容：docs/specs/editor/empty.md");
        expect(report.failures).toContain("Spec capability 仍是模板占位值：docs/specs/editor/template-copy.md");
        expect(report.failures).toContain("Spec owners 仍包含模板占位值：docs/specs/editor/template-copy.md");
        expect(report.failures).toContain("Implemented Spec 的“实现合同”章节没有实义内容：docs/specs/editor/fake-implemented.md");
        expect(report.failures).toContain("Implemented Spec 的“证据”缺少「实现入口：」标签行：docs/specs/editor/fake-implemented.md");
        expect(report.failures).toContain("Implemented Spec 的“证据”缺少「合同测试：」标签行：docs/specs/editor/fake-implemented.md");
        expect(report.failures).toContain("Implemented Spec 的“证据”缺少「Smoke：」标签行：docs/specs/editor/fake-implemented.md");
    });

    it("拒绝注册目录、治理文件、重复行和反斜杠链接", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/editor/README.md": "# Editor Specs\n",
            "docs/specs/editor/html.md": specDocument({capability: "editor.html"}),
            "docs/standards/windows-link.md": "# Link\n\n[Spec](..\\specs\\editor\\html.md)\n",
        }, {
            planned: ["docs/specs/editor/html.md", "docs/specs/editor/html.md", "docs/specs/editor/README.md", "docs/specs/editor/"],
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toContain("“待实现规范”重复登记 Spec：docs/specs/editor/html.md");
        expect(report.failures).toContain("“待实现规范”只能登记具体 Spec 文件：docs/specs/README.md -> ../../docs/specs/editor/README.md");
        expect(report.failures).toContain("“待实现规范”只能登记具体 Spec 文件：docs/specs/README.md -> ../../docs/specs/editor/");
        expect(report.failures).toContain("相对链接必须使用正斜杠：docs/standards/windows-link.md -> ..\\specs\\editor\\html.md");
    });

    it("代码块标题不能冒充 Behavior 章节", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/editor/code-headings.md": specDocument({
                capability: "editor.code-headings",
                body: "```markdown\n## 目标与非目标\n## 术语与参与者\n## 输入与前置条件\n## 输出与可观察行为\n## 状态与转换\n## 副作用与数据\n## 失败与恢复\n## 边界与兼容\n## 验收与 Smoke\n## 证据\n```\n",
            }),
        }, {
            planned: ["docs/specs/editor/code-headings.md"],
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toContain("Behavior Spec 缺少“目标与非目标”章节：docs/specs/editor/code-headings.md");
    });

    it("只把 current v2 Task 当 Task 检查，legacy v1 不再进门禁", async () => {
        const fixture = await createDocumentationFixture({
            ".agents/works/w00001-test-work/tasks/t01-valid/README.md": "---\nschema: nbook.task/v2\ntaskId: t01-valid\n---\n\n# Task\n\n[Spec](../../../../../docs/specs/editor/html.md)\n",
            ".agents/works/w00001-test-work/tasks/t02-no-behavior-change/README.md": "---\nschema: nbook.task/v2\ntaskId: t02-no-behavior-change\n---\n\n# Task\n\n本任务行为合同未变。\n",
            ".agents/works/w00001-test-work/tasks/t03-broken/README.md": "---\nschema: nbook.task/v2\ntaskId: t03-broken\n---\n\n# Task\n\n[Spec](../../../../../docs/specs/editor/missing.md)\n",
            ".agents/tasks/00150-legacy-valid/README.md": "---\nschema: nbook.task/v1\n---\n\n# Task\n\n[Spec](../../../docs/specs/editor/html.md)\n",
            ".agents/tasks/00151-legacy-broken/README.md": "---\nschema: nbook.task/v1\n---\n\n# Task\n\n[Spec](../../../docs/specs/editor/missing.md)\n",
            "docs/specs/editor/html.md": specDocument({capability: "editor.html"}),
        }, {
            planned: ["docs/specs/editor/html.md"],
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.warnings).toContain("相对链接目标不存在：.agents/works/w00001-test-work/tasks/t03-broken/README.md -> ../../../../../docs/specs/editor/missing.md（docs/specs/editor/missing.md）");
        expect(report.warnings).toContain("新 Task 必须链接具体 Spec，或明确说明“行为合同未变”：.agents/works/w00001-test-work/tasks/t03-broken/README.md");
        expect(report.failures).toEqual([]);
        expect(report.warnings.some((warning) => warning.includes("t01-valid"))).toBe(false);
        expect(report.warnings.some((warning) => warning.includes("t02-no-behavior-change"))).toBe(false);
        expect(report.warnings.some((warning) => warning.includes("00150-legacy-valid"))).toBe(false);
        expect(report.warnings.some((warning) => warning.includes("00151-legacy-broken"))).toBe(false);
    });

    it("给出改动范围时只逐条列出范围内文件的警告，其余按类别合成一行计数", async () => {
        const touched = ".agents/works/w00001-test-work/tasks/t01-touched/README.md";
        const fixture = await createDocumentationFixture({
            [touched]: "---\nschema: nbook.task/v2\ntaskId: t01-touched\n---\n\n# Task\n\n[Gone](missing.md)\n",
            ".agents/works/w00001-test-work/tasks/t02-stock/README.md": "---\nschema: nbook.task/v2\ntaskId: t02-stock\n---\n\n# Task\n\n[Gone](missing.md)\n",
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths, warningScope: new Set([touched])});

        expect(report.warnings).toEqual([
            `相对链接目标不存在：${touched} -> missing.md（.agents/works/w00001-test-work/tasks/t01-touched/missing.md）`,
            `新 Task 必须链接具体 Spec，或明确说明“行为合同未变”：${touched}`,
        ]);
        expect(report.stockWarnings).toBe("另有 2 条警告不在本次改动范围（相对链接目标不存在 1、新 Task 必须链接具体 Spec，或明确说明“行为合同未变” 1），加 --all 逐条列出");
        expect(checkDocumentation(fixture.root, {paths: fixture.paths}).warnings).toHaveLength(4);
    });

    it("implemented Spec 的证据必须给出实现入口、合同测试与 Smoke 固定标签行", async () => {
        const headings = ["目标与非目标", "术语与参与者", "输入与前置条件", "输出与可观察行为", "状态与转换", "副作用与数据", "失败与恢复", "边界与兼容", "验收与 Smoke"];
        const implemented = (evidence: string): string => [
            ...headings.map((heading) => `## ${heading}\n\n有效说明。`),
            "## 实现合同\n\n有效实现合同。",
            `## 证据\n\n${evidence}`,
        ].join("\n\n");
        const fixture = await createDocumentationFixture({
            "docs/specs/editor/valid.md": specDocument({
                capability: "editor.valid",
                status: "implemented",
                body: implemented([
                    "- 实现入口：[`example.ts`](../../../app/example.ts)",
                    "- 合同测试：[`example.test.ts`](../../../app/example.test.ts)",
                    "- Smoke：[`example-smoke.ts`](../../../scripts/smoke/example-smoke.ts)",
                ].join("\n")),
            }),
            "docs/specs/editor/incomplete.md": specDocument({
                capability: "editor.incomplete",
                status: "implemented",
                body: implemented([
                    "- 实现入口：[`example.ts`](../../../app/example.ts)",
                    "- 合同测试：[`example.test.ts`](../../../app/example.test.ts)",
                ].join("\n")),
            }),
            "docs/specs/editor/mistyped.md": specDocument({
                capability: "editor.mistyped",
                status: "implemented",
                body: implemented([
                    "- 实现入口：[`components.md`](../../../docs/standards/code/components.md)",
                    "- 合同测试：[`example.ts`](../../../app/example.ts)",
                    "- Smoke：[`cli.ts`](../../../scripts/smoke/missing-cli.ts)",
                ].join("\n")),
            }),
            "docs/specs/editor/no-reason.md": specDocument({
                capability: "editor.no-reason",
                status: "implemented",
                body: implemented([
                    "- 实现入口：[`example.ts`](../../../app/example.ts)",
                    "- 合同测试：[`example.test.ts`](../../../app/example.test.ts)",
                    "- Smoke：不适用",
                ].join("\n")),
            }),
            "docs/specs/editor/doc-smoke.md": specDocument({
                capability: "editor.doc-smoke",
                status: "implemented",
                body: implemented([
                    "- 实现入口：[`example.ts`](../../../app/example.ts)",
                    "- 合同测试：[`example.test.ts`](../../../app/example.test.ts)",
                    "- Smoke：[`components.md`](../../../docs/standards/code/components.md)",
                ].join("\n")),
            }),
            "app/example.ts": "export const example = true;\n",
            "app/example.test.ts": "export const suite = true;\n",
            "scripts/smoke/example-smoke.ts": "export const smoke = true;\n",
        }, {
            implemented: [
                "docs/specs/editor/valid.md",
                "docs/specs/editor/incomplete.md",
                "docs/specs/editor/mistyped.md",
                "docs/specs/editor/no-reason.md",
                "docs/specs/editor/doc-smoke.md",
            ],
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toContain("Implemented Spec 的“证据”缺少「Smoke：」标签行：docs/specs/editor/incomplete.md");
        expect(report.failures).toContain("Implemented Spec 的「实现入口：」必须链接存在的源码文件（非 .md）：docs/specs/editor/mistyped.md");
        expect(report.failures).toContain("Implemented Spec 的「合同测试：」必须链接存在的测试文件：docs/specs/editor/mistyped.md");
        expect(report.failures).toContain("Implemented Spec 的「Smoke：」必须链接存在的可执行入口，或写「不适用——<理由>」：docs/specs/editor/mistyped.md");
        expect(report.failures).toContain("Implemented Spec 的「Smoke：」必须链接存在的可执行入口，或写「不适用——<理由>」：docs/specs/editor/no-reason.md");
        expect(report.failures).toContain("Implemented Spec 的「Smoke：」必须链接存在的可执行入口，或写「不适用——<理由>」：docs/specs/editor/doc-smoke.md");
        expect(report.failures.some((failure) => failure.includes("editor/valid.md"))).toBe(false);
    });

    it("受管组件缺少同名文档时阻断，且忽略未导出组件", async () => {
        const fixture = await createDocumentationFixture({
            "packages/nb-ui/src/components/index.ts": [
                'export {default as Button} from "./controls/Button.vue";',
                'export {default as DialogWindow} from "./feedback/DialogWindow.vue";',
                "",
            ].join("\n"),
            "packages/nb-ui/src/components/controls/Button.vue": "<template><button /></template>\n",
            "packages/nb-ui/src/components/feedback/DialogWindow.vue": "<template><div /></template>\n",
            "packages/nb-ui/src/components/feedback/DialogWindow.md": "---\n标签: []\n---\n\n# DialogWindow\n",
            "packages/nb-ui/src/components/feedback/ContextMenuPanel.vue": "<template><div /></template>\n",
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toEqual([
            "受管组件缺少同名文档：packages/nb-ui/src/components/controls/Button.vue（应为 packages/nb-ui/src/components/controls/Button.md）",
        ]);
        expect(report.warnings).toEqual([]);
    });

    it("受管组件文档拒绝漏标签与未知标签", async () => {
        const fixture = await createDocumentationFixture({
            "packages/nb-ui/src/components/index.ts": [
                'export {default as Button} from "./controls/Button.vue";',
                'export {default as Toggle} from "./controls/Toggle.vue";',
                "",
            ].join("\n"),
            "packages/nb-ui/src/components/controls/Button.vue": "<template><button /></template>\n",
            "packages/nb-ui/src/components/controls/Button.md": "---\n别名: []\n---\n\n# Button\n",
            "packages/nb-ui/src/components/controls/Toggle.vue": "<template><button /></template>\n",
            "packages/nb-ui/src/components/controls/Toggle.md": "---\n标签: [state:inject, private:secret]\n---\n\n# Toggle\n",
        });

        expect(checkDocumentation(fixture.root, {paths: fixture.paths}).failures).toEqual([
            "受管组件文档必须声明封闭清单内的「标签」数组：packages/nb-ui/src/components/controls/Button.md",
            "受管组件文档必须声明封闭清单内的「标签」数组：packages/nb-ui/src/components/controls/Toggle.md",
        ]);
    });


    it("图片链接和路径大小写使用受管文件集合校验", async () => {
        const fixture = await createDocumentationFixture({
            "docs/standards/assets.md": "# Assets\n\n![Missing](images/missing.png)\n\n[Wrong case](README.MD)\n",
            "docs/standards/images/present.png": "image",
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toContain("相对链接目标不存在：docs/standards/assets.md -> images/missing.png（docs/standards/images/missing.png）");
        expect(report.failures).toContain("相对链接目标不存在：docs/standards/assets.md -> README.MD（docs/standards/README.MD）");
    });

    it("提案与 ADR 的 frontmatter：status 取值、accepted 与 rejected 要有 decided、superseded 要有 superseded-by", async () => {
        const fixture = await createDocumentationFixture({
            "docs/proposals/README.md": [
                "# 项目提案",
                "",
                "- [Valid](valid.md)",
                "- [Missing](missing-frontmatter.md)",
                "- [Bad status](bad-status.md)",
                "- [Undecided](undecided.md)",
                "",
            ].join("\n"),
            "docs/proposals/valid.md": proposalDocument("status: accepted\ncreated: 2026-10-01\ndecided: 2026-10-07"),
            "docs/proposals/missing-frontmatter.md": "# Proposal\n\n状态：accepted\n",
            "docs/proposals/bad-status.md": proposalDocument("status: approved"),
            "docs/proposals/undecided.md": proposalDocument("status: accepted\ndecided: null"),
            "docs/adr/0001-valid.md": adrDocument("0001", "Valid"),
            "docs/adr/0002-missing.md": "# ADR 0002：Missing\n\n- 状态：Accepted\n",
            "docs/adr/0003-superseded.md": adrDocument("0003", "Superseded", "schema: nbook.adr/v1\nstatus: superseded\ndecided: 2026-10-07\nsuperseded-by: null"),
            "docs/adr/0004-wrong-schema.md": adrDocument("0004", "Wrong schema", "schema: nbook.proposal/v1\nstatus: accepted\ndecided: 2026-10-07"),
            "docs/adr/0005-undecided.md": adrDocument("0005", "Undecided", "schema: nbook.adr/v1\nstatus: accepted"),
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toContain("提案缺少 YAML frontmatter：docs/proposals/missing-frontmatter.md");
        expect(report.failures).toContain("提案的 status 必须是 draft、reviewing、accepted、rejected、superseded 之一：docs/proposals/bad-status.md");
        expect(report.failures).toContain("提案的 status 为 accepted 时 decided 必须是 YYYY-MM-DD 日期：docs/proposals/undecided.md");
        expect(report.failures).toContain("ADR 缺少 YAML frontmatter：docs/adr/0002-missing.md");
        expect(report.failures).toContain("ADR 的 status 为 superseded 时必须填写 superseded-by：docs/adr/0003-superseded.md");
        expect(report.failures).toContain("ADR 的 schema 必须是 nbook.adr/v1：docs/adr/0004-wrong-schema.md");
        expect(report.failures).toContain("ADR 的 status 为 accepted 时 decided 必须是 YYYY-MM-DD 日期：docs/adr/0005-undecided.md");
        expect(report.failures.some((failure) => failure.includes("docs/proposals/valid.md") || failure.includes("docs/adr/0001-valid.md"))).toBe(false);
    });

    it("draft、reviewing、accepted 的提案必须登记在索引里；rejected、superseded 的不留在活跃目录", async () => {
        const fixture = await createDocumentationFixture({
            "docs/proposals/README.md": "# 项目提案\n\n- [Registered](registered.md)\n- [Rejected](rejected.md)\n",
            "docs/proposals/registered.md": proposalDocument("status: reviewing\ndecided: null"),
            "docs/proposals/unregistered.md": proposalDocument("status: draft\ndecided: null"),
            "docs/proposals/rejected.md": proposalDocument("status: rejected\ndecided: 2026-10-07"),
            "docs/proposals/superseded.md": proposalDocument("status: superseded\ndecided: 2026-10-01\nsuperseded-by: docs/proposals/registered.md"),
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toEqual([
            "rejected 的提案应移入 docs/archived/proposals/：docs/proposals/rejected.md",
            "superseded 的提案应移入 docs/archived/proposals/：docs/proposals/superseded.md",
            "提案未登记在 docs/proposals/README.md：docs/proposals/unregistered.md（draft）",
        ]);
    });

    it("Spec 正文的 Task 引用与“证据”里的叙述只给警告；“证据”的批准依据可以提到 Task", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/editor/history.md": specDocument({
                capability: "editor.history",
                body: behaviorBody(
                    {"输出与可观察行为": "1. **保存**：写入后返回新 revision（随 t55）。", "边界与兼容": "实现见 w00017。"},
                    "- 批准依据：开发者在 t55 计划中确认\n- 实现进展：随 t54 完成。",
                ),
            }),
            "docs/specs/editor/clean.md": specDocument({
                capability: "editor.clean",
                body: behaviorBody({}, "- 批准依据：开发者在 t55 计划中确认"),
            }),
        }, {
            planned: ["docs/specs/editor/history.md", "docs/specs/editor/clean.md"],
        });

        const report = checkDocumentation(fixture.root, {paths: fixture.paths});

        expect(report.failures).toEqual([]);
        expect(report.warnings).toEqual([
            "Spec 的“证据”一节有固定标签与批准依据之外的行：docs/specs/editor/history.md（1 行）",
            "Spec 正文引用了 Task（只能出现在“证据”一节）：docs/specs/editor/history.md（t55、w00017）",
        ]);
    });

    it("仓库文档按 GitHub 规则校验锚点", async () => {
        const fixture = await createDocumentationFixture({
            "docs/standards/target.md": [
                "---",
                "title: 前置元数据",
                "---",
                "",
                "# Target",
                "",
                "## 八、踩过的坑",
                "",
                "## 10. 开发后自检（Checklist）",
                "",
                "## 重复",
                "",
                "## 重复",
                "",
                "<a id=\"legacy-anchor\"></a>",
                "",
            ].join("\n"),
            "docs/standards/source.md": [
                "# Source",
                "",
                "## 本页",
                "",
                "[a](target.md#八踩过的坑) [b](target.md#10-开发后自检checklist) [c](target.md#重复-1)",
                "[d](target.md#legacy-anchor) [e](#本页) [f](target.md)",
                "[g](target.md#不存在) [h](target.md#_10-开发后自检-checklist) [i](#missing-local) [j](target.md#title-前置元数据)",
                "",
            ].join("\n"),
        });

        expect(checkDocumentation(fixture.root, {paths: fixture.paths}).failures).toEqual([
            "链接锚点不存在：docs/standards/source.md -> target.md#不存在（docs/standards/target.md#不存在）",
            "链接锚点不存在：docs/standards/source.md -> target.md#_10-开发后自检-checklist（docs/standards/target.md#_10-开发后自检-checklist）",
            "链接锚点不存在：docs/standards/source.md -> #missing-local（docs/standards/source.md#missing-local）",
            "链接锚点不存在：docs/standards/source.md -> target.md#title-前置元数据（docs/standards/target.md#title-前置元数据）",
        ]);
    });
});

async function createDocumentationFixture(
    extraFiles: Readonly<Record<string, string>>,
    registered: {planned?: readonly string[]; implemented?: readonly string[]; frozen?: readonly string[]} = {},
): Promise<{root: string; paths: string[]}> {
    const root = await createTestTmpRoot("documentation-governance", "documentation-governance-test");
    fixtureRoots.push(root);
    const files: Record<string, string> = Object.fromEntries(REQUIRED_INDEXES.map((path) => [path, `# ${path}\n`]));
    const implementedRows = (registered.implemented ?? []).map((path) => `| Test | [Spec](../../${path}) | Test |`).join("\n");
    const plannedRows = (registered.planned ?? []).map((path) => `| Test | [Spec](../../${path}) | Test |`).join("\n");
    const frozenRows = (registered.frozen ?? []).map((path) => `| Test | [Reference](../../${path}) | docs/specs/test/ |`).join("\n");
    files["docs/specs/README.md"] = SPEC_REGISTRY
        .replace("|---|---|---|\n\n## 待实现规范", `|---|---|---|\n${implementedRows}\n\n## 待实现规范`)
        .replace("|---|---|---|\n\n## 冻结过渡规范", `|---|---|---|\n${plannedRows}\n\n## 冻结过渡规范`)
        .replace(/(## 冻结过渡规范\n\n\| 功能域 \| 当前规范 \| 固定目标 \|\n\|---\|---\|---\|)/u, `$1\n${frozenRows}`);
    Object.assign(files, extraFiles);
    await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
        const absolutePath = join(root, relativePath);
        await mkdir(dirname(absolutePath), {recursive: true});
        await writeFile(absolutePath, content, "utf8");
    }));
    return {root, paths: Object.keys(files).sort()};
}
