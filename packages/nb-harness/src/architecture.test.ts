/**
 * 包内模块边界（packages/nb-harness/AGENTS.md 的“模块与依赖”）：模块之间只单向依赖，只经对方的公开入口
 * （`package.json` 的 `exports` 指向的文件）；OMP 只按表中允许的方式引用；只有登记了的目录能用 Node 内置模块与动态导入；
 * 新模块不引旧原型，旧原型也不引新模块。类型检查与打包不会拦住这些，所以用 TypeScript 语法树逐个读出导入语句检查。
 *
 * 规则的适用范围：禁止的包、CommonJS 加载、旧原型隔离对全部源码与测试生效；模块表（依赖、外部包、Node 内置模块、
 * 动态导入）只约束模块的产品代码，测试文件与 `testing/` 目录不受模块表约束，因为它们要搭真实存储与运行环境；
 * 反过来产品代码不能引用 `testing/`。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import ts from "typescript";

const SRC = import.meta.dir;
const PACKAGE_NAME = "@notnotype/nb-harness";
const PACKAGE_JSON = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8")) as {readonly exports: Record<string, string>};
const PROTOTYPE = "prototype";

type ExternalRule = "runtime" | "type-only";

interface ModuleRule {
    /** 可以依赖的其它模块；依赖只能单向，表本身就是分层。 */
    readonly modules: readonly string[];
    /** 可以引用的外部包；`type-only` 表示只能 `import type`。 */
    readonly packages: Readonly<Record<string, ExternalRule>>;
    /** 可以使用 Node 内置模块的子目录（相对模块目录）；只有声明了 I/O 的子入口在这里。 */
    readonly nodeBuiltinsIn: readonly string[];
    /** 可以动态导入的子目录：只有会执行外部模块代码的子入口在这里，目标可以是运行时才知道的路径。 */
    readonly dynamicImportIn: readonly string[];
}

const TYPEBOX = {typebox: "runtime"} as const;

// 新增模块时先在这里登记，否则边界测试失败；规划中的模块与分层见 docs/proposals/agent-harness-kernel.md 的“模块划分与推进顺序”。
const MODULES: Readonly<Record<string, ModuleRule>> = {
    session: {
        modules: [],
        packages: {...TYPEBOX, "@oh-my-pi/pi-agent-core": "type-only", "@oh-my-pi/pi-ai": "type-only"},
        nodeBuiltinsIn: ["jsonl"],
        dynamicImportIn: [],
    },
    profile: {
        modules: [],
        packages: {...TYPEBOX, "@oh-my-pi/pi-ai": "type-only"},
        nodeBuiltinsIn: ["loader"],
        dynamicImportIn: ["loader"],
    },
};

const FORBIDDEN_PACKAGES = ["@oh-my-pi/pi-coding-agent"];

type ImportKind = "static" | "dynamic" | "require";

interface ImportUse {
    readonly file: string;
    /** 导入目标；动态导入或 require 的参数不是字符串字面量时为 null。 */
    readonly specifier: string | null;
    readonly typeOnly: boolean;
    readonly kind: ImportKind;
}

function allFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return allFiles(path);
        return /\.tsx?$/u.test(entry.name) ? [path] : [];
    });
}

/** 测试文件与 `testing/` 目录下的文件：不受模块表约束。 */
function isTestSupport(pathInSrc: string): boolean {
    return /\.test\.tsx?$/u.test(pathInSrc) || pathInSrc.split("/").includes("testing");
}

function literalText(node: ts.Node | undefined): string | null {
    return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}

const COMMONJS_LOADERS = new Set(["require", "createRequire"]);

/** 引用了 CommonJS 加载函数的表达式：`require`、`createRequire` 标识符，`module.require`、`import.meta.require`。 */
function isCommonJsLoader(node: ts.Node): boolean {
    if (ts.isPropertyAccessExpression(node)) {
        if (node.name.text !== "require") return false;
        const object = node.expression;
        return (ts.isIdentifier(object) && object.text === "module") || ts.isMetaProperty(object);
    }
    if (!ts.isIdentifier(node) || !COMMONJS_LOADERS.has(node.text)) return false;
    // 属性名、对象字面量的键与声明的名字不是引用。
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
    if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)
        || ts.isPropertyDeclaration(parent) || ts.isMethodSignature(parent)) && parent.name === node) return false;
    return true;
}

function importsOf(file: string): ImportUse[] {
    const text = readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const at = relative(SRC, file);
    const uses: ImportUse[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
            uses.push({file: at, specifier: literalText(node.moduleSpecifier), typeOnly: node.importClause?.isTypeOnly === true, kind: "static"});
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
            uses.push({file: at, specifier: literalText(node.moduleSpecifier), typeOnly: node.isTypeOnly, kind: "static"});
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            uses.push({file: at, specifier: literalText(node.moduleReference.expression), typeOnly: node.isTypeOnly, kind: "require"});
        } else if (ts.isImportTypeNode(node)) {
            const argument = node.argument;
            const specifier = ts.isLiteralTypeNode(argument) ? literalText(argument.literal) : null;
            uses.push({file: at, specifier, typeOnly: true, kind: "static"});
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            uses.push({file: at, specifier: literalText(node.arguments[0]), typeOnly: false, kind: "dynamic"});
        } else if (isCommonJsLoader(node)) {
            // 只认调用会漏掉 `const load = require`、`module.require(…)` 这类间接写法，所以凡是引用到加载函数都算。
            const call = node.parent;
            const direct = ts.isCallExpression(call) && call.expression === node && ts.isIdentifier(node) && node.text === "require";
            uses.push({file: at, specifier: direct ? literalText(call.arguments[0]) : null, typeOnly: false, kind: "require"});
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return uses;
}

/** 去掉源码与 Bun/TypeScript 可解析的产物扩展名，统一成 src 内不带扩展名的路径。 */
const stripExtension = (path: string): string => path.replace(/\.(tsx?|jsx?|mjs|cjs)$/u, "");

/** 包名自引用的子路径对应的源码（相对 src、不带扩展名）；子路径没有导出时为 undefined。 */
const EXPORT_TARGETS = new Map(
    Object.entries(PACKAGE_JSON.exports)
        .filter(([, target]) => target.startsWith("./src/"))
        .map(([subpath, target]) => [subpath, stripExtension(target.slice("./src/".length))] as const),
);

/** 各模块的公开入口文件（相对 src、不带扩展名）。 */
const PUBLIC_ENTRIES = new Set(EXPORT_TARGETS.values());

/** `src/<模块>/…` 的模块名；src 根目录的文件与 src 之外返回 null。 */
function moduleOf(pathInSrc: string): string | null {
    if (pathInSrc.startsWith("..") || !pathInSrc.includes("/")) return null;
    return pathInSrc.split("/")[0] ?? null;
}

/** 导入目标在 src 内的路径；包名自引用按 exports 解析。不是本包的导入返回 null，自引用了未导出的子路径返回 "unexported"。 */
function targetInSrc(use: ImportUse): string | null | "unexported" {
    const specifier = use.specifier;
    if (specifier === null) return null;
    if (specifier.startsWith(".")) return stripExtension(relative(SRC, resolve(SRC, dirname(use.file), specifier)));
    if (specifier === PACKAGE_NAME || specifier.startsWith(`${PACKAGE_NAME}/`)) {
        return EXPORT_TARGETS.get(`.${specifier.slice(PACKAGE_NAME.length)}`) ?? "unexported";
    }
    return null;
}

function packageName(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : (parts[0] as string);
}

const isNodeBuiltin = (specifier: string): boolean => specifier.startsWith("node:") || specifier.startsWith("bun:");

/** 文件在模块里的子目录（相对模块目录），例如 `session/jsonl/jsonl.ts` → `jsonl`。 */
function subdirectoryOf(pathInSrc: string): string {
    return pathInSrc.split("/").slice(1, -1).join("/");
}

const insideAny = (directory: string, allowed: readonly string[]): boolean =>
    allowed.some((root) => directory === root || directory.startsWith(`${root}/`));

/** 对全部源码与测试生效的规则：禁止的包、CommonJS 加载、旧原型隔离。 */
function universalViolation(use: ImportUse): string | null {
    if (use.specifier !== null && FORBIDDEN_PACKAGES.includes(packageName(use.specifier))) return `${use.file} 引用了禁止的包 ${use.specifier}`;
    const from = moduleOf(use.file);
    if (use.kind === "require" && from !== PROTOTYPE) return `${use.file} 用了 CommonJS 加载（require、module.require、import.meta.require、import = require 或 createRequire）`;
    const target = targetInSrc(use);
    if (target === null || target === "unexported") return null;
    const to = moduleOf(target);
    if (from === null || to === null || from === to) return null;
    if (from === PROTOTYPE || to === PROTOTYPE) return `${use.file} 跨越了旧原型的边界（${use.specifier ?? "非字面量"}）`;
    return null;
}

/** 只对模块产品代码生效的规则：模块表。 */
function moduleTableViolation(use: ImportUse): string | null {
    const from = moduleOf(use.file);
    if (from === null || from === PROTOTYPE) return null;
    const rule = MODULES[from];
    if (rule === undefined || use.kind === "require") return null;   // CommonJS 加载由 universalViolation 报告

    if (use.kind === "dynamic") {
        if (!insideAny(subdirectoryOf(use.file), rule.dynamicImportIn)) return `${use.file} 使用了动态导入；只有 ${rule.dynamicImportIn.join("、") || "（无）"} 下可以`;
        // 登记的目录就是用来执行调用方给出路径的模块（例如 Profile 文件），目标在运行时才知道。
        if (use.specifier === null) return null;
    }
    const target = targetInSrc(use);
    if (target === "unexported") return `${use.file} 经包名引用了未导出的子路径 ${use.specifier}`;
    if (target !== null) {
        // 同模块的导入在下面直接放行，所以先挡住产品代码引测试支持（docs/testing/README.md：产品代码不引用 testing/）。
        if (isTestSupport(target)) return `${use.file} 是产品代码，引用了测试支持 ${target}`;
        const to = moduleOf(target);
        if (to === null) return `${use.file} 引用了 src 根目录的文件 ${target}`;
        if (to === from) return null;
        if (!rule.modules.includes(to)) return `${use.file} 依赖了不允许的模块 ${to}`;
        if (!PUBLIC_ENTRIES.has(target)) return `${use.file} 深导入了 ${to} 的内部文件 ${target}，只能经公开入口`;
        return null;
    }
    const specifier = use.specifier as string;
    if (isNodeBuiltin(specifier)) {
        return insideAny(subdirectoryOf(use.file), rule.nodeBuiltinsIn)
            ? null
            : `${use.file} 使用了 Node 内置模块 ${specifier}；只有 ${rule.nodeBuiltinsIn.join("、") || "（无）"} 下可以`;
    }
    const allowed = rule.packages[packageName(specifier)];
    if (allowed === undefined) return `${use.file} 引用了模块表未登记的包 ${specifier}`;
    if (allowed === "type-only" && !use.typeOnly) return `${use.file} 只能 import type ${specifier}`;
    if (specifier.split("/").includes("src")) return `${use.file} 深导入了其它包的源码 ${specifier}`;
    return null;
}

describe("nb-harness 模块边界", () => {
    const files = allFiles(SRC);
    const uses = files.flatMap(importsOf);
    const moduleDirs = readdirSync(SRC, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

    it("src 下每个模块目录都在模块表里登记（旧原型除外）", () => {
        expect(moduleDirs.filter((name) => name !== PROTOTYPE && MODULES[name] === undefined)).toEqual([]);
    });

    it("src 根目录只放测试文件，源码都属于某个模块", () => {
        const rootSources = files.map((file) => relative(SRC, file)).filter((path) => !path.includes("/") && !isTestSupport(path));
        expect(rootSources).toEqual([]);
    });

    it("每个已建的模块的公开入口是 src/<模块>/<模块>.ts，并在 package.json 导出", () => {
        const missing = Object.keys(MODULES).filter((name) => moduleDirs.includes(name) && !PUBLIC_ENTRIES.has(`${name}/${name}`));
        expect(missing).toEqual([]);
    });

    it("全部源码与测试：不引禁止的包、不用 CommonJS 加载、新模块与旧原型互不引用", () => {
        expect(uses.map(universalViolation).filter((problem) => problem !== null)).toEqual([]);
    });

    it("模块产品代码：只单向依赖、只经公开入口、只按表引用外部包、Node 内置模块与动态导入", () => {
        const problems = uses.filter((use) => !isTestSupport(use.file)).map(moduleTableViolation).filter((problem) => problem !== null);
        expect(problems).toEqual([]);
    });

    it("模块表的依赖没有环", () => {
        const visiting = new Set<string>();
        const done = new Set<string>();
        const cycles: string[] = [];
        const visit = (name: string, path: readonly string[]): void => {
            if (done.has(name)) return;
            if (visiting.has(name)) {
                cycles.push([...path, name].join(" → "));
                return;
            }
            visiting.add(name);
            for (const next of MODULES[name]?.modules ?? []) visit(next, [...path, name]);
            visiting.delete(name);
            done.add(name);
        };
        for (const name of Object.keys(MODULES)) visit(name, []);
        expect(cycles).toEqual([]);
    });
});
