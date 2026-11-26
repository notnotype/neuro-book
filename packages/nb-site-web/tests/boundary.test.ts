/**
 * 前端只经两个合同包认识后端（ADR 0059 决策 2、4）：前端直接导入模块的实现，模块拆成单独的服务或换语言重写时前端就跟着坏；
 * 合同包换语言后仍然留着。按白名单检查，规则与理由在本包的 `AGENTS.md`，与合同测试包的 `boundary.test.ts` 同一种写法：
 * 以后新增的模块包、应用包、内核包不在名单上，进前端就失败，不用等谁想起来改禁止名单。
 *
 * - `src/` 的源码（`.ts`、`.vue`，连同将来放在这里的组件测试）：`@notnotype/*` 只许 nb-ui（含子路径）、账号合同包的 `./constants`
 *   与统计合同包（含子路径），第三方包不限；不许 `bun:`、`node:`，它们在浏览器里没有，要到构建或运行时才失败。账号合同包的
 *   入口 `.` 带着全部 schema 与 TypeBox 的运行时，只取一个常量也会整个打进访客的入口块（B2 审查第 11 条，量过）。
 * - `src/` 的样式：`@import` 的包照上一条；`@source` 的相对路径不出本包。样式里的 `@import` 能把别的包的源码带进来。
 * - `tests/`、`e2e/`（Playwright，由 Node 跑）与包根的 `vite.config.ts`、`vitest.config.ts`：跑在 Bun 或 Node 里，另许 `bun:`、`node:`
 *   与测试支持包。
 * - 相对导入不出本包。
 * - 清单：`dependencies`（及 `peerDependencies`、`optionalDependencies`）里的工作区包只许 nb-ui 与两个合同包，
 *   `devDependencies` 里的只许测试支持包。
 *
 * 扫描的写法与它的取舍见 `@notnotype/neuro-book-test-support/import-boundary`。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

import {offendingSpecifiers, type ImportRule} from "@notnotype/neuro-book-test-support/import-boundary";

const PACKAGE_ROOT = join(import.meta.dir, "..");

/** 浏览器代码能导入的工作区包：nb-ui 与统计合同包含子路径，账号合同包只许不带 schema 的 `./constants`。 */
const BROWSER_WORKSPACE = /^@notnotype\/(?:(?:nb-ui|nb-site-telemetry-contract)(?:\/|$)|nb-site-identity-contract\/constants$)/u;
/** 跑在 Bun 或 Node 里的测试与配置能导入的工作区包（含子路径）：fixture 要用账号合同的 schema 检查形状。 */
const FRONTEND_WORKSPACE = /^@notnotype\/(?:nb-ui|nb-site-identity-contract|nb-site-telemetry-contract)(?:\/|$)/u;
/** 工作区包与平台内置模块以外的说明符，即第三方包。 */
const THIRD_PARTY = /^(?!@notnotype\/|bun:|node:)/u;
const BROWSER_RULE: ImportRule = {packages: [BROWSER_WORKSPACE, THIRD_PARTY], within: PACKAGE_ROOT};
const BUN_RULE: ImportRule = {packages: [FRONTEND_WORKSPACE, THIRD_PARTY, /^bun:[a-z]+$/u, /^node:[a-z_/]+$/u, /^@notnotype\/neuro-book-test-support\/[a-z-]+$/u], within: PACKAGE_ROOT};

const RUNTIME_WORKSPACE = ["@notnotype/nb-ui", "@notnotype/nb-site-identity-contract", "@notnotype/nb-site-telemetry-contract"];
const DEV_WORKSPACE = ["@notnotype/neuro-book-test-support"];

interface Manifest {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
    readonly optionalDependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
}

function filesUnder(directory: string, pattern: RegExp): string[] {
    return readdirSync(join(PACKAGE_ROOT, directory), {withFileTypes: true, recursive: true})
        .filter((entry) => entry.isFile() && pattern.test(entry.name))
        .map((entry) => join(entry.parentPath, entry.name));
}

/** 要扫的文件与各自的规则：`src/` 下的照浏览器的规则，`tests/`、`e2e/` 与两个构建配置照 Bun 的。 */
function scannedFiles(): {readonly file: string; readonly rule: ImportRule}[] {
    return [
        ...filesUnder("src", /\.(?:ts|vue|css)$/u).map((file) => ({file, rule: BROWSER_RULE})),
        ...filesUnder("tests", /\.ts$/u).map((file) => ({file, rule: BUN_RULE})),
        ...filesUnder("e2e", /\.ts$/u).map((file) => ({file, rule: BUN_RULE})),
        {file: join(PACKAGE_ROOT, "vite.config.ts"), rule: BUN_RULE},
        {file: join(PACKAGE_ROOT, "vitest.config.ts"), rule: BUN_RULE},
    ];
}

/** 反例的源码文字由这里拼出：直接写成字面量，本文件自己的扫描会把它们当成真的导入。 */
function importStatement(specifier: string): string {
    return `import ${JSON.stringify(specifier)};`;
}

/** 样式里的一条 `@import`、`@source`；同上，拼出来，免得本文件的扫描把它当成导入。 */
function cssRule(at: "import" | "source", specifier: string): string {
    return `@${at} ${JSON.stringify(specifier)};`;
}

/**
 * 一份源码里越界的说明符。样式文件里的 `@import`、`@source`（含 `@source not`）先改写成导入语句，再与脚本同样判断：
 * 包名照规则查，相对路径（`@source` 的通配写法也是）解析后不能出本包。
 */
function offending(file: string, text: string, rule: ImportRule): string[] {
    if (!file.endsWith(".css")) return offendingSpecifiers(file, text, rule);
    const specifiers = [...text.matchAll(/@(?:import|source)\s+(?:not\s+)?["']([^"']+)["']/gu)].map((match) => match[1]!);
    return offendingSpecifiers(file, specifiers.map(importStatement).join("\n"), rule);
}

function findings(): string[] {
    return scannedFiles().flatMap(({file, rule}) => offending(file, readFileSync(file, "utf8"), rule).map((specifier) => `${relative(PACKAGE_ROOT, file)}: ${specifier}`));
}

/** 清单里不在名单上的工作区包，写成 `字段 -> 包名`。`workspace:` 版本与 `@notnotype/` 名字都算工作区包。 */
function manifestViolations(manifest: Manifest): string[] {
    const workspace = (field: keyof Manifest, allowed: readonly string[]): string[] =>
        Object.entries(manifest[field] ?? {})
            .filter(([name, version]) => (version.startsWith("workspace:") || name.startsWith("@notnotype/")) && !allowed.includes(name))
            .map(([name]) => `${field} -> ${name}`);
    return [
        ...workspace("dependencies", RUNTIME_WORKSPACE),
        ...workspace("peerDependencies", RUNTIME_WORKSPACE),
        ...workspace("optionalDependencies", RUNTIME_WORKSPACE),
        ...workspace("devDependencies", DEV_WORKSPACE),
    ];
}

describe("前端的依赖边界", () => {
    it("清单里的工作区包只有 nb-ui、两个合同包与测试支持包", () => {
        expect(manifestViolations(JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as Manifest)).toEqual([]);
    });

    it("源码、样式、测试与构建配置只导入名单上的工作区包与第三方包；浏览器代码不导入平台内置模块", () => {
        expect(scannedFiles().filter(({file}) => file.endsWith(".css")).length).toBeGreaterThan(0);
        expect(findings()).toEqual([]);
    });

    it("反例：别的工作区包、浏览器代码里的平台内置模块与账号合同包的整包入口、样式里导入别的包都被拦下；nb-ui、合同包允许的入口与第三方包不算", () => {
        const main = join(PACKAGE_ROOT, "src", "main.ts");
        const blocked = [
            "@notnotype/nb-site-identity",
            "@notnotype/nb-site-server/package.json",
            "@notnotype/nb-site-billing",
            "@notnotype/neuro-book",
            "@notnotype/nb-runtime",
            "@notnotype/nb-site-contract-tests",
            "bun:sqlite",
            "node:fs",
            "@notnotype/nb-site-identity-contract",
            "@notnotype/nb-site-identity-contract/src/fields",
        ];
        for (const specifier of blocked) expect({specifier, offending: offendingSpecifiers(main, importStatement(specifier), BROWSER_RULE)}).toEqual({specifier, offending: [specifier]});
        for (const specifier of ["@notnotype/nb-ui/theme", "@notnotype/nb-site-identity-contract/constants", "@notnotype/nb-site-telemetry-contract", "vue"]) {
            expect({specifier, offending: offendingSpecifiers(main, importStatement(specifier), BROWSER_RULE)}).toEqual({specifier, offending: []});
        }
        const test = join(PACKAGE_ROOT, "tests", "build.test.ts");
        expect(offendingSpecifiers(test, importStatement("node:fs/promises"), BUN_RULE)).toEqual([]);
        expect(offendingSpecifiers(test, importStatement("@notnotype/nb-site-identity-contract"), BUN_RULE)).toEqual([]);
        expect(offendingSpecifiers(test, importStatement("@notnotype/neuro-book"), BUN_RULE)).toEqual(["@notnotype/neuro-book"]);

        const css = join(PACKAGE_ROOT, "src", "app.css");
        const cssText = [cssRule("import", "@notnotype/neuro-book/web/tailwind.css"), cssRule("source", "../../neuro-book/src"), cssRule("import", "tailwindcss")].join("\n");
        expect(offending(css, cssText, BROWSER_RULE)).toEqual([
            "@notnotype/neuro-book/web/tailwind.css",
            "../../neuro-book/src",
        ]);

        expect(manifestViolations({dependencies: {"@notnotype/nb-site-telemetry": "workspace:*", "@notnotype/nb-site-telemetry-contract": "workspace:*", vue: "^3"}})).toEqual([
            "dependencies -> @notnotype/nb-site-telemetry",
        ]);
        expect(manifestViolations({devDependencies: {"@notnotype/nb-runtime": "workspace:*"}, peerDependencies: {"@notnotype/neuro-book": "workspace:*"}})).toEqual([
            "peerDependencies -> @notnotype/neuro-book",
            "devDependencies -> @notnotype/nb-runtime",
        ]);
    });
});
