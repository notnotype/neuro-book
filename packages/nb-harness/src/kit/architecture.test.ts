/**
 * 宿主套件 `src/kit/` 的边界（w00032 t32 计划“总体”一节）。类型检查与打包都拦不住这些，所以用 TypeScript 语法树读出导入逐条查：
 *
 * - 单元之间按表单向依赖；对内核只经公开入口（`kernel/index.js`、`kernel/contracts.js`），不引旧 harness、`src/models/`；
 *   kit 内只用相对导入。
 * - 浏览器会加载的入口（`./kit/shapes`、`./kit/files`、`./kit/requests/types`）顺着相对导入走完整条链：值导入只许 `typebox`，类型只许
 *   `import type` 自 `kernel/contracts.js`。
 * - 对 nb-form 只用核心入口：整个 `src/` 不导入它的子路径、nb-ui 与 vue（含 `import type`），`package.json` 也不依赖后两者。
 * - 工具、压缩、审批不自己写盘（ADR 0040 在 harness 这一侧的不变量）：`node:fs` 只许具名导入只读函数，源码不出现写盘与起进程的写法；
 *   写盘只在 `files/local.ts`，`tools/shell.ts` 的输出暂存与执行入口按文件名单独放行。
 * - `package.json` 的 `./kit/*` 只列已建的入口。
 *
 * 测试文件不受单元表约束（它们要搭真实存储），但同样不能引禁止的包、不能用 CommonJS。
 */

import {describe, expect, it} from "bun:test";
import {existsSync, readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import ts from "typescript";

const KIT = import.meta.dir;
const SRC = resolve(KIT, "..");
const PACKAGE_ROOT = resolve(SRC, "..");

interface UnitRule {
    /** 可以依赖的其它单元；表本身就是分层。 */
    readonly dependsOn: readonly string[];
    /** 可以引用的外部包（按包名；子路径随包名放行，nb-form 的子路径另由全局规则拦）。 */
    readonly packages: readonly string[];
    /** 可以使用的 Node 与 Bun 内置模块。 */
    readonly builtins: readonly string[];
    /** 对内核公开入口：不许引用、只许 `import type`，或值与类型都可以。 */
    readonly kernel: "none" | "types" | "values";
}

/**
 * 单元：`shapes.ts` 是单文件单元，`files/local.ts` 从 `files/` 里单列（只有它碰磁盘），其余按 `kit/` 下第一层目录。
 * 新建单元先在这里登记，否则“每个文件都属于登记过的单元”失败。
 */
const UNITS: Readonly<Record<string, UnitRule>> = {
    shapes: {dependsOn: [], packages: ["typebox"], builtins: [], kernel: "types"},
    files: {dependsOn: ["shapes"], packages: [], builtins: [], kernel: "types"},
    "files/local": {dependsOn: ["files"], packages: [], builtins: ["node:fs/promises", "node:path", "node:crypto"], kernel: "none"},
    commands: {dependsOn: [], packages: ["unbash"], builtins: [], kernel: "types"},
    // nb-form 只许根说明符（核心入口）：子路径另由“对 nb-form 只用核心入口”那条拦。
    tools: {dependsOn: ["files", "commands", "shapes"], packages: ["@oh-my-pi/pi-natives", "@notnotype/nb-form"], builtins: ["node:fs", "node:fs/promises", "node:os", "node:path"], kernel: "types"},
    // 审批模型读内核的对话记录（值导入 `coreHistory`）。
    approval: {dependsOn: ["files", "commands", "shapes"], packages: ["typebox"], builtins: [], kernel: "values"},
    // 方法要用内核的估算（值导入 `kernel/index.js`）；放回自己读文件（只读）。
    compaction: {dependsOn: ["files", "tools", "shapes"], packages: [], builtins: ["node:fs/promises"], kernel: "values"},
    // 守卫是内核扩展；循环守卫给调用取哈希。
    guards: {dependsOn: [], packages: [], builtins: ["node:crypto"], kernel: "values"},
    // 句柄表要内核的指令码表；标题会话的 id 取哈希。
    sessions: {dependsOn: [], packages: [], builtins: ["node:crypto"], kernel: "values"},
    // 模型请求记录：宿主进程里唯一的写者，写自己的目录（状态根下）；估 token 要内核的值导入。
    requests: {dependsOn: [], packages: [], builtins: ["node:crypto", "node:fs/promises", "node:path", "node:util", "node:zlib"], kernel: "values"},
    // 合同测试要在夹具的目录里放文件与链接，所以能碰磁盘；它只给测试用。
    testing: {dependsOn: ["files"], packages: [], builtins: ["bun:test", "node:fs/promises", "node:os", "node:path"], kernel: "none"},
};

/** 浏览器会加载的入口：顺着相对导入整条链检查。 */
const BROWSER_ENTRIES = ["shapes.ts", "files/index.ts", "requests/types.ts"];

const FORBIDDEN_PACKAGES = ["@oh-my-pi/pi-coding-agent", "@oh-my-pi/pi-agent-core"];
/** 内核的公开入口（不带扩展名）。 */
const KERNEL_ENTRIES = [join(SRC, "kernel", "index"), join(SRC, "kernel", "contracts")];

/** 工具、压缩、审批对 `node:fs` 只许这些只读函数。 */
const READ_ONLY_FS = ["open", "stat", "lstat", "readFile", "readdir", "realpath", "createReadStream"];
/** `tools/shell.ts` 的输出暂存（在系统临时目录里，不在任何根里）。 */
const SHELL_SPOOL_FS = ["mkdtempSync", "openSync", "writeSync", "closeSync", "rmSync"];
const READ_ONLY_UNITS = ["tools", "compaction", "approval"];
const WRITE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
    [/\bBun\.write\b/u, "Bun.write"],
    [/\bBun\.file\([^)]*\)\s*\.\s*write\b/u, "Bun.file(…).write"],
    [/\.writer\(/u, ".writer("],
    [/\bBun\.\$/u, "Bun.$"],
    [/\bBun\.spawn/u, "Bun.spawn"],
];

interface ImportUse {
    /** kit 内的相对路径。 */
    readonly file: string;
    readonly specifier: string | null;
    readonly kind: "static" | "dynamic" | "require";
    /** 只取类型（`import type`、全部具名都是 `type`、`import("…")` 类型）。 */
    readonly typeOnly: boolean;
    /** 具名导入的名字；命名空间或默认导入时为 null。 */
    readonly names: readonly string[] | null;
}

function allFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return allFiles(path);
        return /\.tsx?$/u.test(entry.name) ? [path] : [];
    });
}

const isTest = (path: string): boolean => /\.test\.tsx?$/u.test(path);

function literalText(node: ts.Node | undefined): string | null {
    return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}

function importsOf(absolute: string): ImportUse[] {
    const source = ts.createSourceFile(absolute, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true, absolute.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const file = relative(KIT, absolute);
    const uses: ImportUse[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            const bindings = clause?.namedBindings;
            const named = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : null;
            const typeOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && named !== null && named.length > 0 && named.every((element) => element.isTypeOnly)));
            const names = clause === undefined ? [] : clause.name !== undefined || named === null ? null : named.map((element) => (element.propertyName ?? element.name).text);
            uses.push({file, specifier: literalText(node.moduleSpecifier), kind: "static", typeOnly, names});
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
            const clause = node.exportClause;
            const named = clause !== undefined && ts.isNamedExports(clause) ? clause.elements : null;
            const typeOnly = node.isTypeOnly || (named !== null && named.length > 0 && named.every((element) => element.isTypeOnly));
            uses.push({file, specifier: literalText(node.moduleSpecifier), kind: "static", typeOnly, names: named === null ? null : named.map((element) => (element.propertyName ?? element.name).text)});
        } else if (ts.isImportTypeNode(node)) {
            const argument = node.argument;
            uses.push({file, specifier: ts.isLiteralTypeNode(argument) ? literalText(argument.literal) : null, kind: "static", typeOnly: true, names: null});
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            uses.push({file, specifier: literalText(node.arguments[0]), kind: "dynamic", typeOnly: false, names: null});
        } else if (ts.isImportEqualsDeclaration(node) || (ts.isIdentifier(node) && (node.text === "require" || node.text === "createRequire") && ts.isCallExpression(node.parent))) {
            uses.push({file, specifier: null, kind: "require", typeOnly: false, names: null});
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return uses;
}

/** kit 内路径所属的单元；不属于任何可登记单元的（`kit/` 根上 `shapes.ts` 以外的文件）返回 null。 */
function unitOf(pathInKit: string): string | null {
    if (pathInKit === "shapes.ts") return "shapes";
    if (pathInKit === "files/local.ts") return "files/local";
    return pathInKit.includes("/") ? (pathInKit.split("/")[0] ?? null) : null;
}

function packageName(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : (parts[0] as string);
}

/** 相对说明符解析成不带扩展名的绝对路径（`.js` 写法指向同名 `.ts`）。 */
const resolveRelative = (fromInKit: string, specifier: string): string => resolve(KIT, dirname(fromInKit), specifier).replace(/\.(js|ts|tsx)$/u, "");

/** 全部文件：禁止的包、CommonJS。 */
function universalViolation(use: ImportUse): string | null {
    if (use.kind === "require") return `${use.file} 用了 CommonJS 加载`;
    if (use.specifier !== null && FORBIDDEN_PACKAGES.includes(packageName(use.specifier))) return `${use.file} 引用了禁止的包 ${use.specifier}`;
    return null;
}

/** 产品代码：单元表、内核只经公开入口、kit 内只用相对导入。 */
function unitViolation(use: ImportUse): string | null {
    const unit = unitOf(use.file);
    if (unit === null || UNITS[unit] === undefined) return `${use.file} 不属于登记过的单元`;
    const rule = UNITS[unit];
    if (use.kind === "dynamic") return `${use.file} 使用了动态导入`;
    const specifier = use.specifier;
    if (specifier === null) return null;
    if (specifier.startsWith(".")) {
        const target = resolveRelative(use.file, specifier);
        const inKit = relative(KIT, target);
        if (inKit.startsWith("..")) {
            if (!KERNEL_ENTRIES.includes(target)) return `${use.file} 引用了 kit/ 之外、不是内核公开入口的文件 ${specifier}`;
            if (rule.kernel === "none") return `${use.file} 引用了内核，${unit} 不允许`;
            if (rule.kernel === "types" && !use.typeOnly) return `${use.file} 值导入了内核 ${specifier}，${unit} 只许 import type`;
            return null;
        }
        if (isTest(inKit)) return `${use.file} 是产品代码，引用了测试文件 ${inKit}`;
        const to = unitOf(`${inKit}.ts`) ?? unitOf(inKit);
        if (to === null || to === unit) return null;
        return rule.dependsOn.includes(to) ? null : `${use.file} 依赖了不允许的单元 ${to}`;
    }
    if (specifier.startsWith("node:") || specifier.startsWith("bun:")) return rule.builtins.includes(specifier) ? null : `${use.file} 使用了内置模块 ${specifier}；${unit} 不允许`;
    const name = packageName(specifier);
    if (name === "@notnotype/nb-harness") return `${use.file} 经包名引用了本包，kit/ 内只用相对导入`;
    return rule.packages.includes(name) ? null : `${use.file} 引用了单元表未登记的包 ${specifier}`;
}

/** 对 nb-form 只用核心入口：整个 `src/` 都适用，`import type` 也算。 */
function formBoundaryViolation(file: string, specifier: string | null): string | null {
    if (specifier === null) return null;
    if (specifier.startsWith("@notnotype/nb-form/")) return `${file} 导入了 nb-form 的子路径 ${specifier}，只许核心入口`;
    if (specifier === "@notnotype/nb-ui" || specifier.startsWith("@notnotype/nb-ui/") || specifier === "vue" || specifier.startsWith("vue/")) return `${file} 导入了 ${specifier}，nb-harness 不依赖 nb-ui 与 vue`;
    return null;
}

/** 浏览器链上的一次导入。 */
function browserViolation(use: ImportUse): string | null {
    const specifier = use.specifier;
    if (use.kind !== "static" || specifier === null) return `${use.file} 在浏览器链上用了动态导入或 CommonJS`;
    if (specifier.startsWith(".")) {
        const target = resolveRelative(use.file, specifier);
        if (!relative(KIT, target).startsWith("..")) return null;
        return target === join(SRC, "kernel", "contracts") && use.typeOnly ? null : `${use.file} 在浏览器链上引用了 ${specifier}：kit 之外只许 import type 自 kernel/contracts.js`;
    }
    // typebox 的值与类型都可以；别的包连类型也不许：类型导入会把那个包的源码拉进浏览器配置的类型检查。
    return packageName(specifier) === "typebox" ? null : `${use.file} 在浏览器链上引用了 ${specifier}：只许 typebox`;
}

/** 从一个入口顺着 kit 内的相对导入走完整条链，交回链上的全部导入。 */
function browserChain(entry: string): ImportUse[] {
    const seen = new Set<string>();
    const uses: ImportUse[] = [];
    const walk = (pathInKit: string): void => {
        if (seen.has(pathInKit)) return;
        seen.add(pathInKit);
        for (const use of importsOf(join(KIT, pathInKit))) {
            uses.push(use);
            if (use.specifier === null || !use.specifier.startsWith(".")) continue;
            const inKit = relative(KIT, resolveRelative(use.file, use.specifier));
            if (inKit.startsWith("..")) continue;
            walk(existsSync(join(KIT, `${inKit}.ts`)) ? `${inKit}.ts` : join(inKit, "index.ts"));
        }
    };
    walk(entry);
    return uses;
}

/** 工具、压缩、审批不自己写盘：`node:fs` 的导入与源码里的写法。 */
function writeViolations(pathInKit: string, text: string, uses: readonly ImportUse[]): string[] {
    const unit = unitOf(pathInKit);
    if (unit === null || !READ_ONLY_UNITS.includes(unit)) return [];
    const allowed = pathInKit === "tools/shell.ts" ? [...READ_ONLY_FS, ...SHELL_SPOOL_FS] : READ_ONLY_FS;
    const problems: string[] = [];
    for (const use of uses) {
        if (use.specifier !== "node:fs" && use.specifier !== "node:fs/promises") continue;
        if (use.names === null) problems.push(`${pathInKit} 对 ${use.specifier} 用了命名空间或默认导入`);
        else for (const name of use.names) if (!allowed.includes(name)) problems.push(`${pathInKit} 从 ${use.specifier} 导入了 ${name}，只许只读函数`);
    }
    for (const [pattern, label] of WRITE_PATTERNS) if (pattern.test(text)) problems.push(`${pathInKit} 用了 ${label}`);
    return problems;
}

describe("nb-harness 宿主套件的边界", () => {
    const files = allFiles(KIT);
    const product = files.filter((file) => !isTest(file));
    const uses = files.flatMap((file) => importsOf(file));

    it("每个产品文件都属于登记过的单元", () => {
        expect(product.map((file) => relative(KIT, file)).filter((file) => {
            const unit = unitOf(file);
            return unit === null || UNITS[unit] === undefined;
        })).toEqual([]);
    });

    it("全部文件：不引禁止的包、不用 CommonJS", () => {
        expect(uses.map(universalViolation).filter((problem) => problem !== null)).toEqual([]);
    });

    it("产品代码：按单元表单向依赖、对内核只经公开入口、kit 内只用相对导入", () => {
        expect(uses.filter((use) => !isTest(use.file)).map(unitViolation).filter((problem) => problem !== null)).toEqual([]);
    });

    it("单元表的依赖没有环", () => {
        const done = new Set<string>();
        const cycles: string[] = [];
        const visit = (name: string, path: readonly string[]): void => {
            if (path.includes(name)) {
                cycles.push([...path, name].join(" → "));
                return;
            }
            if (done.has(name)) return;
            for (const next of UNITS[name]?.dependsOn ?? []) visit(next, [...path, name]);
            done.add(name);
        };
        for (const name of Object.keys(UNITS)) visit(name, []);
        expect(cycles).toEqual([]);
    });

    it("浏览器会加载的入口：整条链只值导入 typebox，内核只 import type 自 kernel/contracts.js", () => {
        expect(BROWSER_ENTRIES.flatMap((entry) => browserChain(entry).map(browserViolation).filter((problem) => problem !== null))).toEqual([]);
    });

    it("整个 src/ 对 nb-form 只用核心入口、不导入 nb-ui 与 vue；package.json 不依赖 nb-ui 与 vue", () => {
        // 只要说明符、`import type` 也算：用词法预扫描，比建语法树快一个数量级。
        const everywhere = allFiles(SRC).filter((file) => !isTest(file)).flatMap((file) => ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles.map((entry) => ({file: relative(SRC, file), specifier: entry.fileName})));
        expect(everywhere.map((use) => formBoundaryViolation(use.file, use.specifier)).filter((problem) => problem !== null)).toEqual([]);
        const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {dependencies?: Record<string, string>; peerDependencies?: Record<string, string>};
        const names = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})];
        expect(names.filter((name) => name === "@notnotype/nb-ui" || name === "vue")).toEqual([]);
    });

    it("工具、压缩、审批不自己写盘", () => {
        expect(product.flatMap((file) => {
            const pathInKit = relative(KIT, file);
            return writeViolations(pathInKit, readFileSync(file, "utf8"), importsOf(file));
        })).toEqual([]);
    });

    it("package.json 的 ./kit/* 只列已建的入口", () => {
        const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {exports: Record<string, string>};
        const kitExports = Object.entries(manifest.exports).filter(([key]) => key.startsWith("./kit/"));
        expect(kitExports.length).toBeGreaterThan(0);
        expect(kitExports.filter(([, target]) => !existsSync(join(PACKAGE_ROOT, target))).map(([key]) => key)).toEqual([]);
    });

    it("检查本身认得出违规的写法", () => {
        const use = (file: string, specifier: string, extra: Partial<ImportUse> = {}): ImportUse => ({file, specifier, kind: "static", typeOnly: false, names: null, ...extra});
        // 单元表与内核入口。
        expect(unitViolation(use("shapes.ts", "../kernel/contracts.js"))).toContain("只许 import type");
        expect(unitViolation(use("shapes.ts", "../kernel/contracts.js", {typeOnly: true}))).toBeNull();
        expect(unitViolation(use("shapes.ts", "../kernel/api/basics.js", {typeOnly: true}))).toContain("不是内核公开入口");
        expect(unitViolation(use("shapes.ts", "../harness.js"))).toContain("不是内核公开入口");
        expect(unitViolation(use("shapes.ts", "node:fs"))).toContain("内置模块");
        expect(unitViolation(use("shapes.ts", "@oh-my-pi/pi-natives"))).toContain("未登记的包");
        expect(unitViolation(use("shapes.ts", "@notnotype/nb-harness/kernel"))).toContain("经包名引用了本包");
        expect(unitViolation(use("other.ts", "typebox"))).toContain("不属于登记过的单元");
        expect(universalViolation(use("shapes.ts", "@oh-my-pi/pi-coding-agent"))).toContain("禁止的包");
        // 浏览器链。
        expect(browserViolation(use("shapes.ts", "node:path"))).toContain("只许 typebox");
        expect(browserViolation(use("shapes.ts", "@notnotype/nb-form"))).toContain("只许 typebox");
        expect(browserViolation(use("shapes.ts", "@oh-my-pi/pi-ai", {typeOnly: true}))).toContain("只许 typebox");
        expect(browserViolation(use("shapes.ts", "typebox", {typeOnly: true}))).toBeNull();
        expect(browserViolation(use("shapes.ts", "../kernel/index.js", {typeOnly: true}))).toContain("只许 import type 自 kernel/contracts.js");
        expect(browserViolation(use("shapes.ts", "typebox"))).toBeNull();
        // nb-form 只用核心入口。
        expect(formBoundaryViolation("kit/tools/ask.ts", "@notnotype/nb-form/vue")).toContain("子路径");
        expect(formBoundaryViolation("kit/tools/ask.ts", "@notnotype/nb-ui/text")).toContain("nb-ui 与 vue");
        expect(formBoundaryViolation("kit/tools/ask.ts", "vue")).toContain("nb-ui 与 vue");
        expect(formBoundaryViolation("kit/tools/ask.ts", "@notnotype/nb-form")).toBeNull();
        // 不自己写盘。
        expect(writeViolations("tools/write.ts", "", [use("tools/write.ts", "node:fs/promises", {names: ["writeFile"]})])).toHaveLength(1);
        expect(writeViolations("tools/write.ts", "", [use("tools/write.ts", "node:fs")])).toHaveLength(1);
        expect(writeViolations("compaction/x.ts", "await Bun.file(path).write(text);", [])).toHaveLength(1);
        expect(writeViolations("approval/x.ts", "Bun.spawn([\"ls\"])", [])).toHaveLength(1);
        expect(writeViolations("tools/shell.ts", "", [use("tools/shell.ts", "node:fs", {names: ["writeSync", "openSync"]})])).toEqual([]);
        expect(writeViolations("tools/read.ts", "", [use("tools/read.ts", "node:fs/promises", {names: ["readFile", "stat"]})])).toEqual([]);
    });
});
