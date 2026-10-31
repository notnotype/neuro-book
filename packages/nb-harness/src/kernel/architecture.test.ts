/**
 * 新内核的目录边界（t20 计划“分层与依赖”）：目录之间只单向依赖；只用相对导入、不引用 `kernel/` 之外的旧文件
 * （删旧实现后整体上移一层不改导入）；`node:fs` 只在 `log/`，OMP 的包只在 `model/`；产品代码不引用 `testing/`。
 * 类型检查与打包不会拦住这些，所以用 TypeScript 语法树逐个读出导入语句检查。
 *
 * 测试文件与 `testing/` 不受目录表约束（它们要搭真实存储与运行环境），但同样不能引禁止的包、不能用 CommonJS。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import ts from "typescript";

const KERNEL = import.meta.dir;

interface DirectoryRule {
    /** 可以依赖的其它目录；表本身就是分层。 */
    readonly dependsOn: readonly string[];
    /** 可以引用的外部包（typebox 处处可用）。 */
    readonly packages: readonly string[];
    /** 可以使用的 Node 与 Bun 内置模块。 */
    readonly builtins: readonly string[];
}

const OMP = ["@oh-my-pi/pi-ai", "@oh-my-pi/pi-catalog", "@oh-my-pi/pi-utils"];
const CRYPTO = ["node:crypto"];

// 新增目录时先在这里登记，否则边界测试失败。`compaction` 依赖 `run` 的通用拦截链；`run` 的循环经 `SessionCore` 上注入的回调
// 触发压缩，不反向依赖 `compaction`（`session/` 负责接线）。
const DIRECTORIES: Readonly<Record<string, DirectoryRule>> = {
    api: {dependsOn: [], packages: [], builtins: []},
    log: {dependsOn: ["api"], packages: [], builtins: ["node:fs", "node:fs/promises", "node:path", "node:crypto", "node:os"]},
    state: {dependsOn: ["api"], packages: [], builtins: CRYPTO},
    extension: {dependsOn: ["api", "state"], packages: [], builtins: CRYPTO},
    view: {dependsOn: ["api", "state", "extension"], packages: [], builtins: CRYPTO},
    dispatch: {dependsOn: ["api", "log", "state", "extension", "view"], packages: [], builtins: CRYPTO},
    run: {dependsOn: ["api", "log", "state", "extension", "view", "dispatch"], packages: [], builtins: CRYPTO},
    compaction: {dependsOn: ["api", "log", "state", "extension", "view", "dispatch", "run"], packages: [], builtins: CRYPTO},
    model: {dependsOn: ["api"], packages: OMP, builtins: []},
    session: {dependsOn: ["api", "log", "state", "extension", "view", "dispatch", "run", "compaction", "model"], packages: [], builtins: CRYPTO},
    helpers: {dependsOn: ["api", "extension", "view"], packages: [], builtins: []},
    testing: {dependsOn: [], packages: [], builtins: []},
};
const EVERYWHERE = ["typebox"];
const FORBIDDEN_PACKAGES = ["@oh-my-pi/pi-coding-agent", "@oh-my-pi/pi-agent-core"];

interface ImportUse {
    readonly file: string;
    readonly specifier: string | null;
    readonly kind: "static" | "dynamic" | "require";
}

function allFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return allFiles(path);
        return /\.tsx?$/u.test(entry.name) ? [path] : [];
    });
}

const isTestSupport = (pathInKernel: string): boolean => /\.test\.tsx?$/u.test(pathInKernel) || pathInKernel.split("/")[0] === "testing";

function literalText(node: ts.Node | undefined): string | null {
    return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}

function importsOf(file: string): ImportUse[] {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const at = relative(KERNEL, file);
    const uses: ImportUse[] = [];
    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
            uses.push({file: at, specifier: literalText(node.moduleSpecifier), kind: "static"});
        } else if (ts.isImportTypeNode(node)) {
            const argument = node.argument;
            uses.push({file: at, specifier: ts.isLiteralTypeNode(argument) ? literalText(argument.literal) : null, kind: "static"});
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            uses.push({file: at, specifier: literalText(node.arguments[0]), kind: "dynamic"});
        } else if (ts.isImportEqualsDeclaration(node) || (ts.isIdentifier(node) && (node.text === "require" || node.text === "createRequire") && ts.isCallExpression(node.parent))) {
            uses.push({file: at, specifier: null, kind: "require"});
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return uses;
}

/** `kernel/<目录>/…` 的目录名；`kernel/` 根上的入口文件返回 null。 */
const directoryOf = (pathInKernel: string): string | null => (pathInKernel.includes("/") ? (pathInKernel.split("/")[0] ?? null) : null);

function packageName(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : (parts[0] as string);
}

/** 对全部文件生效：禁止的包、CommonJS。 */
function universalViolation(use: ImportUse): string | null {
    if (use.kind === "require") return `${use.file} 用了 CommonJS 加载`;
    if (use.specifier !== null && FORBIDDEN_PACKAGES.includes(packageName(use.specifier))) return `${use.file} 引用了禁止的包 ${use.specifier}`;
    return null;
}

/** 只对产品代码生效：目录表。 */
function directoryViolation(use: ImportUse): string | null {
    const specifier = use.specifier;
    if (use.kind === "dynamic") return `${use.file} 使用了动态导入`;
    if (specifier === null) return null;
    const from = directoryOf(use.file);
    if (specifier.startsWith(".")) {
        const target = relative(KERNEL, resolve(KERNEL, dirname(use.file), specifier));
        if (target.startsWith("..")) return `${use.file} 引用了 kernel/ 之外的文件 ${specifier}`;
        if (isTestSupport(target)) return `${use.file} 是产品代码，引用了测试支持 ${target}`;
        const to = directoryOf(target);
        if (to === null) return from === null ? null : `${use.file} 引用了 kernel/ 根上的入口 ${target}`;
        if (from === null || from === to) return null;
        return DIRECTORIES[from]?.dependsOn.includes(to) ? null : `${use.file} 依赖了不允许的目录 ${to}`;
    }
    if (specifier.startsWith("node:") || specifier.startsWith("bun:")) {
        const allowed = from === null ? [] : (DIRECTORIES[from]?.builtins ?? []);
        return allowed.includes(specifier) ? null : `${use.file} 使用了内置模块 ${specifier}；${from ?? "kernel/ 根"} 不允许`;
    }
    const name = packageName(specifier);
    if (name === "@notnotype/nb-harness") return `${use.file} 经包名引用了本包，kernel/ 内只用相对导入`;
    const allowed = [...EVERYWHERE, ...(from === null ? [] : (DIRECTORIES[from]?.packages ?? []))];
    return allowed.includes(name) ? null : `${use.file} 引用了目录表未登记的包 ${specifier}`;
}

describe("nb-harness 新内核的目录边界", () => {
    const files = allFiles(KERNEL);
    const uses = files.flatMap(importsOf);
    const directories = readdirSync(KERNEL, {withFileTypes: true}).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

    it("kernel/ 下每个目录都在目录表里登记", () => {
        expect(directories.filter((name) => DIRECTORIES[name] === undefined)).toEqual([]);
    });

    it("全部文件：不引禁止的包、不用 CommonJS", () => {
        expect(uses.map(universalViolation).filter((problem) => problem !== null)).toEqual([]);
    });

    it("产品代码：只单向依赖、只用相对导入、只按表引用外部包与内置模块、不引测试支持", () => {
        const problems = uses.filter((use) => !isTestSupport(use.file)).map(directoryViolation).filter((problem) => problem !== null);
        expect(problems).toEqual([]);
    });

    it("目录表的依赖没有环", () => {
        const done = new Set<string>();
        const cycles: string[] = [];
        const visit = (name: string, path: readonly string[]): void => {
            if (path.includes(name)) {
                cycles.push([...path, name].join(" → "));
                return;
            }
            if (done.has(name)) return;
            for (const next of DIRECTORIES[name]?.dependsOn ?? []) visit(next, [...path, name]);
            done.add(name);
        };
        for (const name of Object.keys(DIRECTORIES)) visit(name, []);
        expect(cycles).toEqual([]);
    });

    it("检查本身认得出违规的写法", () => {
        const probe = (file: string, specifier: string): string | null => directoryViolation({file, specifier, kind: "static"});
        expect(probe("api/x.ts", "../log/store.js")).toContain("不允许的目录");
        expect(probe("view/x.ts", "node:fs")).toContain("内置模块");
        expect(probe("run/x.ts", "@oh-my-pi/pi-ai")).toContain("未登记的包");
        expect(probe("run/x.ts", "../../harness.js")).toContain("kernel/ 之外");
        expect(probe("session/x.ts", "../testing/session.js")).toContain("测试支持");
        expect(probe("model/x.ts", "@oh-my-pi/pi-ai")).toBeNull();
        expect(universalViolation({file: "model/x.ts", specifier: "@oh-my-pi/pi-agent-core", kind: "static"})).toContain("禁止的包");
    });
});
