import {describe, expect, it} from "vitest";

import {parseChangeScopeArguments, scopeWarnings} from "#scripts/ci/change-scope";

describe("改动范围参数", () => {
    it("解析 --since、--all、命令开关与 package runner 的 -- 分隔符", () => {
        const parsed = parseChangeScopeArguments(["--", "--since", "master", "--all", "--dry-run"], import.meta.url, ["--dry-run"]);

        expect(parsed.since).toBe("master");
        expect(parsed.all).toBe(true);
        expect([...parsed.flags]).toEqual(["--dry-run"]);
    });

    it("命令自己的带值参数可重复，按出现顺序收集", () => {
        const parsed = parseChangeScopeArguments(["--package", "nb-ui", "--tier", "llm", "--package", "nb-runtime"], import.meta.url, [], ["--package", "--tier"]);

        expect(parsed.options.get("--package")).toEqual(["nb-ui", "nb-runtime"]);
        expect(parsed.options.get("--tier")).toEqual(["llm"]);
        expect(() => parseChangeScopeArguments(["--package"], import.meta.url, [], ["--package"])).toThrow("参数缺少值：--package");
    });

    it("拒绝未知参数和缺值参数，不退回默认范围", () => {
        expect(() => parseChangeScopeArguments(["--sinse", "master"], import.meta.url)).toThrow("未知参数：--sinse");
        expect(() => parseChangeScopeArguments(["--since"], import.meta.url)).toThrow("参数缺少值：--since");
        expect(() => parseChangeScopeArguments(["--since", "--all"], import.meta.url)).toThrow("参数缺少值：--since");
    });
});

describe("按改动范围拆分警告", () => {
    const findings = [
        {path: "a.md", label: "坏链接", detail: "a.md -> x"},
        {path: "b.md", label: "坏链接", detail: "b.md -> y"},
        {path: "c.md", label: "缺 Spec", detail: "c.md"},
    ];

    it("范围内逐条列出，范围外按类别计数", () => {
        expect(scopeWarnings(findings, new Set(["a.md"]))).toEqual({
            warnings: ["坏链接：a.md -> x"],
            stockWarnings: "另有 2 条警告不在本次改动范围（坏链接 1、缺 Spec 1），加 --all 逐条列出",
        });
    });

    it("没有范围外警告时省略计数，范围为 null 时全部列出", () => {
        expect(scopeWarnings(findings, new Set(["a.md", "b.md", "c.md"]))).toEqual({warnings: ["坏链接：a.md -> x", "坏链接：b.md -> y", "缺 Spec：c.md"]});
        expect(scopeWarnings(findings, null).warnings).toHaveLength(3);
    });
});
