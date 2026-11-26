/**
 * 合同测试只经合同包认识被测系统（ADR 0059 决策 6）。“合同包之外的任何包”指被测系统的工作区包（两个模块、进程入口、前端）
 * 与它们带进来的第三方依赖；测试运行器、平台内置模块、测试支持包的临时目录与等待工具不在其内。允许清单与理由在
 * 本包的 `AGENTS.md`，这里照清单检查：
 * - 所有源文件（连同测试文件）只导入两个合同包、`typebox`（合同包的 schema 本身就是 TypeBox，用它核对响应的形状）、`bun:test`、
 *   `node:` 内置模块、测试支持包的 `/tmp`、`/wait` 与 `/oauth-upstream`（仿真的社交上游：它替的是第三方，不是被测系统）；
 * - `bun:sqlite` 只许出现在故障注入、备份核对与读聚合计数的辅助文件里：它们按 Spec 写明的数据目录布局直接碰库文件；
 * - 本文件另许测试支持包的 `/import-boundary`，它就是做这项检查的工具；
 * - 相对导入落在本包的 `src/` 里；
 * - 清单：运行时依赖只有两个合同包与 `typebox`；devDependencies 里的工作区包只有 `nb-site-server`（只为找到被测程序的启动命令与
 *   `test:affected` 的依赖图）与测试支持包。这条放在本包：改本包的清单时 nb-site-server 的测试选不中。
 * 被测程序的路径经 `import.meta.resolve("@notnotype/nb-site-server/package.json")` 找到，那是解析路径、不导入代码，这里不拦。
 * 扫描的写法与它的取舍见 `@notnotype/neuro-book-test-support/import-boundary`。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

import {offendingSpecifiers, type ImportRule} from "@notnotype/neuro-book-test-support/import-boundary";

interface Manifest {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
}

const SOURCE_ROOT = import.meta.dir;
const CONTRACTS = ["@notnotype/nb-site-identity-contract", "@notnotype/nb-site-telemetry-contract"];
/** 运行时依赖里合同包之外唯一许可的：读合同包的 schema 用。 */
const RUNTIME_EXTRA = ["typebox"];
const DEV_WORKSPACE = ["@notnotype/nb-site-server", "@notnotype/neuro-book-test-support"];

const BASE_PACKAGES = [/^@notnotype\/nb-site-(?:identity|telemetry)-contract$/u, /^typebox(?:\/value)?$/u, /^bun:test$/u, /^node:[a-z_/]+$/u, /^@notnotype\/neuro-book-test-support\/(?:tmp|wait|oauth-upstream)$/u];
/** 相对 `src/` 的路径；可以直接打开库文件的辅助文件。 */
const SQLITE_FILES = new Set(["testing/fault.ts", "testing/backup.ts", "testing/aggregate.ts"]);
const SELF = "boundary.test.ts";

function ruleFor(file: string): ImportRule {
    const path = relative(SOURCE_ROOT, file);
    const extra = SQLITE_FILES.has(path) ? [/^bun:sqlite$/u] : path === SELF ? [/^@notnotype\/neuro-book-test-support\/import-boundary$/u] : [];
    return {packages: [...BASE_PACKAGES, ...extra], within: SOURCE_ROOT};
}

/** `src/` 下的全部 `.ts`，连同测试文件：测试支持包的 `sourceFiles` 缺省跳过测试，而这里的测试文件正是要守的。 */
function allSources(): string[] {
    return readdirSync(SOURCE_ROOT, {withFileTypes: true, recursive: true})
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
        .map((entry) => join(entry.parentPath, entry.name));
}

/** 反例的源码文字由这里拼出：直接写成字面量，本文件自己的扫描会把它们当成真的导入。 */
function importStatement(specifier: string): string {
    return `import ${JSON.stringify(specifier)};`;
}

/** 越界的导入，写成 `相对 src 的路径: 说明符`。 */
function findings(files: readonly string[]): string[] {
    return files.flatMap((file) => offendingSpecifiers(file, readFileSync(file, "utf8"), ruleFor(file)).map((specifier) => `${relative(SOURCE_ROOT, file)}: ${specifier}`));
}

function manifestViolations(manifest: Manifest): string[] {
    const runtime = Object.keys(manifest.dependencies ?? {})
        .filter((name) => !CONTRACTS.includes(name) && !RUNTIME_EXTRA.includes(name))
        .map((name) => `dependencies -> ${name}`);
    const dev = Object.entries(manifest.devDependencies ?? {})
        .filter(([name, version]) => (version.startsWith("workspace:") || name.startsWith("@notnotype/")) && !DEV_WORKSPACE.includes(name))
        .map(([name]) => `devDependencies -> ${name}`);
    return [...runtime, ...dev];
}

describe("合同测试的导入边界", () => {
    it("每个源文件只导入合同包、测试运行器、内置模块与允许的测试工具", () => {
        const files = allSources();
        expect(files.length).toBeGreaterThan(0);
        expect(findings(files)).toEqual([]);
    });

    it("清单的运行时依赖只有两个合同包与 typebox，开发依赖里的工作区包只有被测程序与测试支持包", () => {
        expect(manifestViolations(JSON.parse(readFileSync(join(SOURCE_ROOT, "..", "package.json"), "utf8")) as Manifest)).toEqual([]);
    });

    it("反例：导入入口包或模块包、在别的文件里开库、跨包的相对导入都被拦下", () => {
        const helper = join(SOURCE_ROOT, "testing", "site.ts");
        expect(offendingSpecifiers(helper, importStatement("@notnotype/nb-site-server"), ruleFor(helper))).toEqual(["@notnotype/nb-site-server"]);
        expect(offendingSpecifiers(helper, importStatement("@notnotype/nb-site-identity"), ruleFor(helper))).toEqual(["@notnotype/nb-site-identity"]);
        expect(offendingSpecifiers(helper, importStatement("bun:sqlite"), ruleFor(helper))).toEqual(["bun:sqlite"]);
        expect(offendingSpecifiers(helper, importStatement("typebox/compile"), ruleFor(helper))).toEqual(["typebox/compile"]);
        expect(offendingSpecifiers(helper, importStatement("typebox/value"), ruleFor(helper))).toEqual([]);
        expect(offendingSpecifiers(helper, importStatement("@notnotype/neuro-book-test-support/oauth-upstream"), ruleFor(helper))).toEqual([]);
        expect(offendingSpecifiers(helper, importStatement("@notnotype/neuro-book-test-support/bun-sqlite"), ruleFor(helper))).toEqual(["@notnotype/neuro-book-test-support/bun-sqlite"]);
        expect(offendingSpecifiers(helper, importStatement("../../../nb-site-server/src/main"), ruleFor(helper))).toEqual(["../../../nb-site-server/src/main"]);
        const fault = join(SOURCE_ROOT, "testing", "fault.ts");
        expect(offendingSpecifiers(fault, importStatement("bun:sqlite"), ruleFor(fault))).toEqual([]);
        expect(manifestViolations({dependencies: {hono: "^4.12.30"}, devDependencies: {"@notnotype/nb-site-identity": "workspace:*", typescript: "^6.0.3"}})).toEqual([
            "dependencies -> hono",
            "devDependencies -> @notnotype/nb-site-identity",
        ]);
    });
});
