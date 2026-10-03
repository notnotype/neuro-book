import {expect, test} from "vitest";
import {existsSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {WORLD_ISSUE_CATALOG} from "nbook/server/world-engine/world-issue-catalog";

const repositoryRoot = resolve(import.meta.dirname, "..", "..", "..", "..");
const expectedCodes = Object.keys(WORLD_ISSUE_CATALOG).sort();

test("WorldIssue catalog 覆盖所有稳定 code 且字段完整", () => {
    expect(Object.keys(WORLD_ISSUE_CATALOG).sort()).toEqual(expectedCodes);
    for (const item of Object.values(WORLD_ISSUE_CATALOG)) {
        expect(item.code).toBeTruthy();
        expect(item.label).toMatch(/^(E|A)\d$/);
        expect(["error", "advisory"]).toContain(item.severity);
        expect(item.persistence.trim().length).toBeGreaterThan(0);
        expect(item.source.trim().length).toBeGreaterThan(0);
        expect(item.title.trim().length).toBeGreaterThan(0);
        expect(item.explanation.whatHappened.trim().length).toBeGreaterThan(0);
        expect(item.explanation.whyItMatters.trim().length).toBeGreaterThan(0);
        expect(item.explanation.suggestedAction.trim().length).toBeGreaterThan(0);
    }
});

test("reference issues 表逐字段镜像运行时 catalog", () => {
    const markdown = readFileSync(join(repositoryRoot, "packages/neuro-book/assets/reference/world-engine/issues.md"), "utf8");
    const referenceRows = parseIssueCatalogRows(markdown);
    const expectedRows = Object.values(WORLD_ISSUE_CATALOG).map((item) => ({
        label: item.label,
        code: item.code,
        severity: item.severity,
        title: item.title,
        persistence: item.persistence,
        source: item.source,
        whatHappened: item.explanation.whatHappened,
        whyItMatters: item.explanation.whyItMatters,
        suggestedAction: item.explanation.suggestedAction,
    }));
    expect(referenceRows.sort(byCode)).toEqual(expectedRows.sort(byCode));
});

test("reference issues 文档不再声明双真相源", () => {
    const markdown = readFileSync(join(repositoryRoot, "packages/neuro-book/assets/reference/world-engine/issues.md"), "utf8");
    expect(markdown).not.toContain("唯一人读真相源");
    expect(markdown).not.toContain("运行时代码真相源");
});

test("任务 56 的 World Issue reference 链接指向真实文件", () => {
    const taskPath = join(repositoryRoot, "packages/neuro-book/.agents/tasks/56-world-engine/README.md");
    const markdown = readFileSync(taskPath, "utf8");
    const match = markdown.match(/\[reference\/world-engine\/issues\.md\]\(([^)]+)\)/);
    expect(match?.[1]).toBeTruthy();
    const target = resolve(dirname(taskPath), match?.[1] ?? "");
    expect(existsSync(target)).toBe(true);
});

type ReferenceIssueRow = {
    label: string;
    code: string;
    severity: string;
    title: string;
    persistence: string;
    source: string;
    whatHappened: string;
    whyItMatters: string;
    suggestedAction: string;
};

function parseIssueCatalogRows(markdown: string): ReferenceIssueRow[] {
    const section = markdown.split("## Issue Catalog")[1]?.split("\n## ")[0] ?? "";
    const rows = section.split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("|") && !line.includes("---"));
    const dataRows = rows.slice(1);
    return dataRows.map((line) => {
        const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
        expect(cells).toHaveLength(9);
        const [label, code, severity, title, persistence, source, whatHappened, whyItMatters, suggestedAction] = cells;
        return {
            label: label ?? "",
            code: stripInlineCode(code ?? ""),
            severity: severity ?? "",
            title: title ?? "",
            persistence: persistence ?? "",
            source: source ?? "",
            whatHappened: whatHappened ?? "",
            whyItMatters: whyItMatters ?? "",
            suggestedAction: suggestedAction ?? "",
        };
    });
}

function stripInlineCode(value: string): string {
    return value.replace(/^`|`$/g, "");
}

function byCode(left: {code: string}, right: {code: string}): number {
    return left.code.localeCompare(right.code);
}
