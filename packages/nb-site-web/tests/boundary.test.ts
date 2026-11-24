/**
 * 前端只经两个合同包认识后端（ADR 0059 决策 2、4）：清单与源码都不许出现两个模块包与进程入口包。前端直接导入模块的实现，
 * 模块拆成单独的服务或换语言重写时前端就跟着坏；合同包换语言后仍然留着。
 * 扫描的写法与它的取舍见 `@notnotype/neuro-book-test-support/import-boundary`。
 */

import {describe, expect, it} from "bun:test";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

import {offendingSpecifiers, type ImportRule} from "@notnotype/neuro-book-test-support/import-boundary";

const PACKAGE_ROOT = join(import.meta.dir, "..");
const FORBIDDEN = /^@notnotype\/nb-site-(?:identity|telemetry|server)(?:\/|$)/u;
/** 禁止清单写成允许规则：除了被禁止的三个包，导入什么都行。 */
const RULE: ImportRule = {packages: [new RegExp(`^(?!${FORBIDDEN.source.slice(1)}).*$`, "u")], within: PACKAGE_ROOT};

interface Manifest {
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
}

/** `src/` 与 `tests/` 下的源文件，连同测试文件：测试支持包的 `sourceFiles` 缺省跳过测试。`src/` 在前端骨架落地前还不存在。 */
function allSources(): string[] {
    return ["src", "tests"]
        .map((name) => join(PACKAGE_ROOT, name))
        .filter((directory) => existsSync(directory))
        .flatMap((directory) => readdirSync(directory, {withFileTypes: true, recursive: true}))
        .filter((entry) => entry.isFile() && /\.(?:ts|vue)$/u.test(entry.name))
        .map((entry) => join(entry.parentPath, entry.name));
}

/** 反例的源码文字由这里拼出：直接写成字面量，本文件自己的扫描会把它们当成真的导入。 */
function importStatement(specifier: string): string {
    return `import ${JSON.stringify(specifier)};`;
}

function manifestViolations(manifest: Manifest): string[] {
    return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})].filter((name) => FORBIDDEN.test(name));
}

describe("前端的依赖边界", () => {
    it("清单不依赖两个模块包与进程入口包", () => {
        expect(manifestViolations(JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as Manifest)).toEqual([]);
    });

    it("源码与测试不导入两个模块包与进程入口包", () => {
        const files = allSources();
        expect(files.length).toBeGreaterThan(0);
        expect(files.flatMap((file) => offendingSpecifiers(file, readFileSync(file, "utf8"), RULE).map((specifier) => `${relative(PACKAGE_ROOT, file)}: ${specifier}`))).toEqual([]);
    });

    it("反例：导入模块包或进程入口包被拦下，导入合同包不算", () => {
        const file = join(PACKAGE_ROOT, "src", "main.ts");
        expect(offendingSpecifiers(file, importStatement("@notnotype/nb-site-identity"), RULE)).toEqual(["@notnotype/nb-site-identity"]);
        expect(offendingSpecifiers(file, importStatement("@notnotype/nb-site-server/package.json"), RULE)).toEqual(["@notnotype/nb-site-server/package.json"]);
        expect(offendingSpecifiers(file, importStatement("@notnotype/nb-site-identity-contract"), RULE)).toEqual([]);
        expect(manifestViolations({dependencies: {"@notnotype/nb-site-telemetry": "workspace:*", "@notnotype/nb-site-telemetry-contract": "workspace:*"}})).toEqual(["@notnotype/nb-site-telemetry"]);
    });
});
