/**
 * 构建预设打包插件的 Skill（docs/specs/runtime/plugin-api.md 的“作者工具”，docs/specs/agent/skills.md 输出 30–32）：把 `agent.skills`
 * 声明的目录搬进产物，每个 JS/TS 文件连同它用到的 npm 包各打成一个单文件，写回同一个相对路径、同一个文件名（`SKILL.md` 里写的
 * 命令不用改），装好就能用、不用初始化。`package.json`、锁文件与 `node_modules` 不带，其余文件原样复制。
 *
 * 打不进单文件的让构建失败，原因写到文件与依赖：
 * - 打包器报错（例如找不到模块）；
 * - 产物不止一个文件：依赖带原生模块或 `.wasm` 之类的附件；
 * - 产物里还有运行时加载模块的调用，名字是变量拼出来的，或者不是 Bun 的内置模块；
 * - 打进来的文件（入口自己除外）用到自己的位置（`__dirname`、`import.meta.url` 等）：打包后它所在的包不在了，或者它的位置变成了入口的；
 * - 入口自己用 `__dirname`、`__filename`：Bun 把它们换成构建机器上的路径（`import.meta.dir` 在运行时取，可以用）；
 * - Skill 带 Python 第三方依赖（判据同目录的外部依赖检测）；只用标准库的 `.py` 原样带上。
 *
 * 查不出的：依赖按工作目录、环境变量或写死的路径找文件（Spec 写明的已知限制）。
 *
 * 只在作者工具里跑（Bun）：打包用 `Bun.build`，按语法查用 vite 的 `parseAst`，作者机器上本来就有 vite（构建预设的依赖）。
 * 放在作者包（`plugin-sdk/`）而不是 Agent 插件里：它用 Vite 与通用的构建预设，产品代码不引用这两样。随 SDK 包发出，只用相对路径导入。
 */

import {chmod, copyFile, lstat, mkdir, readdir, readFile, realpath, writeFile} from "node:fs/promises";
import {isBuiltin} from "node:module";
import {dirname, extname, join, relative, resolve, sep} from "node:path";

import {parseAst} from "vite";

import type {ManifestProblem} from "@notnotype/nb-runtime/plugin-manifest";
import type {ContributionDeclaration} from "@notnotype/nb-runtime/plugins";

import type {ContributionBuild} from "../src/plugin-platform/build/build-plugin";
import {detectExternal, readSkillPackage} from "../src/plugins/agent/backend/skills/package";
import {SKILLS_POINT, skillsDirectoryProblem} from "../src/plugins/agent/shared/points";
import type {AgentSkillsDeclaration} from "../src/plugins/agent/shared/points";
import type {SkillProblem} from "../src/plugins/agent/shared/skills";

/** 不带进产物的：依赖由打包带上，带着 `package.json` 的插件 Skill 在目录里算没打包（skills.md 输出 32）。 */
const SKIPPED = new Set(["node_modules", "package.json", "bun.lock", "bun.lockb", "package-lock.json"]);

type Loader = "js" | "jsx" | "ts" | "tsx";
const LOADERS: Readonly<Record<string, Loader>> = {".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "jsx", ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx"};

/** 要打包的脚本：JS/TS 源文件，类型声明（`.d.ts`）原样复制。 */
function loaderOf(file: string): Loader | null {
    if (/\.d\.[mc]?ts$/u.test(file)) return null;
    return LOADERS[extname(file)] ?? null;
}

/** 位置相关的 `import.meta` 属性（`import.meta.require` 是加载模块，由产物的检查管）。 */
const META_LOCATION = new Set(["url", "dir", "dirname", "path", "filename", "file", "resolve"]);

interface AstNode {
    readonly type: string;
    readonly [key: string]: unknown;
}

const isNode = (value: unknown): value is AstNode => typeof value === "object" && value !== null && typeof (value as {type?: unknown}).type === "string";
const isIdentifier = (node: unknown, name: string): boolean => isNode(node) && node.type === "Identifier" && node.name === name;
const isImportMeta = (node: unknown): boolean => isNode(node) && node.type === "MetaProperty" && isIdentifier(node.meta, "import") && isIdentifier(node.property, "meta");
const propertyName = (node: AstNode): string | null => (node.computed !== true && isNode(node.property) && node.property.type === "Identifier" ? String(node.property.name) : null);

/**
 * 逐个节点走一遍，交给 `visit` 的还有祖先（最近的在最后）：一个名字是读取还是声明、`import.meta` 怎样被用，要看它在哪。成员访问的
 * 属性名、对象与类的键不是变量（`obj.__dirname`），计算出来的除外，不往下走。
 */
function walk(node: unknown, visit: (node: AstNode, parents: readonly AstNode[]) => void, parents: AstNode[] = []): void {
    if (Array.isArray(node)) {
        for (const item of node) walk(item, visit, parents);
        return;
    }
    if (!isNode(node)) return;
    visit(node, parents);
    parents.push(node);
    for (const [key, value] of Object.entries(node)) {
        if (key === "property" && node.type === "MemberExpression" && node.computed !== true) continue;
        if (key === "key" && (node.type === "Property" || node.type === "PropertyDefinition" || node.type === "MethodDefinition") && node.computed !== true) continue;
        if (typeof value === "object") walk(value, visit, parents);
    }
    parents.pop();
}

/** 字符串字面量（含没有插值的模板）的值；别的写法（变量、拼接）为 null。 */
function literalOf(node: unknown): string | null {
    if (!isNode(node)) return null;
    if (node.type === "Literal" && typeof node.value === "string") return node.value;
    if (node.type === "TemplateLiteral" && Array.isArray(node.expressions) && node.expressions.length === 0 && Array.isArray(node.quasis)) {
        const [quasi] = node.quasis as AstNode[];
        const cooked = (quasi?.value as {cooked?: unknown} | undefined)?.cooked;
        return typeof cooked === "string" ? cooked : null;
    }
    return null;
}

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** 声明模式（变量、参数、解构）里绑定的名字。 */
function patternNames(pattern: unknown, into: Set<string>): void {
    if (!isNode(pattern)) return;
    if (pattern.type === "Identifier") into.add(String(pattern.name));
    else if (pattern.type === "ObjectPattern") for (const property of pattern.properties as unknown[]) patternNames(isNode(property) && property.type === "Property" ? property.value : property, into);
    else if (pattern.type === "ArrayPattern") for (const element of pattern.elements as unknown[]) patternNames(element, into);
    else if (pattern.type === "AssignmentPattern") patternNames(pattern.left, into);
    else if (pattern.type === "RestElement") patternNames(pattern.argument, into);
}

/** 文件里声明过的名字（不分作用域）：自己声明了 `__dirname` 的文件，读它读的是自己的变量，不是位置。 */
function declaredNames(ast: unknown): Set<string> {
    const names = new Set<string>();
    walk(ast, (node) => {
        if (node.type === "VariableDeclarator") patternNames(node.id, names);
        else if (FUNCTIONS.has(node.type)) for (const param of node.params as unknown[]) patternNames(param, names);
        else if (node.type === "CatchClause") patternNames(node.param, names);
        else if (node.type === "ImportSpecifier" || node.type === "ImportDefaultSpecifier" || node.type === "ImportNamespaceSpecifier") patternNames(node.local, names);
    });
    return names;
}

/**
 * 源文件里用到自己位置的写法：没在文件里声明过的 `__dirname`、`__filename`；`import.meta` 的位置属性；`import.meta` 整个被取用
 * （解构、当值传、计算属性），看不出取的是什么就算；`require.resolve`。
 */
function locationUses(code: string, loader: Loader): string[] {
    const ast = parseAst(code, {lang: loader});
    const declared = declaredNames(ast);
    const found = new Set<string>();
    walk(ast, (node, parents) => {
        const parent = parents.at(-1);
        if (node.type === "Identifier" && (node.name === "__dirname" || node.name === "__filename") && !declared.has(String(node.name))) found.add(String(node.name));
        if (isImportMeta(node)) {
            const name = parent?.type === "MemberExpression" && parent.object === node ? propertyName(parent) : null;
            if (name === null) found.add("import.meta");
            else if (META_LOCATION.has(name)) found.add(`import.meta.${name}`);
        }
        if (node.type === "MemberExpression" && isIdentifier(node.object, "require") && propertyName(node) === "resolve") found.add("require.resolve");
    });
    return [...found].sort();
}

/** 产物在运行时还要加载的模块。 */
type RuntimeLoad = {readonly kind: "named"; readonly name: string} | {readonly kind: "dynamic"} | {readonly kind: "alias"};

const LOADERS_BY_NAME = new Set(["require", "__require"]);
const isImportMetaRequire = (node: unknown): boolean => isNode(node) && node.type === "MemberExpression" && isImportMeta(node.object) && propertyName(node) === "require";

/**
 * 产物里的模块加载：`import`、`export … from`、`import()`，以及直接调用的 `require`、`__require`、`import.meta.require`。加载函数
 * 被当成值用（`const load = require`、当参数传）时打包看不出它加载什么，记为 `alias`。放行的只有：直接调用、`typeof`、取它的
 * 属性（`require.cache`）、声明它的地方（参数、Bun 自己的 `var __require = import.meta.require`）。
 */
function runtimeLoads(code: string): RuntimeLoad[] {
    const loads: RuntimeLoad[] = [];
    const add = (name: string | null): void => void loads.push(name === null ? {kind: "dynamic"} : {kind: "named", name});
    walk(parseAst(code, {lang: "js"}), (node, parents) => {
        const parent = parents.at(-1);
        const grandparent = parents.at(-2);
        if (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
            if (node.source !== null && node.source !== undefined) add(literalOf(node.source));
        } else if (node.type === "ImportExpression") {
            add(literalOf(node.source));
        } else if (node.type === "CallExpression") {
            const callee = node.callee;
            if ((isNode(callee) && callee.type === "Identifier" && LOADERS_BY_NAME.has(String(callee.name))) || isImportMetaRequire(callee)) add(literalOf((node.arguments as unknown[])[0]));
        } else if (node.type === "Identifier" && LOADERS_BY_NAME.has(String(node.name))) {
            const called = parent?.type === "CallExpression" && parent.callee === node;
            const typeOf = parent?.type === "UnaryExpression" && parent.operator === "typeof";
            const member = parent?.type === "MemberExpression" && parent.object === node;
            const declaring = (parent?.type === "VariableDeclarator" && parent.id === node) || (parent !== undefined && FUNCTIONS.has(parent.type)) || (parent?.type === "Property" && grandparent?.type === "ObjectPattern");
            if (!called && !typeOf && !member && !declaring) loads.push({kind: "alias"});
        } else if (isImportMetaRequire(node)) {
            const called = parent?.type === "CallExpression" && parent.callee === node;
            const bunHelper = parent?.type === "VariableDeclarator" && parent.init === node && isIdentifier(parent.id, "__require");
            if (!called && !bunHelper) loads.push({kind: "alias"});
        }
    });
    return loads;
}

/** 产物里的字符串字面量有没有构建机器上作者目录的路径（不看注释）。 */
function containsPath(code: string, paths: ReadonlyArray<string>): boolean {
    let found = false;
    walk(parseAst(code, {lang: "js"}), (node) => {
        if (!found && node.type === "Literal" && typeof node.value === "string") found = paths.some((path) => (node.value as string).includes(path));
    });
    return found;
}

/** `node_modules` 里的文件属于哪个包；作者自己的文件为 null。 */
function packageOf(file: string): string | null {
    const marker = `node_modules${sep}`;
    const at = file.lastIndexOf(marker);
    if (at < 0) return null;
    const [first, second] = file.slice(at + marker.length).split(sep);
    return first?.startsWith("@") === true && second !== undefined ? `${first}/${second}` : first ?? null;
}

function skillProblemText(problem: SkillProblem): string {
    switch (problem.code) {
        case "skill-md-missing": return "没有 SKILL.md";
        case "nested": return `没有 SKILL.md，下一层的 ${problem.directory} 里有：可能多套了一层文件夹`;
        case "frontmatter-unreadable": return `SKILL.md 的 frontmatter 读不懂：${problem.detail}`;
        case "field-missing": return `SKILL.md 缺 ${problem.field}`;
        case "field-invalid": return `SKILL.md 的 ${problem.field} 不合规`;
        case "name-mismatch": return `SKILL.md 的 name 是 ${problem.name}，要与文件夹名相同`;
        default: return `Skill 无效（${problem.code}）`;
    }
}

interface SkillContext {
    readonly root: string;
    /** 作者目录的写法：给的与真实路径，产物里出现任何一种都算泄漏。 */
    readonly rootPaths: ReadonlyArray<string>;
    readonly problems: ManifestProblem[];
}

/** 一个脚本：打包、核对，交回产物的文字；有问题时记进 `problems`、交回 null。 */
async function bundleScript(context: SkillContext, file: string, loader: Loader): Promise<string | null> {
    const path = relative(context.root, file).split(sep).join("/");
    const problems: ManifestProblem[] = [];
    // 同一个依赖的几个文件各报一次时原因相同，只留一条。
    const add = (message: string): void => {
        if (!problems.some((problem) => problem.message === message)) problems.push({path, message});
    };
    const result = await Bun.build({entrypoints: [file], target: "bun", format: "esm", metafile: true, throw: false});
    if (!result.success) {
        for (const log of result.logs) if (log.level === "error") add(`打包失败：${String(log.message)}`);
        if (problems.length === 0) add("打包失败");
        context.problems.push(...problems);
        return null;
    }
    const extras = result.outputs.filter((output) => output.kind !== "entry-point");
    const entry = result.outputs.find((output) => output.kind === "entry-point");
    if (entry === undefined) {
        context.problems.push({path, message: "打包没有产物"});
        return null;
    }
    const inputs = Object.keys(result.metafile?.inputs ?? {}).map((input) => resolve(input));
    if (extras.length > 0) {
        // 附件来自哪个包：metafile 里不是脚本的输入（`.node`、`.wasm`）。
        const sources = inputs.filter((input) => loaderOf(input) === null && !input.endsWith(".json")).map((input) => packageOf(input) ?? relative(context.root, input));
        add(`打不进单文件：带着附件 ${extras.map((output) => output.path.split("/").pop()).join("、")}${sources.length > 0 ? `（来自 ${[...new Set(sources)].join("、")}）` : ""}，例如原生模块，插件里的 Skill 用不了`);
    }
    const self = resolve(file);
    let inputLocations = false;
    for (const input of inputs) {
        const inputLoader = loaderOf(input);
        if (input === self || inputLoader === null) continue;
        const code = await readFile(input, "utf8").catch(() => null);
        if (code === null) continue;
        const uses = locationUses(code, inputLoader);
        if (uses.length === 0) continue;
        inputLocations = true;
        const owner = packageOf(input);
        add(owner === null
            ? `打进来的 ${relative(context.root, input).split(sep).join("/")} 用到自己的位置（${uses.join("、")}），打包后它的位置变成了这个脚本的；把用到位置的代码放进脚本自己，或改用相对脚本的路径`
            : `依赖 ${owner} 用到自己的位置（${uses.join("、")}），打包后它的文件不在了，插件里的 Skill 用不了这个包`);
    }
    const text = await entry.text();
    const loads = runtimeLoads(text);
    if (loads.some((load) => load.kind === "dynamic")) add("运行时按变量拼出的名字加载模块，打包时不知道要带上哪个，插件里的 Skill 用不了");
    if (loads.some((load) => load.kind === "alias")) add("把加载模块的函数（require）当值用，打包时不知道它加载什么，插件里的 Skill 用不了；直接调用 require(\"包名\") 或用 import");
    for (const name of new Set(loads.flatMap((load) => (load.kind === "named" && !isBuiltin(load.name) ? [load.name] : [])))) add(`运行时还要加载 ${name}，它没有打进单文件`);
    if (!inputLocations && containsPath(text, context.rootPaths)) add("用到了 __dirname 或 __filename：打包后它们是构建机器上的路径，改用 import.meta.dir");
    try {
        // 产物写回原来的扩展名（`.ts` 里放打包后的 JS），按这个扩展名的加载器能读才行。
        new Bun.Transpiler({loader}).transformSync(text);
    } catch (error) {
        add(`打包后按 ${loader} 读不了：${error instanceof Error ? error.message : String(error)}`);
    }
    context.problems.push(...problems);
    return problems.length === 0 ? text : null;
}

/** 一个 Skill 文件夹里的文件：脚本打包写到 `out` 的同一相对位置，别的原样复制。 */
async function copySkill(context: SkillContext, source: string, out: string): Promise<void> {
    for (const item of (await readdir(source, {withFileTypes: true})).sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
        if (SKIPPED.has(item.name) || item.name.startsWith(".")) continue;
        const from = join(source, item.name);
        const to = join(out, item.name);
        if (item.isSymbolicLink()) {
            context.problems.push({path: relative(context.root, from).split(sep).join("/"), message: "是链接：插件里不能有链接，换成文件"});
            continue;
        }
        if (item.isDirectory()) {
            await copySkill(context, from, to);
            continue;
        }
        if (!item.isFile()) continue;
        await mkdir(dirname(to), {recursive: true});
        const loader = loaderOf(item.name);
        if (loader === null) {
            await copyFile(from, to);
            continue;
        }
        const text = await bundleScript(context, from, loader);
        if (text === null) continue;
        await writeFile(to, text);
        // 带着执行位的脚本（`#!/usr/bin/env bun`）打包后照样能直接运行。
        await chmod(to, (await lstat(from)).mode & 0o777);
    }
}

async function buildSkills(input: {readonly root: string; readonly out: string; readonly contributions: ReadonlyArray<ContributionDeclaration>}): Promise<{readonly problems: ReadonlyArray<ManifestProblem>}> {
    const realRoot = await realpath(input.root);
    const context: SkillContext = {root: input.root, rootPaths: [...new Set([input.root, realRoot])], problems: []};
    for (const contribution of [...input.contributions].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))) {
        const {directory} = contribution.declaration as AgentSkillsDeclaration;
        const at = `contributes.${contribution.id}`;
        const shape = skillsDirectoryProblem(directory);
        if (shape !== null) {
            context.problems.push({path: at, message: shape});
            continue;
        }
        // 声明的目录要在作者目录里、各段都不是链接：真实路径要正好是拼出来的那个。
        const source = join(realRoot, ...directory.split("/"));
        const real = await realpath(source).catch(() => null);
        if (real === null || real !== source || !(await lstat(source)).isDirectory()) {
            context.problems.push({path: at, message: `Skill 目录 ${directory} 不存在、不是目录，或经过链接`});
            continue;
        }
        for (const item of (await readdir(source, {withFileTypes: true})).sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
            if (item.name.startsWith(".") || item.isFile()) continue;
            const skill = join(source, item.name);
            const path = `${directory}/${item.name}`;
            if (!item.isDirectory()) {
                context.problems.push({path, message: "Skill 文件夹是链接：插件里不能有链接"});
                continue;
            }
            const read = await readSkillPackage(skill, item.name);
            if (!read.ok) {
                context.problems.push({path, message: skillProblemText(read.problem)});
                continue;
            }
            if ((await detectExternal(skill, read.manifest.compatibility, () => null))?.python === true) {
                context.problems.push({path, message: "带 Python 第三方依赖（pyproject.toml、requirements.txt、uv.lock 或 # /// script 内联依赖），打不进插件；只用标准库的 .py 可以"});
                continue;
            }
            await copySkill(context, skill, join(input.out, ...directory.split("/"), item.name));
        }
    }
    return {problems: context.problems};
}

/** NeuroBook 构建预设的 Skill 一步（`plugin-sdk/build.ts` 交给通用的构建预设）。 */
export const skillsBuild: ContributionBuild = {capability: SKILLS_POINT, failure: "Skill 打包失败", build: buildSkills};
