/**
 * 测试文件的机检规则，对应 docs/testing/README.md 的“测试写法”。只看源码文本，查得出的是写法，
 * 查不出测试是否在测行为；后者靠审查。
 *
 * 新应用与内核包违反即失败（v2 代码从一开始就守规则）；其它包给警告，按改动范围逐条列出。
 * 有理由的例外在同一行或上一行写 `test-lint-allow <规则>: <理由>`，理由不能为空；整个文件都是样例
 * （例如本规则自己的测试）时在文件开头写 `test-lint-allow-file: <理由>`。
 */

import {existsSync, readFileSync} from "node:fs";
import {resolve} from "node:path";

import {git} from "#scripts/ci/agent-governance-contract";
import type {FileWarning} from "#scripts/ci/change-scope";

export type TestRule = "module-mock" | "spy" | "fixed-wait" | "focus-or-skip" | "snapshot" | "llm-credential";

export type TestConventionFinding = {path: string; line: number; rule: TestRule; detail: string};

export const STRICT_TEST_ROOTS: readonly string[] = ["packages/neuro-book/", "packages/nb-runtime/"];
// 只读的旧应用与历史记录不检查。
const SKIPPED_ROOTS: readonly string[] = ["packages/neuro-book-legacy/", "docs/archived/", ".agents/tasks/"];

const LLM_TEST_FILE = /\.llm\.test\.tsx?$/u;
// 让出一轮事件循环（延迟为 0）不是按时长等待。
const ZERO_DELAY = /\bBun\.sleep\(\s*0\s*\)|\bsetTimeout\([^()]*(?:\([^()]*\)[^()]*)*,\s*0\s*\)/u;

type Rule = {
    readonly rule: TestRule;
    readonly pattern: RegExp;
    readonly detail: string;
    readonly applies?: (path: string) => boolean;
    readonly exempt?: (line: string) => boolean;
};

const RULES: readonly Rule[] = [
    {
        rule: "module-mock",
        pattern: /\bmock\.module\(|\b(?:vi|jest)\.(?:mock|doMock)\(/u,
        detail: "替换整个模块：改用真实实现，或注入与真实实现对过契约的替身",
    },
    {
        rule: "spy",
        pattern: /\bspyOn\(/u,
        detail: "spyOn 断言的是内部调用：改为断言可观察的结果",
    },
    {
        rule: "fixed-wait",
        pattern: /\bBun\.sleep(?:Sync)?\(|\bsetTimeout\(/u,
        exempt: (line) => ZERO_DELAY.test(line),
        detail: "按固定时长等待：等可观察的状态（test-support 的 waitUntil）或注入时钟",
    },
    {
        rule: "focus-or-skip",
        pattern: /\b(?:it|test|describe)\.(?:only|skip|todo)\b|\b(?:fit|fdescribe|xit|xdescribe|xtest)\(/u,
        detail: "only、skip、todo 让测试悄悄不跑：按条件跳过用 skipIf 或 runIf",
    },
    {
        rule: "snapshot",
        pattern: /\.toMatch(?:Inline)?Snapshot\(|\.toThrowErrorMatching(?:Inline)?Snapshot\(/u,
        detail: "快照随实现细节变化：断言具体的可观察字段",
    },
    {
        rule: "llm-credential",
        pattern: /(?:process\.env|Bun\.env|import\.meta\.env)(?:\.|\[["'`])[A-Z0-9_]*(?:API_KEY|_TOKEN|_SECRET)\b|\bllmTestConfig\(/u,
        applies: (path) => !LLM_TEST_FILE.test(path),
        detail: "读取模型凭据的测试放在 *.llm.test.ts，由 test:llm 显式运行",
    },
];

const ALLOW_MARKER = /test-lint-allow\s+([a-z-]+(?:\s*,\s*[a-z-]+)*)\s*[:：]\s*\S/u;
const ALLOW_FILE_MARKER = /^\s*\/\/\s*test-lint-allow-file\s*[:：]\s*\S/u;

function allowedRules(line: string | undefined): ReadonlySet<string> {
    const match = line === undefined ? null : ALLOW_MARKER.exec(line);
    return new Set(match === null ? [] : (match[1] as string).split(",").map((rule) => rule.trim()));
}

function isCommentLine(line: string): boolean {
    return /^\s*(?:\/\/|\/\*|\*)/u.test(line);
}

/** 逐行检查一个测试文件；`path` 用于判断规则是否适用。 */
export function scanTestSource(path: string, text: string): TestConventionFinding[] {
    const findings: TestConventionFinding[] = [];
    const lines = text.split(/\r?\n/u);
    if (lines.slice(0, 5).some((line) => ALLOW_FILE_MARKER.test(line))) return findings;
    lines.forEach((line, index) => {
        if (isCommentLine(line)) return;
        const allowed = new Set([...allowedRules(line), ...allowedRules(lines[index - 1])]);
        for (const rule of RULES) {
            if (allowed.has(rule.rule) || rule.applies?.(path) === false) continue;
            if (!rule.pattern.test(line) || rule.exempt?.(line) === true) continue;
            findings.push({path, line: index + 1, rule: rule.rule, detail: rule.detail});
        }
    });
    return findings;
}

/** 严格包里的违反是失败，其余是警告。 */
export function partitionTestFindings(findings: readonly TestConventionFinding[]): {failures: string[]; warnings: FileWarning[]} {
    const failures: string[] = [];
    const warnings: FileWarning[] = [];
    for (const finding of findings) {
        const where = `${finding.path}:${String(finding.line)}`;
        if (STRICT_TEST_ROOTS.some((root) => finding.path.startsWith(root))) {
            failures.push(`测试规则 ${finding.rule}：${where} ${finding.detail}`);
        } else {
            warnings.push({path: finding.path, label: `测试规则 ${finding.rule}`, detail: `${where} ${finding.detail}`});
        }
    }
    return {failures, warnings};
}

/** 仓库里已跟踪与未跟踪（未被忽略）的测试文件。 */
export function testFiles(repoRoot: string): string[] {
    return git(repoRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "--", "packages", "scripts"])
        .split(/\r?\n/u)
        .filter((path) => /\.test\.tsx?$/u.test(path) && !path.includes("/node_modules/"))
        .filter((path) => !SKIPPED_ROOTS.some((root) => path.startsWith(root)))
        .sort();
}

export function testConventionReport(repoRoot: string): {failures: string[]; warnings: FileWarning[]} {
    const findings: TestConventionFinding[] = [];
    for (const path of testFiles(repoRoot)) {
        const absolute = resolve(repoRoot, path);
        if (!existsSync(absolute)) continue;
        findings.push(...scanTestSource(path, readFileSync(absolute, "utf8")));
    }
    return partitionTestFindings(findings);
}
