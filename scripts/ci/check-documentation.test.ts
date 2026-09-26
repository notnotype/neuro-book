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
    "docs/specs/TEMPLATE.md",
    "docs/standards/README.md",
    "docs/standards/code/README.md",
    "docs/proposals/README.md",
    "docs/testing/README.md",
    "docs/testing/manual-eval/README.md",
    "packages/neuro-book/docs/adr/README.md",
    "packages/neuro-book/docs/migrations/README.md",
    "packages/neuro-book/docs/runbooks/README.md",
    "packages/neuro-book/docs/research/README.md",
    "packages/neuro-book/docs/archived/README.md",
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
        "## 证据\n\n[Registry](../README.md)",
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

afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("documentation governance gate", () => {
    it("合法目录、ADR 和相对链接通过", async () => {
        const fixture = await createDocumentationFixture({
            "docs/standards/rules.md": "# Rules\n\n[Architecture](../specs/architecture.md)\n",
            "docs/specs/architecture.md": specDocument({capability: "test.architecture"}),
            "packages/neuro-book/docs/adr/0001-first-decision.md": "# ADR 0001：First decision\n",
        }, {
            planned: ["docs/specs/architecture.md"],
        });

        expect(checkDocumentation(fixture.root, fixture.paths)).toEqual({
            failures: [],
            warnings: [],
            checkedFiles: fixture.paths.length,
        });
    });

    it("拒绝 VitePress 旧根、缺页、locale public、tracked staged 与缺失图片", async () => {
        const fixture = await createDocumentationFixture({
            "vitepress/index.md": "# Old root\n",
            "vitepress/en/index.md": "# Old English\n",
            "vitepress/images/old.png": "old",
            "vitepress/.vitepress/staged/index.md": "# generated\n",
            "vitepress/locales/zh-Hans/index.md": "# 中文\n\n![missing](/images/missing.png)\n",
            "vitepress/locales/zh-Hans/only-zh.md": "# 仅中文\n",
            "vitepress/locales/en-US/index.md": "# English\n",
            "vitepress/locales/en-US/only-en.md": "# English only\n",
            "vitepress/locales/en-US/public/asset.txt": "bad",
        });

        const failures = checkDocumentation(fixture.root, fixture.paths).failures;
        expect(failures).toEqual(expect.arrayContaining([
            "VitePress 正文必须位于 locales/<BCP47>：vitepress/index.md",
            "英文正文已迁入 locales/en-US：vitepress/en/index.md",
            "VitePress 静态图片必须位于 public/images：vitepress/images/old.png",
            "VitePress staged 生成物不得跟踪：vitepress/.vitepress/staged/index.md",
            "VitePress locale 内不得包含 public：vitepress/locales/en-US/public/asset.txt",
            "VitePress 英文 locale 缺少对等页面：only-zh.md",
            "VitePress 中文 locale 缺少对等页面：only-en.md",
            "VitePress public 图片不存在：vitepress/locales/zh-Hans/index.md -> /images/missing.png（vitepress/public/images/missing.png）",
        ]));
    });

    it("坏相对链接报告来源和解析目标", async () => {
        const fixture = await createDocumentationFixture({
            "docs/standards/rules.md": "# Rules\n\n[Missing](missing.md)\n",
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("相对链接目标不存在：docs/standards/rules.md -> missing.md（docs/standards/missing.md）");
    });

    it("重复 ADR 编号同时报告两个文件", async () => {
        const fixture = await createDocumentationFixture({
            "packages/neuro-book/docs/adr/0001-first-decision.md": "# ADR 0001：First decision\n",
            "packages/neuro-book/docs/adr/0001-second-decision.md": "# ADR 0001：Second decision\n",
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("ADR 编号重复 0001：packages/neuro-book/docs/adr/0001-first-decision.md, packages/neuro-book/docs/adr/0001-second-decision.md");
    });

    it("拒绝 docs 根层正文和已迁移 Reference", async () => {
        const fixture = await createDocumentationFixture({
            "docs/stray.md": "# Stray\n",
            "reference/workspace/TERMS.md": "# Workspace Terms\n",
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("docs 根层只允许 README.md 和 AGENTS.md：docs/stray.md");
        expect(report.failures).toContain("运行期 Reference 必须位于 packages/neuro-book/assets/reference：reference/workspace/TERMS.md");
    });

    it("拒绝重新创建旧人工评测顶层目录", async () => {
        const fixture = await createDocumentationFixture({
            "docs/manual-eval/README.md": "# Retired manual eval location\n",
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("人工评测已迁入 docs/testing/manual-eval：docs/manual-eval/README.md");
    });

    it("拒绝重新创建平面编码规范", async () => {
        const fixture = await createDocumentationFixture({
            "docs/standards/code.md": "# Retired code standard\n",
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("编码规范已按领域迁入 docs/standards/code/：docs/standards/code.md");
    });


    it("拒绝缺少 frontmatter 或行为章节的 Spec", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/missing-frontmatter.md": "# Missing metadata\n",
            "docs/specs/incomplete.md": specDocument({capability: "test.incomplete", body: "## 目标与非目标\n"}),
        }, {
            planned: ["docs/specs/missing-frontmatter.md", "docs/specs/incomplete.md"],
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

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

        const report = checkDocumentation(fixture.root, fixture.paths);

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

        expect(checkDocumentation(fixture.root, fixture.paths).failures).toEqual([]);
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
                capability: "replace.with-stable-capability",
                owners: ["replace-with-owning-module"],
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

        const report = checkDocumentation(fixture.root, fixture.paths);

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

        const report = checkDocumentation(fixture.root, fixture.paths);

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

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("Behavior Spec 缺少“目标与非目标”章节：docs/specs/editor/code-headings.md");
    });

    it("拒绝重新创建根 Reference 域或索引", async () => {
        const fixture = await createDocumentationFixture({
            "reference/README.md": "# Legacy\n",
            "reference/new-domain/contract.md": "# Contract\n",
        });
        expect(checkDocumentation(fixture.root, fixture.paths).failures).toContain(
            "运行期 Reference 必须位于 packages/neuro-book/assets/reference：reference/README.md",
        );

        expect(checkDocumentation(fixture.root, fixture.paths).failures).toContain(
            "运行期 Reference 必须位于 packages/neuro-book/assets/reference：reference/new-domain/contract.md",
        );
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

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.warnings).toContain("相对链接目标不存在：.agents/works/w00001-test-work/tasks/t03-broken/README.md -> ../../../../../docs/specs/editor/missing.md（docs/specs/editor/missing.md）");
        expect(report.warnings).toContain("新 Task 必须链接具体 Spec，或明确说明“行为合同未变”：.agents/works/w00001-test-work/tasks/t03-broken/README.md");
        expect(report.failures).toEqual([]);
        expect(report.warnings.some((warning) => warning.includes("t01-valid"))).toBe(false);
        expect(report.warnings.some((warning) => warning.includes("t02-no-behavior-change"))).toBe(false);
        expect(report.warnings.some((warning) => warning.includes("00150-legacy-valid"))).toBe(false);
        expect(report.warnings.some((warning) => warning.includes("00151-legacy-broken"))).toBe(false);
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

        const report = checkDocumentation(fixture.root, fixture.paths);

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
            "packages/neuro-book/app/components/common/form/FormInput.vue": "<template><input /></template>\n",
            "packages/neuro-book/app/components/common/SideDetailPanel.vue": "<template><aside /></template>\n",
            "packages/neuro-book/app/components/common/SideDetailPanel.md": "---\n标签: []\n---\n\n# SideDetailPanel\n",
            "packages/neuro-book/app/components/editor-workbench/CodeEditorView.vue": "<template><div /></template>\n",
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toEqual([
            "受管组件缺少同名文档：packages/nb-ui/src/components/controls/Button.vue（应为 packages/nb-ui/src/components/controls/Button.md）",
            "受管组件缺少同名文档：packages/neuro-book/app/components/common/form/FormInput.vue（应为 packages/neuro-book/app/components/common/form/FormInput.md）",
        ]);
        expect(report.warnings).toEqual([]);
    });

    it("受管组件文档拒绝漏标签与未知标签", async () => {
        const fixture = await createDocumentationFixture({
            "packages/nb-ui/src/components/index.ts": [
                'export {default as Button} from "./controls/Button.vue";',
                "",
            ].join("\n"),
            "packages/nb-ui/src/components/controls/Button.vue": "<template><button /></template>\n",
            "packages/nb-ui/src/components/controls/Button.md": "---\n别名: []\n---\n\n# Button\n",
            "packages/neuro-book/app/components/common/SideDetailPanel.vue": "<template><aside /></template>\n",
            "packages/neuro-book/app/components/common/SideDetailPanel.md": "---\n标签: [state:inject, private:secret]\n---\n\n# WrongName\n",
        });

        expect(checkDocumentation(fixture.root, fixture.paths).failures).toEqual([
            "受管组件文档必须声明封闭清单内的「标签」数组：packages/nb-ui/src/components/controls/Button.md",
            "受管组件文档必须声明封闭清单内的「标签」数组：packages/neuro-book/app/components/common/SideDetailPanel.md",
        ]);
    });


    it("图片链接和路径大小写使用受管文件集合校验", async () => {
        const fixture = await createDocumentationFixture({
            "docs/standards/assets.md": "# Assets\n\n![Missing](images/missing.png)\n\n[Wrong case](README.MD)\n",
            "docs/standards/images/present.png": "image",
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("相对链接目标不存在：docs/standards/assets.md -> images/missing.png（docs/standards/images/missing.png）");
        expect(report.failures).toContain("相对链接目标不存在：docs/standards/assets.md -> README.MD（docs/standards/README.MD）");
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

        expect(checkDocumentation(fixture.root, fixture.paths).failures).toEqual([
            "链接锚点不存在：docs/standards/source.md -> target.md#不存在（docs/standards/target.md#不存在）",
            "链接锚点不存在：docs/standards/source.md -> target.md#_10-开发后自检-checklist（docs/standards/target.md#_10-开发后自检-checklist）",
            "链接锚点不存在：docs/standards/source.md -> #missing-local（docs/standards/source.md#missing-local）",
            "链接锚点不存在：docs/standards/source.md -> target.md#title-前置元数据（docs/standards/target.md#title-前置元数据）",
        ]);
    });

    it("VitePress 页面按站点规则校验锚点与站内路由", async () => {
        const quickStart = "# 快速开始\n\n## 配置 AI 模型\n\n## 10. 开发后自检（Checklist）\n";
        const changelog = "# v0.8\n\n### 旧对话的模型引用 {#session-model-refs}\n";
        const fixture = await createDocumentationFixture({
            "vitepress/locales/zh-Hans/quick-start.md": quickStart,
            "vitepress/locales/en-US/quick-start.md": "# Quick start\n\n## Configure an AI model\n",
            "vitepress/locales/zh-Hans/changelog/v0.8.md": changelog,
            "vitepress/locales/en-US/changelog/v0.8.md": changelog,
            "vitepress/locales/zh-Hans/index.md": [
                "# 首页",
                "",
                "[a](./quick-start#配置-ai-模型) [b](/quick-start#_10-开发后自检-checklist) [c](./changelog/v0.8#session-model-refs)",
                "[d](/en/quick-start.md#configure-an-ai-model) [e](/quick-start)",
                "[f](/quick-start#10-开发后自检checklist) [g](/missing#x)",
                "",
            ].join("\n"),
            "vitepress/locales/en-US/index.md": "# Home\n\n[a](/en/quick-start#missing)\n",
        });

        expect(checkDocumentation(fixture.root, fixture.paths).failures).toEqual([
            "链接锚点不存在：vitepress/locales/en-US/index.md -> /en/quick-start#missing（vitepress/locales/en-US/quick-start.md#missing）",
            "链接锚点不存在：vitepress/locales/zh-Hans/index.md -> /quick-start#10-开发后自检checklist（vitepress/locales/zh-Hans/quick-start.md#10-开发后自检checklist）",
            "站内链接目标不存在：vitepress/locales/zh-Hans/index.md -> /missing#x",
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
