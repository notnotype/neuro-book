/**
 * 官方站各包的结构守卫：
 * - 依赖白名单（ADR 0059 决策 2）：合同包、模块包与本包各自能依赖哪些工作区包。第三方包不限；工作区里别的包要先加进
 *   `ALLOWED`，防止模块悄悄依赖上别的工作区实现。放在本包：模块包与合同包都是本包的依赖，改了它们的清单，
 *   `test:affected` 顺着依赖图会选中这里。合同测试包与前端包的清单各由它们自己的 `boundary.test.ts` 检查。
 * - `ATTACH` 守卫（ADR 0061 决策 1）：每个模块只打开自己的库文件，源码与迁移里不许出现附加别的库的语句。
 *   迁移运行器在执行前对迁移文字再查一次（`db/migrate.ts`），是同一条规则在运行期的第二道；它的拒收清单里写着这个词，不扫它。
 * - 两个模块的路径前缀互不重叠：入口按前缀把子应用挂在同一个站点地址上。
 * - 产品代码不引用 `src/testing/`：夹具模块与测试入口只给本包的测试用（`docs/testing/README.md` 的测试文件组织）。
 * - 本包的 `src/` 不导入前端包：前端包只在开发依赖里，给镜像的构建脚本找到前端的产物（`image/build.ts`，经
 *   `import.meta.resolve` 解析路径、不导入代码）；进程只在运行时从 `NB_SITE_WEB_DIR` 读产物。
 * 每条规则都带一个反例，证明它拦得下违规。
 */

import {describe, expect, it} from "bun:test";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";

import {offendingSpecifiers} from "@notnotype/neuro-book-test-support/import-boundary";
import {IDENTITY_API_PREFIX} from "@notnotype/nb-site-identity-contract";
import {TELEMETRY_API_PREFIX} from "@notnotype/nb-site-telemetry-contract";

interface Manifest {
    readonly name: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
}

interface DependencyRule {
    /** `dependencies` 里允许的工作区包。 */
    readonly dependencies: readonly string[];
    /** `devDependencies` 里允许的工作区包。 */
    readonly devDependencies: readonly string[];
    /** 给出时，`dependencies` 里的第三方包也只许这几个。 */
    readonly thirdParty?: readonly string[];
}

const TEST_SUPPORT = "@notnotype/neuro-book-test-support";
const IDENTITY_CONTRACT = "@notnotype/nb-site-identity-contract";
const TELEMETRY_CONTRACT = "@notnotype/nb-site-telemetry-contract";
const IDENTITY = "@notnotype/nb-site-identity";
const TELEMETRY = "@notnotype/nb-site-telemetry";
const SERVER = "@notnotype/nb-site-server";
const WEB = "@notnotype/nb-site-web";

const CONTRACT_RULE: DependencyRule = {dependencies: [], devDependencies: [TEST_SUPPORT], thirdParty: ["typebox"]};

/** 不许本包依赖合同测试包；前端包只许在开发依赖里（镜像的构建脚本要找到它的产物），源码导入它由“前端包”一组拦。 */
const ALLOWED: Readonly<Record<string, DependencyRule>> = {
    [IDENTITY_CONTRACT]: CONTRACT_RULE,
    [TELEMETRY_CONTRACT]: CONTRACT_RULE,
    [IDENTITY]: {dependencies: [IDENTITY_CONTRACT], devDependencies: [TEST_SUPPORT]},
    [TELEMETRY]: {dependencies: [TELEMETRY_CONTRACT], devDependencies: [TEST_SUPPORT]},
    [SERVER]: {dependencies: [IDENTITY, TELEMETRY, IDENTITY_CONTRACT, TELEMETRY_CONTRACT, "@notnotype/nb-flock"], devDependencies: [TEST_SUPPORT, WEB]},
};

/** 经包名解析清单，不按相对路径读兄弟包：包挪了目录也照样找得到。 */
function packageDirOf(name: string): string {
    return dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`)));
}

function manifestOf(name: string): Manifest {
    return JSON.parse(readFileSync(join(packageDirOf(name), "package.json"), "utf8")) as Manifest;
}

/**
 * 指向工作区包的条目：版本以 `workspace:` 开头（与治理检查同一判定），或包名在 `@notnotype/` 下。后一条防的是把版本写成
 * `^0.1.0`：Bun 照样把它链接到工作区里的同名包，只看 `workspace:` 会漏掉。
 */
function isWorkspaceDependency(name: string, version: string): boolean {
    return version.startsWith("workspace:") || name.startsWith("@notnotype/");
}

/** 清单里越出白名单的条目，写成 `包名 字段 -> 依赖`。 */
function dependencyViolations(manifest: Manifest, rule: DependencyRule): string[] {
    const violations: string[] = [];
    for (const field of ["dependencies", "devDependencies"] as const) {
        for (const [name, version] of Object.entries(manifest[field] ?? {})) {
            const allowed = isWorkspaceDependency(name, version) ? rule[field].includes(name) : field === "devDependencies" || rule.thirdParty === undefined || rule.thirdParty.includes(name);
            if (!allowed) violations.push(`${manifest.name} ${field} -> ${name}`);
        }
    }
    return violations;
}

const ATTACH = /\bATTACH\b/iu;

function stripTsComments(text: string): string {
    // 行注释只认行首或空白之后的 `//`，字符串里的网址不受影响；宁可把行尾注释里的词误报出来。
    return text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/(^|\s)\/\/.*$/gmu, "$1");
}

function stripSqlComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/--.*$/gmu, "");
}

/** 去掉注释后仍写着 `ATTACH` 的文件。 */
function attachFindings(files: readonly string[]): string[] {
    return files.filter((file) => ATTACH.test((file.endsWith(".sql") ? stripSqlComments : stripTsComments)(readFileSync(file, "utf8"))));
}

/** 迁移运行器在拒收清单里写着这个词：它就是运行期的那道检查，由 `db/migrate.test.ts` 证明它拒收附加语句。 */
const ATTACH_CHECKER = join(import.meta.dir, "db", "migrate.ts");

function tsSources(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true, recursive: true})
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
        .map((entry) => join(entry.parentPath, entry.name))
        .filter((file) => file !== ATTACH_CHECKER);
}

function sqlMigrations(packageDir: string): string[] {
    const directory = join(packageDir, "migrations");
    return existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".sql")).map((name) => join(directory, name)) : [];
}

describe("依赖白名单", () => {
    for (const [name, rule] of Object.entries(ALLOWED)) {
        it(`${name} 只依赖白名单里的工作区包`, () => {
            expect(dependencyViolations(manifestOf(name), rule)).toEqual([]);
        });
    }

    it("反例：模块依赖另一个模块、开发依赖带上别的工作区包、合同包带上别的第三方包都被拦下", () => {
        const identity: Manifest = {name: IDENTITY, dependencies: {[IDENTITY_CONTRACT]: "workspace:*", [TELEMETRY]: "workspace:*"}};
        expect(dependencyViolations(identity, ALLOWED[IDENTITY]!)).toEqual([`${IDENTITY} dependencies -> ${TELEMETRY}`]);
        const pinned: Manifest = {name: IDENTITY, dependencies: {[TELEMETRY]: "^0.1.0"}};
        expect(dependencyViolations(pinned, ALLOWED[IDENTITY]!)).toEqual([`${IDENTITY} dependencies -> ${TELEMETRY}`]);
        const devOnly: Manifest = {name: TELEMETRY, devDependencies: {[TEST_SUPPORT]: "workspace:*", "@notnotype/nb-runtime": "workspace:*"}};
        expect(dependencyViolations(devOnly, ALLOWED[TELEMETRY]!)).toEqual([`${TELEMETRY} devDependencies -> @notnotype/nb-runtime`]);
        const contract: Manifest = {name: IDENTITY_CONTRACT, dependencies: {typebox: "^1.3.6", hono: "^4.12.30"}};
        expect(dependencyViolations(contract, ALLOWED[IDENTITY_CONTRACT]!)).toEqual([`${IDENTITY_CONTRACT} dependencies -> hono`]);
    });
});

describe("ATTACH 守卫", () => {
    it("两个模块的源码与迁移、入口的源码里没有 ATTACH", () => {
        const files = [
            ...[IDENTITY, TELEMETRY].flatMap((name) => [...tsSources(join(packageDirOf(name), "src")), ...sqlMigrations(packageDirOf(name))]),
            ...tsSources(import.meta.dir),
        ];
        expect(files.length).toBeGreaterThan(0);
        expect(attachFindings(files).map((file) => relative(join(import.meta.dir, "..", ".."), file))).toEqual([]);
    });

    it("反例：语句里的 ATTACH 被拦下，注释里的不算", () => {
        expect(ATTACH.test(stripTsComments(`db.exec("attach database 'other.db' as other");`))).toBe(true);
        expect(ATTACH.test(stripSqlComments("ATTACH DATABASE 'other.db' AS other;"))).toBe(true);
        expect(ATTACH.test(stripTsComments("// 不许 ATTACH 别的库\n/* ATTACH */ const url = \"https://example.test\";"))).toBe(false);
        expect(ATTACH.test(stripSqlComments("-- 不许 ATTACH\nCREATE TABLE t (id INTEGER);"))).toBe(false);
    });
});

describe("路径前缀", () => {
    it("两个模块的前缀互不包含", () => {
        const identity: string = IDENTITY_API_PREFIX;
        const telemetry: string = TELEMETRY_API_PREFIX;
        expect(identity === telemetry || identity.startsWith(`${telemetry}/`) || telemetry.startsWith(`${identity}/`)).toBe(false);
    });
});

/** 从某个文件导入 `testing/` 下的模块：相对路径里出现 `testing` 这一段。 */
const TESTING_IMPORT = /\bfrom\s+["'](?:\.{1,2}\/)+(?:[^"']*\/)?testing\//u;

describe("夹具目录", () => {
    it("产品代码不引用 src/testing/", () => {
        const testingDir = join(import.meta.dir, "testing");
        const product = tsSources(import.meta.dir).filter((file) => !file.startsWith(`${testingDir}/`));
        expect(product.length).toBeGreaterThan(0);
        expect(product.filter((file) => TESTING_IMPORT.test(readFileSync(file, "utf8"))).map((file) => relative(import.meta.dir, file))).toEqual([]);
    });

    it("反例：相对路径导入 testing/ 被拦下，名字里带 testing 的别的模块不算", () => {
        expect(TESTING_IMPORT.test(`import {fixtureModules} from "./testing/modules";`)).toBe(true);
        expect(TESTING_IMPORT.test(`import {startSite} from "../testing/process";`)).toBe(true);
        expect(TESTING_IMPORT.test(`import {x} from "./load-testing";`)).toBe(false);
    });
});

/** 前端包（含子路径）以外的说明符都放行；相对导入不出本包。 */
const NO_WEB_IMPORT = {packages: [/^(?!@notnotype\/nb-site-web(?:\/|$))/u], within: join(import.meta.dir, "..")};

/** `src/` 下全部 `.ts`，连同测试文件：测试里导入前端包同样会把它拉进本包的依赖图。 */
function allSources(): string[] {
    return readdirSync(import.meta.dir, {withFileTypes: true, recursive: true})
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
        .map((entry) => join(entry.parentPath, entry.name));
}

/** 越界的导入，写成 `相对 src 的路径: 说明符`。 */
function webImports(files: readonly string[], read: (file: string) => string = (file) => readFileSync(file, "utf8")): string[] {
    return files.flatMap((file) => offendingSpecifiers(file, read(file), NO_WEB_IMPORT).map((specifier) => `${relative(import.meta.dir, file)}: ${specifier}`));
}

describe("前端包", () => {
    it("本包的 src/ 不导入前端包", () => {
        const files = allSources();
        expect(files.length).toBeGreaterThan(0);
        expect(webImports(files)).toEqual([]);
    });

    it("反例：静态导入、动态导入与子路径都被拦下，名字相近的别的包与解析路径不算", () => {
        // 说明符拼出来写：直接写成字面量，上一条的扫描会把本文件当成越界。
        const file = join(import.meta.dir, "web.ts");
        const offending = (text: string): string[] => webImports([file], () => text);
        expect(offending(`import {x} from "${WEB}";`)).toEqual([`web.ts: ${WEB}`]);
        expect(offending(`const page = await import("${WEB}/dist/index.html");`)).toEqual([`web.ts: ${WEB}/dist/index.html`]);
        expect(offending(`import "${WEB}/package.json";`)).toEqual([`web.ts: ${WEB}/package.json`]);
        const sibling = `${".."}/../nb-site-web/src/main`;
        expect(offending(`import {x} from "${WEB}-extras"; import {y} from "${sibling}";`)).toEqual([`web.ts: ${sibling}`]);
        expect(offending(`const dir = import.meta.resolve("${WEB}/package.json");`)).toEqual([]);
    });
});
