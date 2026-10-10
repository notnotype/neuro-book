/**
 * 包内模块边界（packages/nb-harness/AGENTS.md 的“模块与依赖”）：模块之间只单向依赖，只经对方的公开入口
 * （`package.json` 的 `exports` 指向的文件）；OMP 只按表中允许的方式引用；只有声明了 I/O 的入口能用 Node 内置模块；
 * 新模块不引旧原型，旧原型也不引新模块。类型检查与打包不会拦住这些，所以按导入语句检查。
 * 测试文件与 `testing/` 目录不受模块表约束：它们要搭真实存储与运行环境。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";

const SRC = import.meta.dir;
const PACKAGE_JSON = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8")) as {readonly exports: Record<string, string>};
const PROTOTYPE = "prototype";

type ExternalRule = "runtime" | "type-only";

interface ModuleRule {
    /** 可以依赖的其它模块；依赖只能单向，表本身就是分层。 */
    readonly modules: readonly string[];
    /** 可以引用的外部包；`type-only` 表示只能 `import type`。 */
    readonly packages: Readonly<Record<string, ExternalRule>>;
    /** 可以使用 Node 内置模块的目录（相对模块目录）；只有声明了 I/O 的入口才在这里。 */
    readonly nodeBuiltinsIn: readonly string[];
}

const TYPEBOX = {typebox: "runtime"} as const;

// 新增模块时先在这里登记，否则边界测试失败；规划中的模块与分层见 docs/proposals/agent-harness-kernel.md 的“模块划分与推进顺序”。
const MODULES: Readonly<Record<string, ModuleRule>> = {
    session: {
        modules: [],
        packages: {...TYPEBOX, "@oh-my-pi/pi-agent-core": "type-only", "@oh-my-pi/pi-ai": "type-only"},
        nodeBuiltinsIn: ["jsonl"],
    },
};

const FORBIDDEN_PACKAGES = ["@oh-my-pi/pi-coding-agent"];

interface ImportUse {
    readonly file: string;
    readonly specifier: string;
    readonly typeOnly: boolean;
    readonly dynamic: boolean;
}

const IMPORT_PATTERN = /^\s*(?:import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gmu;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*["']([^"']+)["']\s*\)/gu;

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === "testing" ? [] : sourceFiles(path);
        return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
    });
}

function importsOf(file: string): ImportUse[] {
    const text = readFileSync(file, "utf8");
    const at = relative(SRC, file);
    return [
        ...[...text.matchAll(IMPORT_PATTERN)].map((match) => ({file: at, specifier: match[2] as string, typeOnly: match[1] !== undefined, dynamic: false})),
        ...[...text.matchAll(DYNAMIC_IMPORT_PATTERN)].map((match) => ({file: at, specifier: match[1] as string, typeOnly: false, dynamic: true})),
    ];
}

/** `src/<模块>/…` 的模块名；不在 src 下返回 null。 */
function moduleOf(pathInSrc: string): string | null {
    if (pathInSrc.startsWith("..")) return null;
    const [first] = pathInSrc.split("/");
    return first === undefined || !pathInSrc.includes("/") ? null : first;
}

/** 相对导入在 src 内的目标路径（不带扩展名）。 */
function relativeTarget(use: ImportUse): string | null {
    if (!use.specifier.startsWith(".")) return null;
    return relative(SRC, resolve(SRC, dirname(use.file), use.specifier)).replace(/\.tsx?$/u, "");
}

/** 包名部分：`@scope/name` 或 `name`。 */
function packageName(specifier: string): string {
    const parts = specifier.split("/");
    return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : (parts[0] as string);
}

const isNodeBuiltin = (specifier: string): boolean => specifier.startsWith("node:") || specifier.startsWith("bun:");

/** 各模块的公开入口文件（相对 src、不带扩展名），取自 package.json 的 exports。 */
const PUBLIC_ENTRIES = new Set(
    Object.values(PACKAGE_JSON.exports)
        .filter((target) => target.startsWith("./src/"))
        .map((target) => target.slice("./src/".length).replace(/\.tsx?$/u, "")),
);

/** 一条导入违反的规则；没有违反返回 null。 */
function violation(use: ImportUse): string | null {
    const from = moduleOf(use.file);
    if (from === null) return null;
    const rule = from === PROTOTYPE ? null : MODULES[from];
    if (FORBIDDEN_PACKAGES.includes(packageName(use.specifier))) return `${use.file} 引用了禁止的包 ${use.specifier}`;

    const target = relativeTarget(use);
    if (target !== null) {
        const to = moduleOf(target);
        if (to === null || to === from) return null;
        if (from === PROTOTYPE || to === PROTOTYPE) return `${use.file} 跨越了旧原型的边界（${use.specifier}）`;
        if (rule === undefined || rule === null) return null;
        if (!rule.modules.includes(to)) return `${use.file} 依赖了不允许的模块 ${to}`;
        if (!PUBLIC_ENTRIES.has(target)) return `${use.file} 深导入了 ${to} 的内部文件 ${target}，只能经公开入口`;
        return null;
    }

    if (from === PROTOTYPE || rule === undefined || rule === null) return null;
    if (isNodeBuiltin(use.specifier)) {
        const inside = use.file.split("/").slice(1, -1).join("/");
        return rule.nodeBuiltinsIn.some((dir) => inside === dir || inside.startsWith(`${dir}/`))
            ? null
            : `${use.file} 使用了 Node 内置模块 ${use.specifier}；只有 ${rule.nodeBuiltinsIn.join("、") || "（无）"} 下可以`;
    }
    const allowed = rule.packages[packageName(use.specifier)];
    if (allowed === undefined) return `${use.file} 引用了模块表未登记的包 ${use.specifier}`;
    if (allowed === "type-only" && !use.typeOnly) return `${use.file} 只能 import type ${use.specifier}`;
    if (use.specifier.split("/").includes("src")) return `${use.file} 深导入了其它包的源码 ${use.specifier}`;
    return null;
}

describe("nb-harness 模块边界", () => {
    const moduleDirs = readdirSync(SRC, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

    it("src 下每个模块目录都在模块表里登记（旧原型除外）", () => {
        expect(moduleDirs.filter((name) => name !== PROTOTYPE && MODULES[name] === undefined)).toEqual([]);
    });

    it("每个模块的公开入口是 src/<模块>/<模块>.ts，并在 package.json 导出", () => {
        const missing = Object.keys(MODULES).filter((name) => moduleDirs.includes(name) && !PUBLIC_ENTRIES.has(`${name}/${name}`));
        expect(missing).toEqual([]);
    });

    it("模块只单向依赖、只经公开入口、只按表引用外部包与 Node 内置模块", () => {
        const problems = sourceFiles(SRC).flatMap(importsOf).map(violation).filter((problem) => problem !== null);
        expect(problems).toEqual([]);
    });

    it("新模块不使用动态 import", () => {
        const dynamic = sourceFiles(SRC)
            .flatMap(importsOf)
            .filter((use) => use.dynamic && moduleOf(use.file) !== PROTOTYPE);
        expect(dynamic.map((use) => use.file)).toEqual([]);
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
