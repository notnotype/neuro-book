import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    CURATED_RULE_SLUGS,
    computeMaskedRanges,
    formatCheckReport,
    importCuratedRulesets,
    isMasked,
    loadConfig,
    loadRules,
    runCli,
    scanText,
} from "llmlint-dev/skill-test-api";
import type {LintRuleRecord} from "llmlint-dev/skill-test-api";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
const LLMLINT_SOURCE_ROOT = resolve(REPOSITORY_ROOT, "packages/llmlint/skill");
const RULESETS_ROOT = join(LLMLINT_SOURCE_ROOT, "rulesets");
const LLMLINT_BIN = join(LLMLINT_SOURCE_ROOT, "bin", "llmlint.ts");
const CURATED_SOURCE_FILES = [
    "轻量规则集1.2.json",
    "轻量规则集v1.1.json",
    "通用规则集1.2.json",
    "Claude-保守版.json",
    "Claude-日常版.json",
    "Claude-强力版.json",
    "Gemini-保守版.json",
    "Gemini-日常版.json",
    "Gemini-强力版.json",
    "deepseekv4pro专用.json",
    "极其杀手.json",
];
const execFileAsync = promisify(execFile);

describe("llmlint", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        process.exitCode = undefined;
        await Promise.all(tempRoots.map((root) => rm(root, {recursive: true, force: true})));
        tempRoots.length = 0;
    });

    it("默认启用 builtin/default ruleset 并加载 LLM rules", async () => {
        const {config} = await loadConfig({cwd: process.cwd()});
        const loadedRules = await loadRules(config);

        const issues = scanText("首先要分析问题，其次要制定方案，最后执行。他抬起头颅。", loadedRules.regexRules);

        expect(loadedRules.summary.rulesets).toEqual(["builtin/default"]);
        expect(issues.some((issue) => issue.rule.id === "firstly-secondly")).toBe(true);
        expect(issues.some((issue) => issue.rule.ruleset === "builtin/default")).toBe(true);
        expect(issues.find((issue) => issue.rule.id === "firstly-secondly")?.rule.level).toBe("high");
        expect(loadedRules.semanticRules.map((rule) => rule.id)).toContain("mechanical-elevation-ending");
        expect(issues.map((issue) => issue.rule.id)).toContain("cn.vocabulary.body.skull-head");
    });

    it("rules 和中文 namespace alias 能关闭和改写规则级别", async () => {
        const root = await mkdtemp(testHostPath("llmlint-config-"));
        tempRoots.push(root);
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {
    rulesets: ["builtin/default"],
    namespaces: {
        "二元对比": "low",
    },
    rules: {
        "filler-word-actually": "off",
    },
};
`, "utf-8");

        const {config} = await loadConfig({cwd: process.cwd(), configPath});
        const loadedRules = await loadRules(config);
        const issues = scanText("其实不是因为天气不好，而是因为路况复杂。", loadedRules.regexRules);

        expect(issues.some((issue) => issue.rule.id === "filler-word-actually")).toBe(false);
        expect(issues.find((issue) => issue.rule.id === "not-but-structure")?.rule.level).toBe("low");
    });

    it("vocabulary.r18 namespace 能关闭默认中文精选规则集中的 R18 规则", async () => {
        const loadedRules = await loadRules({
            rulesets: ["builtin/default"],
            trustedRulesets: [],
            rulesetOverrides: {},
            namespaces: {
                "vocabulary.r18": {enabled: false},
            },
            rules: {},
            ignoreTerms: [],
            output: "stylish",
        });

        expect(loadedRules.rules.some((rule) => rule.namespace === "vocabulary.r18")).toBe(false);
    });

    it("多个 ruleset 可向同 namespace append，并按同 id override 产生 diagnostics", async () => {
        const firstRuleset = `test/${randomUUID()}`;
        const secondRuleset = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(firstRuleset, [
            regexRule("test.shared.A", "modifier", "旧规则 A", "旧词"),
            regexRule("test.shared.B", "modifier", "规则 B", "新词"),
        ]);
        await writeRuleset(secondRuleset, [
            regexRule("test.shared.C", "modifier", "规则 C", "追加词"),
            regexRule("test.shared.A", "modifier", "覆盖规则 A", "覆盖词"),
        ]);

        const loadedRules = await loadRules({
            rulesets: [firstRuleset, secondRuleset],
            trustedRulesets: [],
            rulesetOverrides: {},
            namespaces: {},
            rules: {},
            ignoreTerms: [],
            output: "stylish",
        });

        const issues = scanText("旧词 新词 追加词 覆盖词", loadedRules.regexRules);

        expect(loadedRules.summary.namespaces.find((item) => item.namespace === "modifier")?.totalRules).toBe(3);
        expect(issues.some((issue) => issue.rule.id === "test.shared.B")).toBe(true);
        expect(issues.some((issue) => issue.rule.id === "test.shared.C")).toBe(true);
        expect(issues.find((issue) => issue.rule.id === "test.shared.A")?.match).toBe("覆盖词");
        expect(loadedRules.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "rule-override",
                ruleId: "test.shared.A",
                previousRuleset: firstRuleset,
                nextRuleset: secondRuleset,
            }),
        ]));
    });

    it("ruleset 会递归扫描 rules 目录并按路径稳定加载", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeMultiFileRuleset(rulesetId, {
            "rules/a.json": [
                regexRule("test.multi.first", "test.multi", "第一条", "甲词"),
            ],
            "rules/nested/b.json": [
                regexRule("test.multi.second", "test.multi", "第二条", "乙词"),
            ],
        });

        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const issues = scanText("甲词 乙词", loadedRules.regexRules);

        expect(loadedRules.rules.map((rule) => rule.id)).toEqual([
            "test.multi.first",
            "test.multi.second",
        ]);
        expect(issues.map((issue) => issue.rule.id)).toEqual([
            "test.multi.first",
            "test.multi.second",
        ]);
    });

    it("rules 目录层级不参与 namespace 语义", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeMultiFileRuleset(rulesetId, {
            "rules/unrelated/path.json": [
                regexRule("test.path.semantic", "semantic.namespace", "路径不参与语义", "甲词"),
            ],
        });

        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const rule = loadedRules.rules.find((item) => item.id === "test.path.semantic");

        expect(rule?.namespace).toBe("semantic.namespace");
    });

    it("ruleset 硬切拒绝旧 ruleFiles / rulesRoot / 根 rules.json 入口", async () => {
        const ruleFilesRuleset = `test/${randomUUID()}`;
        const rulesRootRuleset = `test/${randomUUID()}`;
        const rootRulesJsonRuleset = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeMultiFileRuleset(ruleFilesRuleset, {
            "rules/index.json": [regexRule("test.removed.ruleFiles", "test.removed", "旧 ruleFiles", "甲词")],
        }, {ruleFiles: ["rules/index.json"]});
        await writeMultiFileRuleset(rulesRootRuleset, {
            "rules/index.json": [regexRule("test.removed.rulesRoot", "test.removed", "旧 rulesRoot", "乙词")],
        }, {rulesRoot: "rules"});
        await writeLegacyRootRulesJsonRuleset(rootRulesJsonRuleset, [
            regexRule("test.removed.root", "test.removed", "旧 rules.json", "丙词"),
        ]);

        await expect(loadRules(emptyConfig([ruleFilesRuleset]))).rejects.toThrow("不再支持 ruleFiles");
        await expect(loadRules(emptyConfig([rulesRootRuleset]))).rejects.toThrow("不再支持 rulesRoot");
        await expect(loadRules(emptyConfig([rootRulesJsonRuleset]))).rejects.toThrow("不再支持根目录 rules.json");
    });

    it("ruleset 会明确报告 rules 目录形态和 JSON 语法错误", async () => {
        const fileRulesPathRuleset = `test/${randomUUID()}`;
        const invalidJsonRuleset = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRulesPathAsFileRuleset(fileRulesPathRuleset);
        await writeInvalidJsonRuleset(invalidJsonRuleset);

        await expect(loadRules(emptyConfig([fileRulesPathRuleset]))).rejects.toThrow("rules/ 必须是规则目录");
        await expect(loadRules(emptyConfig([invalidJsonRuleset]))).rejects.toThrow(`规则包 ${invalidJsonRuleset} 的 rules/broken.json 不是合法 JSON`);
    });

    it("rulesetOverrides off 的规则包不参与同 ID 覆盖", async () => {
        const firstRuleset = `test/${randomUUID()}`;
        const secondRuleset = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(firstRuleset, [
            regexRule("test.shared.A", "modifier", "旧规则 A", "旧词"),
        ]);
        await writeRuleset(secondRuleset, [
            regexRule("test.shared.A", "modifier", "覆盖规则 A", "覆盖词"),
        ]);

        const loadedRules = await loadRules({
            rulesets: [firstRuleset, secondRuleset],
            trustedRulesets: [],
            rulesetOverrides: {
                [secondRuleset]: "off",
            },
            namespaces: {},
            rules: {},
            ignoreTerms: [],
            output: "stylish",
        });
        const issues = scanText("旧词 覆盖词", loadedRules.regexRules);

        expect(issues).toHaveLength(1);
        expect(issues[0]?.rule.ruleset).toBe(firstRuleset);
        expect(issues[0]?.match).toBe("旧词");
        expect(loadedRules.diagnostics.some((diagnostic) => diagnostic.code === "rule-override")).toBe(false);
    });

    it("rulesetOverrides off 的规则包可被 rule 或 namespace 显式启用", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.explicit.rule", "modifier", "按 rule 启用", "规则词"),
            regexRule("test.explicit.namespace", "tone", "按 namespace 启用", "语气词"),
            regexRule("test.explicit.skipped", "cliche", "保持关闭", "关闭词"),
        ]);

        const loadedRules = await loadRules({
            rulesets: [rulesetId],
            trustedRulesets: [],
            rulesetOverrides: {
                [rulesetId]: "off",
            },
            namespaces: {
                tone: {enabled: true, level: "low"},
            },
            rules: {
                "test.explicit.rule": {enabled: true, level: "high"},
            },
            ignoreTerms: [],
            output: "stylish",
        });
        const issues = scanText("规则词 语气词 关闭词", loadedRules.regexRules);

        expect(issues.map((issue) => issue.rule.id)).toEqual([
            "test.explicit.rule",
            "test.explicit.namespace",
        ]);
        expect(issues.find((issue) => issue.rule.id === "test.explicit.rule")?.rule.level).toBe("high");
        expect(issues.find((issue) => issue.rule.id === "test.explicit.namespace")?.rule.level).toBe("low");
        expect(loadedRules.summary.rulesets).toContain(rulesetId);
    });

    it("regex detector 支持 flags 和多个 targets", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [{
            ...regexRule("test.flags", "test.regex", "大小写规则", "alpha"),
            detector: {type: "regex", targets: ["alpha", "beta"], flags: "i"},
        }]);

        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const issues = scanText("ALPHA beta", loadedRules.regexRules);

        expect(issues.map((issue) => issue.match)).toEqual(["ALPHA", "beta"]);
        expect(issues.map((issue) => `${issue.line}:${issue.column}-${issue.endColumn}`)).toEqual(["1:1-5", "1:7-10"]);
    });

    it("regex detector 的结束列按人类可读字符计算", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [{
            ...regexRule("test.codepoint-range", "test.regex", "字符列规则", "😀"),
            detector: {type: "regex", targets: ["😀", "😀A", "甲\n乙"]},
        }]);

        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const issues = scanText("😀 😀A\n甲\n乙", loadedRules.regexRules);

        expect(issues.map((issue) => `${issue.line}:${issue.column}-${issue.endLine}:${issue.endColumn}`)).toEqual([
            "1:1-1:1",
            "1:3-1:3",
            "1:3-1:4",
            "2:1-3:1",
        ]);
    });

    it("stylish check 默认输出紧凑位置范围，不重复完整命中行", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            {...regexRule("test.high", "test.output", "高等级规则", "高风险词"), level: "high"},
            {...regexRule("test.low", "test.output", "低等级规则", "低风险词"), level: "low"},
        ]);
        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const text = "同一行有高风险词，也有低风险词。";
        const issues = scanText(text, loadedRules.regexRules);

        const output = formatCheckReport("input.md", issues, loadedRules);

        expect(output.indexOf("high (1 problem)")).toBeLessThan(output.indexOf("low (1 problem)"));
        expect(output).toContain("1:5-8  match: 高风险词");
        expect(output).toContain("1:12-15  match: 低风险词");
        expect(output).not.toContain("同一行有高风险词，也有低风险词。");
        expect(output).not.toContain("<mark>");
        expect(output).not.toContain("^^");
    });

    it("stylish check showLines 模式输出完整行并用 mark 标注", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            {...regexRule("test.high.lines", "test.output", "高等级规则", "高风险词"), level: "high"},
        ]);
        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const text = "这是一个很长的完整行，前面有足够多的上下文用于验证不会被截断，高风险词后面也应该保留完整上下文。";
        const issues = scanText(text, loadedRules.regexRules);

        const output = formatCheckReport("input.md", issues, loadedRules, {showLines: true});

        expect(output).toContain("1:32-35  这是一个很长的完整行，前面有足够多的上下文用于验证不会被截断，<mark>高风险词</mark>后面也应该保留完整上下文。");
    });

    it("未知 builtin handler 会跳过并产生 warning", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [{
            id: "test.handler",
            namespace: "test.handler",
            title: "handler",
            level: "medium",
            handler: {type: "builtin", name: "test.unknown-handler"},
            action: {type: "suggest", message: "未知 handler"},
        }]);

        const loadedRules = await loadRules(emptyConfig([rulesetId]));

        expect(loadedRules.rules).toHaveLength(0);
        expect(loadedRules.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({code: "unknown-handler-name", ruleId: "test.handler"}),
        ]));
    });

    it("rule source 只接受当前 schema 明确允许的字段", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRawRuleset(rulesetId, [{
            id: "test.source.extra",
            namespace: "test.source",
            title: "来源字段收紧",
            level: "medium",
            source: {
                importedFrom: "fixture",
                unexpected: "not allowed",
            },
            detector: {type: "regex", targets: ["来源词"]},
            action: {type: "replace", replacements: [""]},
        }]);

        await expect(loadRules(emptyConfig([rulesetId]))).rejects.toThrow("不是允许的 source 字段");
    });

    it("配置 output json 时 CLI 输出 check JSON，包含 registry 和 diagnostics", async () => {
        const root = await mkdtemp(testHostPath("llmlint-json-output-"));
        tempRoots.push(root);
        const configPath = join(root, "llmlint.config.ts");
        const textPath = join(root, "input.md");
        await writeFile(configPath, `export default {
    rulesets: ["builtin/default"],
    output: "json",
};
`, "utf-8");
        await writeFile(textPath, "alpha beta", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath]);

        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; registry: {rulesets: string[]}; diagnostics: unknown[]; issues: unknown[]};
        expect(report).toMatchObject({
            kind: "check",
            registry: {rulesets: ["builtin/default"]},
            diagnostics: [],
            issues: [],
        });
    });

    it("命令行 --format json 覆盖 config output 并输出 rules JSON", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--format", "json", "rules", "--detector", "semantic"]);

        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; rules: Array<{id: string}>};
        expect(report.kind).toBe("rules");
        expect(report.rules.map((rule) => rule.id)).toContain("mechanical-elevation-ending");
    });

    it("JSON check 输出保留 context 并包含结束位置", async () => {
        const rulesetId = `test/${randomUUID()}`;
        const root = await mkdtemp(testHostPath("llmlint-json-issue-"));
        tempRoots.push(root, join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.json.issue", "test.output", "JSON 规则", "高风险词"),
        ]);
        const configPath = join(root, "llmlint.config.ts");
        const textPath = join(root, "input.md");
        await writeFile(configPath, `export default {
    rulesets: ["${rulesetId}"],
};
`, "utf-8");
        await writeFile(textPath, "前文高风险词后文", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "--format", "json", "check", textPath]);

        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {issues: Array<{line: number; column: number; endLine: number; endColumn: number; context: {before: string; current: string; after: string}}>};
        expect(report.issues[0]).toMatchObject({
            line: 1,
            column: 3,
            endLine: 1,
            endColumn: 6,
            context: {
                before: "前文",
                current: "高风险词",
                after: "后文",
            },
        });
    });

    it("CLI check 支持按最低级别过滤输出", async () => {
        const rulesetId = `test/${randomUUID()}`;
        const root = await mkdtemp(testHostPath("llmlint-min-level-"));
        tempRoots.push(root, join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            {...regexRule("test.high.filter", "test.output", "高等级过滤", "高风险词"), level: "high"},
            {...regexRule("test.low.filter", "test.output", "低等级过滤", "低风险词"), level: "low"},
        ]);
        const configPath = join(root, "llmlint.config.ts");
        const textPath = join(root, "input.md");
        await writeFile(configPath, `export default {
    rulesets: ["${rulesetId}"],
};
`, "utf-8");
        await writeFile(textPath, "高风险词 低风险词", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath, "--min-level", "medium", "--show-lines"]);

        const output = String(log.mock.calls[0]?.[0]);
        expect(output).toContain("显示级别：medium 及以上；已隐藏 1 条较低级别命中。");
        expect(output).toContain("test.high.filter");
        expect(output).toContain("<mark>高风险词</mark>");
        expect(output).not.toContain("test.low.filter");
    });

    it("CLI help 只暴露硬切后的公开命令", async () => {
        const {stdout} = await execFileAsync("bun", [LLMLINT_BIN, "--help"], {
            encoding: "utf-8",
            timeout: 10000,
        });

        expect(stdout).toContain("check [options] <files...>");
        expect(stdout).toContain("rules [options]");
        // 写作期入口必须出现在 --help 第一屏，否则要动笔的 Agent 发现不了它。
        expect(stdout).toContain("guide [options]");
        expect(stdout).not.toContain("show-llm-rules");
        expect(stdout).not.toContain("import-legacy");
        expect(stdout).not.toContain("import-curated");
        expect(stdout).not.toContain("兼容旧用法");
        expect(stdout).not.toContain("llmlint [options] [file]");
    });

    it("CLI 不再支持 llmlint <file> 旧 positional 用法", async () => {
        const result = await runFailedCommand([
            LLMLINT_BIN,
            join(LLMLINT_SOURCE_ROOT, "SKILL.md"),
        ]);

        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("unknown command");
    });

    it("llmlint 源码不保留旧规则导入入口", async () => {
        const root = LLMLINT_SOURCE_ROOT;
        const files = await listFiles(root);
        const fileNames = files.map((file) => file.replace(/\\/g, "/"));
        const source = (await Promise.all(files
            .filter((file) => /\.(ts|md|json)$/.test(file))
            .map((file) => readFile(file, "utf-8"))))
            .join("\n");

        expect(fileNames.some((file) => file.endsWith("legacy-import.ts"))).toBe(false);
        expect(source).not.toContain("import-legacy");
        expect(source).not.toContain("LegacyImport");
        expect(source).not.toContain("source.legacy");
    });

    it("curated import 会生成按 namespace 拆分的内置默认 ruleset", async () => {
        const root = await mkdtemp(testHostPath("llmlint-curated-"));
        tempRoots.push(root);
        const sourceRoot = join(root, "source");
        await writeCuratedSourceFixture(sourceRoot);
        const report = await importCuratedRulesets({
            sourceRoot,
            outputRoot: root,
        });
        const rulesetRoot = join(root, "builtin", "default");
        const manifest = JSON.parse(await readFile(join(rulesetRoot, "ruleset.json"), "utf-8")) as Record<string, unknown>;
        const rules = await readRulesetRules(rulesetRoot) as Array<{
            id: string;
            namespace: string;
            enabled?: boolean;
            detector: {type: "regex"; targets: string[]} | {type: "llm"; prompt: string};
            action: {replacements?: string[]};
            source?: {canonicalKey?: string; importedFrom?: string};
        }>;
        const r18Rules = JSON.parse(await readFile(join(rulesetRoot, "rules", "vocabulary", "r18.json"), "utf-8")) as Array<{namespace: string}>;

        expect(report.rulesets.map((ruleset) => ruleset.rulesetId)).toEqual([
            "builtin/default",
        ]);
        await expect(readFile(join(rulesetRoot, "rules.json"), "utf-8")).rejects.toMatchObject({code: "ENOENT"});
        expect(manifest.ruleFiles).toBeUndefined();
        expect(manifest.rulesRoot).toBeUndefined();
        expect(r18Rules).toHaveLength(1);
        expect(r18Rules.every((rule) => rule.namespace === "vocabulary.r18")).toBe(true);
        expect(report.skipped).toHaveLength(0);
        expect(report.converted.text).toBeGreaterThan(0);
        expect(report.converted.simple).toBeGreaterThan(0);
        expect(report.converted.regex).toBeGreaterThan(0);
        expect(report.uniqueRules).toBe(rules.length);
        expect(rules.filter((rule) => rule.id.startsWith("cn."))).toHaveLength(4);
        expect(rules.some((rule) => rule.id === "mechanical-elevation-ending")).toBe(true);
        expect(rules.some((rule) => rule.id === "opening-cliche-announce" && rule.namespace === "opening.cliche")).toBe(true);
        expect(rules.some((rule) => rule.id === "inflation-novelty" && rule.namespace === "inflation.significance")).toBe(true);
        expect(rules.some((rule) => rule.id === "mechanical-zero-width" && rule.namespace === "mechanical.zero-width")).toBe(true);
        expect(rules.some((rule) => /^cn\..+\.[0-9a-f]{10}$/.test(rule.id))).toBe(false);
        expect(rules.some((rule) => rule.namespace === "vocabulary.r18" && rule.enabled !== false)).toBe(true);
        expect(rules.some((rule) => rule.namespace === "modifier.extreme" && rule.enabled !== false)).toBe(false);
        expect(JSON.stringify(rules)).not.toContain(`leg${"acy"}`);
        expect(rules.filter((rule) => rule.id.startsWith("cn.")).every((rule) => rule.source?.importedFrom === "curated-cn-rule-samples")).toBe(true);
        expect(rules.some((rule) => rule.id === "cn.vocabulary.body.skull-head")).toBe(true);
        const cnSlugs = rules
            .filter((rule) => rule.id.startsWith("cn."))
            .map((rule) => rule.id.split(".").at(-1) ?? "");
        expect(cnSlugs.every((slug) => slug.length <= 40)).toBe(true);
        expect(cnSlugs).not.toEqual(expect.arrayContaining([
            "tou-lu",
            "cu-zhong-cu-bao-feng-kuang-de-di",
            "zhi-shan-mo-wei-huo-dui-hua-qian-zhi-fen-ju",
            "punctuation-4",
        ]));
        const headRule = rules.find((rule) => rule.detector.type === "regex" && rule.detector.targets.includes("头颅"));
        expect(headRule?.action.replacements)
            .toEqual(expect.arrayContaining(["头", "脑袋"]));
    });

    it("curated import 遇到缺失 slug 映射会失败", async () => {
        const root = await mkdtemp(testHostPath("llmlint-curated-missing-slug-"));
        tempRoots.push(root);
        const sourceRoot = join(root, "source");
        await writeCuratedSourceFixture(sourceRoot);
        const key = "vocabulary.body\t\t头颅";
        const original = CURATED_RULE_SLUGS[key];
        delete CURATED_RULE_SLUGS[key];

        try {
            await expect(importCuratedRulesets({
                sourceRoot,
                outputRoot: root,
            })).rejects.toThrow("缺少中文规则 slug 映射");
        } finally {
            if (original) {
                CURATED_RULE_SLUGS[key] = original;
            }
        }
    });

    it("loader 解析 review / fixability：命名空间策略优先于 detector/action 推导", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.policy.dash", "punctuation.dash", "破折号", "甲词"),
            {
                id: "test.policy.dedup",
                namespace: "punctuation.dedup",
                title: "连续符号去重",
                level: "medium",
                detector: {type: "regex", targets: ["乙词"]},
                action: {type: "replace", replacements: ["乙"]},
            },
            regexRule("test.policy.plain", "test.plain", "普通替换", "丙词"),
            {
                id: "test.policy.suggest",
                namespace: "test.plain",
                title: "纯提示",
                level: "medium",
                detector: {type: "regex", targets: ["丁词"]},
                action: {type: "suggest", message: "读取上下文"},
            },
        ]);

        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const byId = new Map(loadedRules.rules.map((rule) => [rule.id, rule]));

        expect(byId.get("test.policy.dash")).toMatchObject({review: "human", fixability: "manual"});
        expect(byId.get("test.policy.dedup")).toMatchObject({review: "none", fixability: "auto"});
        expect(byId.get("test.policy.plain")).toMatchObject({review: "agent", fixability: "manual"});
        expect(byId.get("test.policy.suggest")).toMatchObject({review: "agent", fixability: "manual"});
    });

    it("config 对象覆盖能调整 review，rule id 优先于 namespace", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.review.a", "test.review", "规则 A", "甲词"),
            regexRule("test.review.b", "test.review", "规则 B", "乙词"),
        ]);

        const loadedRules = await loadRules({
            rulesets: [rulesetId],
            trustedRulesets: [],
            rulesetOverrides: {},
            namespaces: {"test.review": {review: "human"}},
            rules: {"test.review.a": {review: "none"}},
            ignoreTerms: [],
            output: "stylish",
        });
        const byId = new Map(loadedRules.rules.map((rule) => [rule.id, rule]));

        expect(byId.get("test.review.a")?.review).toBe("none");
        expect(byId.get("test.review.b")?.review).toBe("human");
    });

    it("CLI check 默认按 review=agent 过滤，--review human 显示人工桶", async () => {
        const rulesetId = `test/${randomUUID()}`;
        const root = await mkdtemp(testHostPath("llmlint-review-"));
        tempRoots.push(root, join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.review.agent", "test.plain", "Agent 桶", "甲词"),
            regexRule("test.review.human", "punctuation.dash", "人工桶", "乙词"),
        ]);
        const configPath = join(root, "llmlint.config.ts");
        const textPath = join(root, "input.md");
        await writeFile(configPath, `export default {\n    rulesets: ["${rulesetId}"],\n};\n`, "utf-8");
        await writeFile(textPath, "甲词 乙词", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath]);
        const defaultOutput = String(log.mock.calls[0]?.[0]);
        expect(defaultOutput).toContain("test.review.agent");
        expect(defaultOutput).not.toContain("test.review.human");
        expect(defaultOutput).toContain("显示范围：review=agent；已隐藏 1 条非 agent 命中。");

        log.mockClear();
        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath, "--review", "human"]);
        const humanOutput = String(log.mock.calls[0]?.[0]);
        expect(humanOutput).toContain("test.review.human");
        expect(humanOutput).not.toContain("test.review.agent");
    });

    it("JSON check filter 暴露 review 过滤与隐藏统计，rules 字典带 review/fixability", async () => {
        const rulesetId = `test/${randomUUID()}`;
        const root = await mkdtemp(testHostPath("llmlint-review-json-"));
        tempRoots.push(root, join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.json.agent", "test.plain", "Agent 桶", "甲词"),
            regexRule("test.json.human", "punctuation.dash", "人工桶", "乙词"),
        ]);
        const configPath = join(root, "llmlint.config.ts");
        const textPath = join(root, "input.md");
        await writeFile(configPath, `export default {\n    rulesets: ["${rulesetId}"],\n    output: "json",\n};\n`, "utf-8");
        await writeFile(textPath, "甲词 乙词", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath]);
        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {
            filter: {review: string; hiddenByReview: number; minLevel: string; hiddenByLevel: number};
            rules: Record<string, {review: string; fixability: string}>;
            issues: Array<{ruleId: string}>;
        };
        expect(report.filter).toMatchObject({review: "agent", hiddenByReview: 1, minLevel: "low", hiddenByLevel: 0});
        expect(report.issues).toHaveLength(1);
        const ruleId = report.issues[0]?.ruleId;
        expect(ruleId).toBeDefined();
        expect(ruleId ? report.rules[ruleId] : undefined).toMatchObject({review: "agent", fixability: "manual"});
    });

    it("config review 非法值返回明确 schema 错误", async () => {
        const root = await mkdtemp(testHostPath("llmlint-bad-review-"));
        tempRoots.push(root);
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {\n    rulesets: ["builtin/default"],\n    rules: {"filler-word-actually": {review: "robot"}},\n};\n`, "utf-8");

        await expect(loadConfig({cwd: process.cwd(), configPath})).rejects.toThrow("review 无效");
    });

    it("对象覆盖 {enabled:true} 能启用默认禁用的规则并同时设级别与受众", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            {...regexRule("test.enable.obj", "test.enable", "默认禁用规则", "甲词"), enabled: false},
        ]);

        const baseline = await loadRules(emptyConfig([rulesetId]));
        expect(baseline.rules.some((rule) => rule.id === "test.enable.obj")).toBe(false);

        const loadedRules = await loadRules({
            rulesets: [rulesetId],
            trustedRulesets: [],
            rulesetOverrides: {},
            namespaces: {},
            rules: {"test.enable.obj": {enabled: true, level: "high", review: "human"}},
            ignoreTerms: [],
            output: "stylish",
        });
        const rule = loadedRules.rules.find((item) => item.id === "test.enable.obj");
        expect(rule).toMatchObject({level: "high", review: "human"});
    });

    it("纯属性对象覆盖不复活被关闭 ruleset 的规则，显式 {enabled:true} 才复活", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.resurrect.rule", "test.resurrect", "规则", "甲词"),
        ]);

        const attrOnly = await loadRules({
            rulesets: [rulesetId],
            trustedRulesets: [],
            rulesetOverrides: {[rulesetId]: "off"},
            namespaces: {"test.resurrect": {review: "human"}},
            rules: {},
            ignoreTerms: [],
            output: "stylish",
        });
        expect(attrOnly.rules.some((rule) => rule.id === "test.resurrect.rule")).toBe(false);

        const withEnable = await loadRules({
            rulesets: [rulesetId],
            trustedRulesets: [],
            rulesetOverrides: {[rulesetId]: "off"},
            namespaces: {"test.resurrect": {enabled: true, review: "human"}},
            rules: {},
            ignoreTerms: [],
            output: "stylish",
        });
        expect(withEnable.rules.some((rule) => rule.id === "test.resurrect.rule")).toBe(true);
    });

    it("config 文件中的字符串简写仍能启用被关闭 ruleset 的规则", async () => {
        const rulesetId = `test/${randomUUID()}`;
        const root = await mkdtemp(testHostPath("llmlint-sugar-"));
        tempRoots.push(root, join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [
            regexRule("test.sugar.rule", "test.sugar", "规则", "甲词"),
        ]);
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {\n    rulesets: ["${rulesetId}"],\n    rulesetOverrides: {"${rulesetId}": "off"},\n    rules: {"test.sugar.rule": "high"},\n};\n`, "utf-8");

        const {config} = await loadConfig({cwd: process.cwd(), configPath});
        const loadedRules = await loadRules(config);
        const rule = loadedRules.rules.find((item) => item.id === "test.sugar.rule");
        expect(rule?.level).toBe("high");
    });

    it("显式配置路径不存在时返回明确错误", async () => {
        await expect(loadConfig({
            cwd: process.cwd(),
            configPath: testHostPath("missing-llmlint.config.ts"),
        })).rejects.toThrow("配置文件不存在");
    });

    it("computeMaskedRanges 覆盖 frontmatter / 代码块 / 行内代码 / 链接", () => {
        const content = [
            "---",
            "title: x",
            "---",
            "正文 `code` 与 [note](http://e.com)。",
            "```js",
            "const a = 1;",
            "```",
        ].join("\n");
        const ranges = computeMaskedRanges(content);

        expect(ranges[0]?.[0]).toBe(0); // frontmatter 从文件首字符开始
        expect(isMasked(content.indexOf("`code`"), ranges)).toBe(true);
        expect(isMasked(content.indexOf("[note]"), ranges)).toBe(true);
        expect(isMasked(content.indexOf("const a"), ranges)).toBe(true);
        expect(isMasked(content.indexOf("正文 "), ranges)).toBe(false);
    });

    it("scanText 跳过 Markdown 遮罩区域内的命中，但保留正文命中与定位", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [regexRule("test.mask.filler", "test.plain", "填充", "其实")]);
        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const content = "正文其实在这。\n\n```\n代码其实不算\n```\n";

        const unmasked = scanText(content, loadedRules.regexRules);
        const masked = scanText(content, loadedRules.regexRules, {maskedRanges: computeMaskedRanges(content)});

        expect(unmasked).toHaveLength(2);
        expect(masked).toHaveLength(1);
        expect(masked[0]?.line).toBe(1);
        expect(masked[0]?.match).toBe("其实");
    });

    it("CLI check 单文件 JSON 仍为 check 形态（回归保护）", async () => {
        const root = await mkdtemp(testHostPath("llmlint-single-"));
        tempRoots.push(root);
        const textPath = join(root, "input.md");
        await writeFile(textPath, "其实甲。", "utf-8");
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {rulesets:["builtin/default"], rules:{"filler-word-actually":{enabled:true}}, output:"json"};\n`, "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath, "--review", "all"]);
        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; filePath: string};
        expect(report.kind).toBe("check");
        expect(report.filePath).toContain("input.md");
    });

    it("CLI check 多文件目录递归聚合，JSON 为 check-multi 形态", async () => {
        const root = await mkdtemp(testHostPath("llmlint-multi-"));
        tempRoots.push(root);
        await writeFile(join(root, "a.md"), "其实甲。", "utf-8");
        await mkdir(join(root, "sub"), {recursive: true});
        await writeFile(join(root, "sub", "b.md"), "其实乙。", "utf-8");
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {rulesets:["builtin/default"], rules:{"filler-word-actually":{enabled:true}}, output:"json"};\n`, "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", root, "--review", "all"]);
        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; files: Array<{filePath: string; issues: unknown[]}>; summary: {total: number}};
        expect(report.kind).toBe("check-multi");
        expect(report.files).toHaveLength(2);
        expect(report.summary.total).toBeGreaterThanOrEqual(2);
    });

    it("CLI check --scan-all 关闭 Markdown 遮罩，代码块命中回来", async () => {
        const root = await mkdtemp(testHostPath("llmlint-scanall-"));
        tempRoots.push(root);
        const textPath = join(root, "input.md");
        await writeFile(textPath, "正文。\n\n```\n其实代码\n```\n", "utf-8");
        const configPath = join(root, "llmlint.config.ts");
        await writeFile(configPath, `export default {rulesets:["builtin/default"], rules:{"filler-word-actually":{enabled:true}}};\n`, "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath, "--review", "all"]);
        expect(String(log.mock.calls[0]?.[0])).not.toContain("其实");

        log.mockClear();
        await runCli(["bun", "llmlint", "--config", configPath, "check", textPath, "--review", "all", "--scan-all"]);
        expect(String(log.mock.calls[0]?.[0])).toContain("其实");
    });

    it("CLI check 输入路径不存在时报错并非零退出", async () => {
        const result = await runFailedCommand([LLMLINT_BIN, "check", testHostPath(`missing-${randomUUID()}.md`)]);

        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("不存在");
    });

    it("fix dry-run 检出 auto 修复但不改文件，退出码非零", async () => {
        const root = await mkdtemp(testHostPath("llmlint-fix-dry-"));
        tempRoots.push(root);
        const filePath = join(root, "doc.md");
        const zwsp = String.fromCharCode(0x200B);
        const original = `正文${zwsp}有零宽。\n\n真的？？？\n`;
        await writeFile(filePath, original, "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "fix", filePath]);

        expect(process.exitCode).toBe(1);
        expect(await readFile(filePath, "utf-8")).toBe(original);
        expect(String(log.mock.calls[0]?.[0])).toContain("dry-run");
    });

    it("fix --write 落盘：删零宽但保留需人工判断的连续符号", async () => {
        const root = await mkdtemp(testHostPath("llmlint-fix-write-"));
        tempRoots.push(root);
        const filePath = join(root, "doc.md");
        const zwsp = String.fromCharCode(0x200B);
        await writeFile(filePath, `正文${zwsp}有零宽。\n\n真的？？？\n`, "utf-8");
        vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "fix", filePath, "--write"]);

        expect(await readFile(filePath, "utf-8")).toBe("正文有零宽。\n\n真的？？？\n");
        expect(process.exitCode).not.toBe(1);
    });

    it("fix 尊重 Markdown 遮罩：代码块内零宽字符不被修复", async () => {
        const root = await mkdtemp(testHostPath("llmlint-fix-mask-"));
        tempRoots.push(root);
        const filePath = join(root, "doc.md");
        const zwsp = String.fromCharCode(0x200B);
        await writeFile(filePath, `正文${zwsp}删除\n\n\`\`\`\n代码${zwsp}保留\n\`\`\`\n`, "utf-8");
        vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "fix", filePath, "--write"]);
        const fixed = await readFile(filePath, "utf-8");

        expect(fixed).toContain("正文删除\n");
        expect(fixed).toContain(`代码${zwsp}保留`);
    });

    it("fix 不自动应用 candidate 规则（filler 其实 不被删）", async () => {
        const root = await mkdtemp(testHostPath("llmlint-fix-candidate-"));
        tempRoots.push(root);
        const filePath = join(root, "doc.md");
        await writeFile(filePath, "其实没什么。\n", "utf-8");
        vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "fix", filePath, "--write"]);

        expect(await readFile(filePath, "utf-8")).toBe("其实没什么。\n");
    });

    it("fix --format json 输出 kind:fix 与逐文件计数", async () => {
        const root = await mkdtemp(testHostPath("llmlint-fix-json-"));
        tempRoots.push(root);
        const filePath = join(root, "doc.md");
        await writeFile(filePath, `正文${String.fromCharCode(0x200B)}有零宽。\n`, "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "fix", filePath, "--format", "json"]);

        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; write: boolean; totalOccurrences: number; files: Array<{changed: boolean}>};
        expect(report.kind).toBe("fix");
        expect(report.write).toBe(false);
        expect(report.totalOccurrences).toBeGreaterThanOrEqual(1);
        expect(report.files[0]?.changed).toBe(true);
    });

    it("CLI check 支持 glob 模式与 ! 排除", async () => {
        const dir = `llmlint-glob-${randomUUID()}`;
        const absDir = resolve(process.cwd(), dir);
        tempRoots.push(absDir);
        await mkdir(join(absDir, "drafts"), {recursive: true});
        await writeFile(join(absDir, "a.md"), "其实甲。", "utf-8");
        await writeFile(join(absDir, "b.md"), "其实乙。", "utf-8");
        await writeFile(join(absDir, "drafts", "skip.md"), "其实丙。", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "check", `${dir}/**/*.md`, `!${dir}/drafts/**`, "--review", "all", "--format", "json"]);
        const report = JSON.parse(String(log.mock.calls[0]?.[0])) as {kind: string; files: Array<{filePath: string}>};
        expect(report.kind).toBe("check-multi");
        expect(report.files).toHaveLength(2);
        expect(report.files.every((file) => !file.filePath.includes("drafts"))).toBe(true);
    });

    it("formatCheckReport color 门控：true 含 ANSI、false 纯文本", async () => {
        const rulesetId = `test/${randomUUID()}`;
        tempRoots.push(join(RULESETS_ROOT, "test"));
        await writeRuleset(rulesetId, [{...regexRule("test.color", "test.output", "颜色规则", "高风险词"), level: "high"}]);
        const loadedRules = await loadRules(emptyConfig([rulesetId]));
        const issues = scanText("有高风险词。", loadedRules.regexRules);

        const colored = formatCheckReport("input.md", issues, loadedRules, {color: true});
        const plain = formatCheckReport("input.md", issues, loadedRules, {color: false});
        const esc = String.fromCharCode(0x1B);
        expect(colored).toContain(esc);
        expect(plain).not.toContain(esc);
    });

    it("CLI check 被抓取（非 TTY）输出纯文本，无 ANSI", async () => {
        const root = await mkdtemp(testHostPath("llmlint-noansi-"));
        tempRoots.push(root);
        const filePath = join(root, "input.md");
        await writeFile(filePath, "其实甲。", "utf-8");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await runCli(["bun", "llmlint", "check", filePath, "--review", "all"]);

        expect(String(log.mock.calls[0]?.[0])).not.toContain(String.fromCharCode(0x1B));
    });
});

function emptyConfig(rulesets: string[]) {
    return {
        rulesets,
        trustedRulesets: [],
        rulesetOverrides: {},
        namespaces: {},
        rules: {},
        ignoreTerms: [],
        output: "stylish" as const,
    };
}

function regexRule(id: string, namespace: string, title: string, target: string): LintRuleRecord {
    return {
        id,
        namespace,
        title,
        level: "medium",
        detector: {type: "regex", targets: [target]},
        action: {type: "replace", replacements: [""]},
    };
}

async function writeRuleset(id: string, rules: LintRuleRecord[]): Promise<void> {
    await writeRawRuleset(id, rules);
}

async function writeMultiFileRuleset(id: string, ruleFiles: Record<string, LintRuleRecord[]>, manifestExtra: Record<string, unknown> = {}): Promise<void> {
    const root = join(RULESETS_ROOT, ...id.split("/"));
    await mkdir(root, {recursive: true});
    await writeFile(join(root, "ruleset.json"), JSON.stringify({
        id,
        title: id,
        version: "1.0.0",
        ...manifestExtra,
    }), "utf-8");
    for (const [ruleFile, rules] of Object.entries(ruleFiles)) {
        const filePath = join(root, ruleFile);
        await mkdir(dirname(filePath), {recursive: true});
        await writeFile(filePath, JSON.stringify(rules), "utf-8");
    }
}

async function writeRawRuleset(id: string, rules: object[]): Promise<void> {
    const root = join(RULESETS_ROOT, ...id.split("/"));
    await mkdir(root, {recursive: true});
    await writeFile(join(root, "ruleset.json"), JSON.stringify({
        id,
        title: id,
        version: "1.0.0",
    }), "utf-8");
    await mkdir(join(root, "rules"), {recursive: true});
    await writeFile(join(root, "rules", "index.json"), JSON.stringify(rules), "utf-8");
}

async function writeLegacyRootRulesJsonRuleset(id: string, rules: object[]): Promise<void> {
    const root = join(RULESETS_ROOT, ...id.split("/"));
    await mkdir(root, {recursive: true});
    await writeFile(join(root, "ruleset.json"), JSON.stringify({
        id,
        title: id,
        version: "1.0.0",
    }), "utf-8");
    await writeFile(join(root, "rules.json"), JSON.stringify(rules), "utf-8");
}

async function writeRulesPathAsFileRuleset(id: string): Promise<void> {
    const root = join(RULESETS_ROOT, ...id.split("/"));
    await mkdir(root, {recursive: true});
    await writeFile(join(root, "ruleset.json"), JSON.stringify({
        id,
        title: id,
        version: "1.0.0",
    }), "utf-8");
    await writeFile(join(root, "rules"), "not a directory", "utf-8");
}

async function writeInvalidJsonRuleset(id: string): Promise<void> {
    const root = join(RULESETS_ROOT, ...id.split("/"));
    await mkdir(join(root, "rules"), {recursive: true});
    await writeFile(join(root, "ruleset.json"), JSON.stringify({
        id,
        title: id,
        version: "1.0.0",
    }), "utf-8");
    await writeFile(join(root, "rules", "broken.json"), "[", "utf-8");
}

async function writeCuratedSourceFixture(root: string): Promise<void> {
    await mkdir(root, {recursive: true});
    for (const fileName of CURATED_SOURCE_FILES) {
        await writeFile(join(root, fileName), "[]\n", "utf-8");
    }
    await writeFile(join(root, "轻量规则集1.2.json"), JSON.stringify([
        {
            name: "人体词汇",
            enabled: true,
            subRules: [{
                targets: ["头颅"],
                replacements: ["头", "脑袋"],
                mode: "text",
                remark: "头颅",
            }],
        },
        {
            name: "R18词汇",
            enabled: false,
            subRules: [{
                targets: ["乳房"],
                replacements: ["胸部"],
                mode: "text",
                remark: "R18 词汇",
            }],
        },
        {
            name: "由于删除",
            enabled: true,
            subRules: [{
                targets: ["由于(?:的|地|得)?"],
                replacements: [],
                mode: "regex",
                remark: "由于删除",
            }],
        },
    ], null, 2), "utf-8");
    await writeFile(join(root, "极其杀手.json"), JSON.stringify([
        {
            name: "极其删除",
            enabled: true,
            subRules: [{
                targets: ["极其{的,地,得}?"],
                replacements: [],
                mode: "simple",
                remark: "极其删除",
            }],
        },
    ], null, 2), "utf-8");
}

async function readRulesetRules(root: string): Promise<unknown[]> {
    const ruleFiles = (await listFiles(join(root, "rules")))
        .filter((file) => file.endsWith(".json"))
        .sort((left, right) => left.localeCompare(right));
    const rules = await Promise.all(ruleFiles.map(async (ruleFile) => {
        const source = await readFile(ruleFile, "utf-8");
        return JSON.parse(source) as unknown[];
    }));
    return rules.flat();
}

async function listFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, {withFileTypes: true});
    const files = await Promise.all(entries.map(async (entry) => {
        const entryPath = join(root, entry.name);
        if (entry.isDirectory()) {
            return listFiles(entryPath);
        }
        return [entryPath];
    }));
    return files.flat();
}

async function runFailedCommand(args: string[]): Promise<{code: number | null; stdout: string; stderr: string}> {
    try {
        await execFileAsync("bun", args, {
            encoding: "utf-8",
            timeout: 10000,
        });
    } catch (error) {
        const failed = error as {code?: number | null; stdout?: string; stderr?: string};
        return {
            code: failed.code ?? null,
            stdout: failed.stdout ?? "",
            stderr: failed.stderr ?? "",
        };
    }
    throw new Error("命令预期失败，但实际成功。");
}
