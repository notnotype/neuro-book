/**
 * 生成可以安装的插件 SDK 包 `@notnotype/nb-plugin-sdk`（docs/specs/runtime/plugin-api.md 的“SDK”）：
 *
 * - `index.js`、`browser.js`、`components.js`：`src/sdk/` 打包后的实现（`components` 是 nb-ui 的组件）。插件运行时用的是宿主模块表里的那一份，这两份只在作者构建插件时
 *   执行入口定义（生成清单）、以及在仓库外写测试时用；`vue`、`@vue/*`、`typebox` 不打进去，由作者的项目提供同一份。
 * - `index.d.ts`、`browser.d.ts`、`components.d.ts`：打平的类型，不含应用内部的 `nbook/*` 别名，只引用 `vue`、
 *   `@vue/reactivity` 与 `typebox`。内核、nb-form 与 nb-ui 的子路径映射到源码，类型才会被打进来：经 `node_modules` 解析到的工作区包被 TypeScript
 *   当作外部库，不生成声明。
 * - `build.js`、`build.d.ts`：构建预设（`build.ts`，绑定 NeuroBook 平台档案的那一层），在 Bun 里运行；Vite、单文件组件编译与图标数据是它的
 *   依赖。
 * - `cli.js` 与 `template/`：作者命令 `nbooke`（`cli.ts`）与 `create` 用的模板；模板 `_package.json` 的开发依赖在这里
 *   补上作者项目自己装的包，范围与应用自己用的一致。
 * - `examples/`：示例插件的源码（`plugin-sdk/examples/` 的 `plugins/` 与 `external/`），作者照着读；场景测试与场地不随包。
 * - `package.json`：版本取产品版本；`vue`、`@vue/reactivity`、`typebox` 是 peer 依赖，构建预设的工具是普通依赖；`files`、
 *   `license`、`repository` 与 `publishConfig` 按仓库的发布门禁（`scripts/release/packages.ts`）写。
 * - `LICENSE`（仓库根的 AGPL）与 `THIRD-PARTY-NOTICES.md`：构建期实现打进去的第三方包（Vite 的许可清单与 rolldown 的模块
 *   列表，`scripts/third-party-notices.ts`）的许可。
 * - `README.md`：作者文档（`plugin-sdk/README.md`）；`docs/components.md`、`docs/tokens.md`：从 SDK 的组件入口与 nb-ui 的
 *   配色合同、主题样式表生成的两份附表；`specs/`：作者文档链接到的 Spec 的副本。作者文档在仓库里用指向 `docs/specs/` 的相对
 *   链接写，复制时改写到包里的副本：副本与这个 SDK 版本一致，离线也能读，仓库里的 Spec 随后续版本变化。
 *
 * 生成的目录再用 `bun pm pack` 打成 tarball，放在目录旁边，试未发布的改动时作者 `bun add -d <tarball>` 装它。发布用的是
 * `release:smoke` 从生成的目录另打、验过的那份（`scripts/release/`）。
 *
 * 用法：`bun run build:sdk [输出目录]`，缺省输出到 `dist/plugin-sdk/`，最后一行打印 tarball 的路径。输出目录只在不存在、
 * 为空或者是上次生成的 SDK 包时清空重建，否则拒绝。
 */

import {execFile} from "node:child_process";
import {existsSync} from "node:fs";
import {chmod, cp, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {basename, dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";

import {nbColorwayVarKeys} from "@notnotype/nb-ui/colorway-contract";

import vue from "@vitejs/plugin-vue";
import {build as rolldown} from "rolldown";
import type {RolldownOutput} from "rolldown";
import {dts} from "rolldown-plugin-dts";
import ts from "typescript";
import {build as vite} from "vite";

import {isInside} from "../src/plugin-platform/backend/paths";
import {SDK_ENTRIES, SDK_NAME} from "../src/sdk/entries";
import type {SdkEntry} from "../src/sdk/entries";
import {PRODUCT_VERSION} from "../src/shared/product";
import {noticeSection, packageDirectories, packageNotices, viteLicenseNotices} from "../scripts/third-party-notices";

import {AUTHOR_PACKAGES, BUILD_DEPENDENCIES} from "./dependencies";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = resolve(packageRoot, "../..");
/** 打包的入口：产物文件名（不带扩展名）→ 源文件，按 SDK 的子路径表。 */
const ENTRIES = Object.fromEntries(SDK_ENTRIES.map((entry) => [entryName(entry), join(packageRoot, "src/sdk", entry.file)]));

function entryName(entry: SdkEntry): string {
    return entry.subpath === "." ? "index" : entry.subpath.slice("./".length);
}
/** 由作者的项目提供、不打进 SDK 的包：插件运行时宿主给的是同一份。 */
const PEERS = [/^vue($|\/)/u, /^@vue\//u, /^typebox($|\/)/u];
const RUNTIME_SUBPATHS = ["lifecycle", "services", "plugins", "plugin-manifest", "application", "diagnostics", "remote"];

/** 类型打包要的路径映射：应用别名，加上内核、nb-form 与 nb-harness 定义写法的子路径直接指到源码。 */
function typePaths(): Record<string, string[]> {
    const paths: Record<string, string[]> = {"nbook/*": ["./src/*"]};
    for (const name of RUNTIME_SUBPATHS) paths[`@notnotype/nb-runtime/${name}`] = [`../nb-runtime/src/${name}/${name}.ts`];
    paths["@notnotype/nb-form"] = ["../nb-form/src/index.ts"];
    paths["@notnotype/nb-harness/kernel/contracts"] = ["../nb-harness/src/kernel/contracts.ts"];
    paths["@notnotype/nb-harness/kernel/helpers"] = ["../nb-harness/src/kernel/helpers/index.ts"];
    paths["@notnotype/nb-harness/prompt"] = ["../nb-harness/src/kernel/view/prompt/index.ts"];
    paths["@notnotype/nb-harness/prompt/jsx-runtime"] = ["../nb-harness/src/kernel/view/prompt/jsx-runtime.ts"];
    paths["@notnotype/nb-form/vue"] = ["../nb-form/src/vue/index.ts"];
    paths["@notnotype/nb-ui/components"] = ["../nb-ui/src/components/index.ts"];
    paths["@notnotype/nb-layout"] = ["../nb-layout/src/index.ts"];
    paths["@notnotype/nb-layout/vue"] = ["../nb-layout/src/vue/index.ts"];
    paths["@notnotype/nb-ui/text"] = ["../nb-ui/src/text/index.ts"];
    paths["@notnotype/nb-ui/text-port"] = ["../nb-ui/src/text-port/index.ts"];
    return paths;
}

async function dependencyRanges(names: ReadonlyArray<string>): Promise<Record<string, string>> {
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {dependencies: Record<string, string>; devDependencies: Record<string, string>};
    return Object.fromEntries(names.map((name) => {
        const value = manifest.dependencies[name] ?? manifest.devDependencies[name];
        if (value === undefined) throw new Error(`应用的 package.json 里没有 ${name}`);
        return [name, value];
    }));
}

/** 应用自己要求的 Bun 版本范围（`package.json` 的 `engines.bun`）：SDK 与应用在同一个 Bun 上验证。 */
async function bunRange(): Promise<string> {
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {engines?: {bun?: string}};
    if (manifest.engines?.bun === undefined) throw new Error("应用的 package.json 里没有 engines.bun");
    return manifest.engines.bun;
}

/**
 * 清空上次生成的 SDK 包。输出目录来自命令行，传错了（`.`、项目目录）不能被递归删除：只认不存在、为空，或者 `package.json`
 * 的 `name` 是 SDK 包名的目录。
 */
export async function clearPreviousSdk(outDir: string): Promise<void> {
    if (!existsSync(outDir) || (await readdir(outDir)).length === 0) return;
    const manifest = join(outDir, "package.json");
    let name: unknown = null;
    if (existsSync(manifest)) {
        try {
            name = (JSON.parse(await readFile(manifest, "utf8")) as {name?: unknown} | null)?.name;
        } catch (error) {
            throw new Error(`输出目录 ${outDir} 的 package.json 读不了，不清理`, {cause: error});
        }
    }
    if (name !== SDK_NAME) throw new Error(`输出目录 ${outDir} 不是空的，也不是上次生成的 ${SDK_NAME}，不清理`);
    await rm(outDir, {recursive: true});
}

const AUTHOR_README = join(packageRoot, "plugin-sdk/README.md");
const SPECS_ROOT = join(packageRoot, "../../docs/specs");
/** 列给作者的组件：SDK 组件入口里逐个列出的名字（`src/sdk/components.ts`），它们就是兼容承诺。 */
const SDK_COMPONENTS = join(packageRoot, "src/sdk/components.ts");

/** 作者文档、两份附表与 Spec 副本。 */
async function writeAuthorDocs(outDir: string): Promise<void> {
    const specs = new Set<string>();
    // 只认行内链接 `[文字](地址)`：作者文档里不写引用式链接，代码块里也不写这个形状（会被当成链接改写）。
    const readme = (await readFile(AUTHOR_README, "utf8")).replace(/\]\(([^()\s]+)\)/gu, (_link, url: string) => `](${packageLink(url, specs)})`);
    await writeFile(join(outDir, "README.md"), readme);
    for (const spec of specs) {
        await mkdir(dirname(join(outDir, "specs", spec)), {recursive: true});
        await writeFile(join(outDir, "specs", spec), specCopy(spec, await readFile(join(SPECS_ROOT, spec), "utf8"), specs));
    }
    await mkdir(join(outDir, "docs"), {recursive: true});
    await writeFile(join(outDir, "docs/exports.md"), await exportsDoc());
    await writeFile(join(outDir, "docs/components.md"), await componentsDoc());
    await writeFile(join(outDir, "docs/tokens.md"), await tokensDoc());
}

/**
 * 作者文档里一个链接在包里的写法。绝对地址与页内锚点不动；指向 `docs/specs/` 的改到包里 `specs/` 下的副本，并记下要复制的
 * Spec。指向仓库别处的相对链接在包里打不开，构建失败：作者文档要引用示例这类包外的东西时写成文字，不写链接。
 */
function packageLink(url: string, specs: Set<string>): string {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(url) || url.startsWith("#")) return url;
    const hash = url.indexOf("#");
    const path = hash < 0 ? url : url.slice(0, hash);
    const target = resolve(dirname(AUTHOR_README), decodeURIComponent(path));
    const spec = relative(SPECS_ROOT, target);
    if (!isInside(target, SPECS_ROOT) || !spec.endsWith(".md") || !existsSync(target)) {
        throw new Error(`作者文档的链接 ${url} 不指向 docs/specs/ 下的 Spec：SDK 包里没有它`);
    }
    specs.add(spec);
    return `specs/${spec.split(sep).join("/")}${hash < 0 ? "" : url.slice(hash)}`;
}

/**
 * Spec 副本：指向别的副本的链接不动；指向没有随包的文件的相对链接改成“文字（仓库里的 `路径`）”，作者在包里点到的链接
 * 都能打开，也知道包外的那份在哪里。副本只随作者文档引用的那几份，不顺着链接把整个 `docs/` 带进包。
 */
function specCopy(spec: string, text: string, copied: ReadonlySet<string>): string {
    return text.replace(/\[([^\]]*)\]\(([^()\s]+)\)/gu, (link, label: string, url: string) => {
        if (/^[a-z][a-z0-9+.-]*:/iu.test(url) || url.startsWith("#")) return link;
        const hash = url.indexOf("#");
        const target = resolve(dirname(join(SPECS_ROOT, spec)), decodeURIComponent(hash < 0 ? url : url.slice(0, hash)));
        if (copied.has(relative(SPECS_ROOT, target))) return link;
        return `${label}（仓库里的 \`${relative(repoRoot, target).split(sep).join("/")}\`）`;
    });
}

/** nb-ui 组件目录对应的分组标题。不认识的目录用目录名作标题，新加的目录不会漏掉组件。 */
const COMPONENT_GROUPS: Readonly<Record<string, string>> = {controls: "控件", form: "表单", display: "展示", feedback: "反馈与浮层", popup: "弹出与菜单", layout: "布局", navigation: "导航"};

/**
 * SDK 组件入口导出的组件名：读 `src/sdk/components.ts` 的语法树里非 `type` 的具名导出。不执行它：组件是单文件组件，脚本里
 * 加载不了。
 */
async function sdkComponentNames(): Promise<string[]> {
    const source = ts.createSourceFile(SDK_COMPONENTS, await readFile(SDK_COMPONENTS, "utf8"), ts.ScriptTarget.Latest);
    const names = source.statements.flatMap((statement) => (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text)
        : []));
    if (names.length === 0) throw new Error(`${SDK_COMPONENTS} 里没有找到导出的组件`);
    return names;
}

/**
 * 组件清单：SDK 组件入口导出的组件，按它在 nb-ui 里所在的目录分组（nb-ui 组件入口旁的各目录里的 `<名字>.vue`）。在 nb-ui 里
 * 找不到单文件组件的名字进“其它”，不会从清单里消失。
 */
/** 一个子路径入口文件里再导出的名字，值与类型分开；读语法树，不执行（入口带单文件组件时 Bun 加载不了）。 */
async function entryExports(entry: SdkEntry): Promise<{readonly values: string[]; readonly types: string[]}> {
    const source = ts.createSourceFile(entry.file, await readFile(join(packageRoot, "src/sdk", entry.file), "utf8"), ts.ScriptTarget.Latest);
    const values: string[] = [];
    const types: string[] = [];
    for (const statement of source.statements) {
        if (!ts.isExportDeclaration(statement) || statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) continue;
        for (const element of statement.exportClause.elements) (statement.isTypeOnly || element.isTypeOnly ? types : values).push(element.name.text);
    }
    return {values: values.sort(), types: types.sort()};
}

/** 每个子路径导出了什么（组件另见 `components.md`）：作者文档链接它，不手写名单，免得与导出面对不上。 */
async function exportsDoc(): Promise<string> {
    const sections: string[] = [];
    for (const entry of SDK_ENTRIES) {
        if (entry.subpath === "./components") continue;
        const {values, types} = await entryExports(entry);
        const list = (names: ReadonlyArray<string>) => (names.length === 0 ? "无" : names.map((name) => `\`${name}\``).join("、"));
        sections.push(`## \`${entry.specifier}\`

- 服务端入口能不能用：${entry.server ? "能" : "不能（要 Vue，只给浏览器入口）"}
- 值：${list(values)}
- 类型：${list(types)}
`);
    }
    return `# 各子路径的导出

由 SDK 的构建从 SDK 的入口生成，不要手改。根入口是插件框架，其余每个子路径归一个内置插件；nb-ui 的组件见 [components.md](components.md)。

${sections.join("\n")}`;
}

async function componentsDoc(): Promise<string> {
    const nbUiComponents = dirname(fileURLToPath(import.meta.resolve("@notnotype/nb-ui/components")));
    const directoryOf = new Map<string, string>();
    for (const entry of await readdir(nbUiComponents, {withFileTypes: true})) {
        if (!entry.isDirectory()) continue;
        for (const file of await readdir(join(nbUiComponents, entry.name))) {
            if (file.endsWith(".vue")) directoryOf.set(basename(file, ".vue"), entry.name);
        }
    }
    // 布局组件在 nb-layout，文档里仍归“布局”一组。
    const nbLayoutVue = dirname(fileURLToPath(import.meta.resolve("@notnotype/nb-layout/vue")));
    for (const file of await readdir(nbLayoutVue)) {
        if (file.endsWith(".vue")) directoryOf.set(basename(file, ".vue"), "layout");
    }
    const groups = new Map<string, string[]>();
    for (const name of await sdkComponentNames()) {
        const directory = directoryOf.get(name) ?? "其它";
        groups.set(directory, [...groups.get(directory) ?? [], name]);
    }
    const order = [...Object.keys(COMPONENT_GROUPS), ...[...groups.keys()].filter((name) => !(name in COMPONENT_GROUPS)).sort()];
    const sections = order.filter((name) => groups.has(name)).map((name) => {
        const items = groups.get(name)!.sort().map((component) => `- \`${component}\``);
        return `## ${COMPONENT_GROUPS[name] ?? name}\n\n${items.join("\n")}\n`;
    });
    return `# 组件

由 SDK 的构建从 SDK 的组件入口生成，不要手改。

插件的界面只用这里的组件，从 \`@notnotype/nb-plugin-sdk/components\` 导入：

\`\`\`ts
import {Button} from "@notnotype/nb-plugin-sdk/components";
\`\`\`

属性、事件与插槽看包里的 \`components.d.ts\`（编辑器里跳转到定义即可）。插件运行时用的是 NeuroBook 自己的那一份组件，外观随用户的主题变化。

${sections.join("\n")}`;
}

interface TokenGroup {
    readonly title: string;
    readonly pattern: RegExp;
}

/** 颜色变量按前缀分组；没有命中的进“其它”。 */
const COLOR_GROUPS: ReadonlyArray<TokenGroup> = [
    {title: "背景", pattern: /^--bg-/u},
    {title: "文字", pattern: /^--text-/u},
    {title: "边框", pattern: /^--border-/u},
    {title: "强调：选中、当前项、主操作", pattern: /^--accent-/u},
    {title: "状态：info 说明、success 完成、warning 提醒、danger 错误", pattern: /^--status-/u},
];

/** 不随配色变化的变量按前缀分组，先命中的算；没有命中的进“其它”，nb-ui 加了新前缀也不会漏掉。 */
const DESIGN_GROUPS: ReadonlyArray<TokenGroup> = [
    {title: "排版：字体、字号、行高、字重", pattern: /^--(?:font|text|leading|weight|tracking)-/u},
    {title: "间距", pattern: /^--space-/u},
    {title: "控件与容器的尺寸", pattern: /^--(?:control-h-|control-px$|menu-|panel-p$|stack-gap$|border-w$)/u},
    {title: "圆角", pattern: /^--radius-/u},
    {title: "阴影与焦点", pattern: /^--(?:elevation-|surface-raise$|inset-shadow$|focus-)/u},
    {title: "面与线的角色：控件、面板、浮层取哪个颜色", pattern: /-(?:surface|outline)$|^--overlay-|^--divider$/u},
    {title: "动效", pattern: /^--(?:motion|ease)-/u},
    {title: "滚动条", pattern: /^--scrollbar-/u},
    {title: "拖动与落点的反馈", pattern: /^--(?:sash-|drop-area-|layout-)/u},
];

/** 一份样式表里声明的自定义属性与它第一次出现时的值（`prefers-reduced-motion` 里的重声明不算）。 */
async function cssTokens(file: string): Promise<Map<string, string>> {
    const text = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//gu, "");
    const tokens = new Map<string, string>();
    for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gu)) {
        if (!tokens.has(match[1]!)) tokens.set(match[1]!, match[2]!.replace(/\s+/gu, " ").trim());
    }
    return tokens;
}

function grouped<T extends string>(names: ReadonlyArray<T>, groups: ReadonlyArray<TokenGroup>): Array<{readonly title: string; readonly names: T[]}> {
    const result = [...groups, {title: "其它", pattern: /(?:)/u}].map((group) => ({title: group.title, pattern: group.pattern, names: [] as T[]}));
    for (const name of names) result.find((group) => group.pattern.test(name))!.names.push(name);
    return result.filter((group) => group.names.length > 0);
}

/**
 * 主题变量清单：颜色取 nb-ui 的配色合同（`nbColorwayVarKeys`），其余取 nb-ui 导出的 `tokens.css` 与 `theme.css` 里声明的
 * 变量与缺省值。
 */
async function tokensDoc(): Promise<string> {
    const colors: ReadonlyArray<string> = nbColorwayVarKeys;
    const stylesheet = (name: string): string => fileURLToPath(import.meta.resolve(`@notnotype/nb-ui/${name}`));
    const design = new Map([...await cssTokens(stylesheet("theme.css")), ...await cssTokens(stylesheet("tokens.css"))]);
    for (const color of colors) design.delete(color);
    if (design.size === 0) throw new Error("nb-ui 的 tokens.css 与 theme.css 里没有找到变量声明");
    const cell = (value: string): string => (value.length <= 48 ? `\`${value.replaceAll("|", "\\|")}\`` : "（组合值，略）");
    const colorSections = grouped(colors, COLOR_GROUPS).map((group) => `### ${group.title}\n\n${group.names.map((name) => `- \`${name}\``).join("\n")}\n`);
    const designSections = grouped([...design.keys()], DESIGN_GROUPS).map((group) => `### ${group.title}\n\n| 变量 | 缺省值 |\n|---|---|\n${group.names.map((name) => `| \`${name}\` | ${cell(design.get(name)!)} |`).join("\n")}\n`);
    return `# 主题变量

由 SDK 的构建从 NeuroBook 的主题文件生成，不要手改。

插件的样式用 \`var(--名字)\` 取这些变量，不写字面的颜色、尺寸与字号：用户换主题、换配色、切明暗时，插件跟着变。

## 颜色

颜色随用户选的配色与明暗变化，同一个变量在亮色与暗色下取值不同，所以这里不列值。不写死颜色，也不按明暗自己分支；要淡一点的颜色用 \`color-mix(in srgb, var(--accent-main) 12%, transparent)\` 这样现场混。

${colorSections.join("\n")}
## 尺寸、排版、阴影与动效

不随配色变化。下面是 NeuroBook 的缺省值，主题可以覆盖：用变量，不要照抄值。

${designSections.join("\n")}`;
}

/** 生成的 SDK 包：解开的目录与 `bun pm pack` 打出的 tarball（在目录旁边）。 */
export interface BuiltSdk {
    readonly directory: string;
    readonly tarball: string;
}

/**
 * 只要作者文档（说明、附表、Spec 副本与示例源码），不打整个 SDK：应用包与开发服务把它放在 `docs://builtin/sdk/` 给 Agent 读
 * （docs/specs/agent/resources.md 输出 8）。与 SDK 包里的文档是同一个生成逻辑，内容一致。
 */
export async function writeSdkDocs(outDir: string): Promise<void> {
    await mkdir(outDir, {recursive: true});
    await copyExamples(outDir);
    await writeAuthorDocs(outDir);
}

async function copyExamples(outDir: string): Promise<void> {
    for (const name of SHIPPED_EXAMPLES) {
        await cp(join(packageRoot, "plugin-sdk/examples", name), join(outDir, "examples", name), {recursive: true, filter: isShippedExampleFile});
    }
}

/** 随包分发的示例插件（`plugin-sdk/examples/` 下）：作者照着读的源码，不带场景测试、场地与构建产物。 */
const SHIPPED_EXAMPLES = ["plugins", "external"];

function isShippedExampleFile(path: string): boolean {
    const name = basename(path);
    return name !== "dist" && name !== "node_modules" && !name.endsWith(".test.ts");
}

export async function buildSdk(outDir: string): Promise<BuiltSdk> {
    await clearPreviousSdk(outDir);
    // 先写下带包名的清单：中途失败留下的半成品下次照样被认作上次生成的 SDK、能清掉重建。最后会被完整的清单覆盖。
    await mkdir(outDir, {recursive: true});
    await writeFile(join(outDir, "package.json"), `${JSON.stringify({name: SDK_NAME})}\n`);
    await vite({
        configFile: false,
        logLevel: "warn",
        plugins: [vue()],
        resolve: {alias: [{find: /^nbook\//u, replacement: join(packageRoot, "src/")}]},
        build: {
            outDir,
            emptyOutDir: false,
            minify: false,
            // 组件的样式由宿主的页面提供，SDK 的构建期实现用不到。
            cssCodeSplit: false,
            lib: {entry: ENTRIES, formats: ["es"], fileName: (_format, name) => `${name}.js`, cssFileName: "unused"},
            license: {fileName: ".vite/license.json"},
            rolldownOptions: {external: PEERS},
        },
    });
    await rm(join(outDir, "unused.css"), {force: true});
    const libraryNotices = await viteLicenseNotices(join(outDir, ".vite/license.json"), join(repoRoot, "node_modules"));
    await rm(join(outDir, ".vite"), {recursive: true});
    await rolldown({
        cwd: packageRoot,
        input: ENTRIES,
        external: PEERS,
        plugins: [dts({cwd: packageRoot, tsconfig: "tsconfig.web.json", compilerOptions: {paths: typePaths()}, vue: true, emitDtsOnly: true})],
        output: {dir: outDir},
        // 生成声明本来就慢（vue-tsc），不报插件耗时。
        checks: {pluginTimings: false},
    });
    // nb-ui 的模板类型补充（aria-attributes.ts：任何组件都接受 ARIA 属性与 role，补 aria-description）是一段 `vue` 的
    // 模块增强，入口经 `import type {}` 引它；打平声明时这条空的类型导入被丢掉，增强也跟着没了。原样插回组件声明，
    // 放在末尾那条导出列表之前，去掉源码里让它成为模块的 `export {}`（声明文件本身已经是模块）。
    const ariaAugmentation = (await readFile(join(repoRoot, "packages/nb-ui/src/components/aria-attributes.ts"), "utf8")).replace(/^export \{\};\n?/mu, "");
    const componentsDts = join(outDir, "components.d.ts");
    const declarations = await readFile(componentsDts, "utf8");
    const exportList = declarations.lastIndexOf("\nexport {");
    if (exportList === -1) throw new Error("components.d.ts 末尾没有导出列表，插不进 nb-ui 的模板类型补充");
    await writeFile(componentsDts, `${declarations.slice(0, exportList)}\n${ariaAugmentation}${declarations.slice(exportList)}`);
    // 构建预设：命令行工具，打进内核的清单与应用的版本工具；Vite 与编译器、图标数据留作依赖。声明文件一并生成，作者的
    // 构建脚本用得上 `BuildPluginOptions`、`PluginBuildError` 这些类型。
    const tools = await rolldown({
        cwd: packageRoot,
        input: {build: join(packageRoot, "plugin-sdk/build.ts"), cli: join(packageRoot, "plugin-sdk/cli.ts")},
        platform: "node",
        external: [...PEERS, ...BUILD_DEPENDENCIES.map((name) => new RegExp(`^${name.replace("/", "\\/")}($|/)`, "u"))],
        resolve: {alias: {nbook: join(packageRoot, "src")}},
        plugins: [dts({cwd: packageRoot, tsconfig: "tsconfig.json", compilerOptions: {paths: typePaths()}})],
        output: {dir: outDir, format: "es", entryFileNames: "[name].js", banner: (chunk) => (chunk.isEntry && chunk.name === "cli" ? "#!/usr/bin/env bun" : "")},
        checks: {pluginTimings: false},
    });
    await chmod(join(outDir, "cli.js"), 0o755);
    const toolResults: ReadonlyArray<RolldownOutput> = Array.isArray(tools) ? tools : [tools];
    const toolModules = toolResults.flatMap((result) => result.output.flatMap((chunk) => (chunk.type === "chunk" ? chunk.moduleIds : [])));
    await writeFile(join(outDir, "THIRD-PARTY-NOTICES.md"), [
        "# 第三方许可",
        "这个包里的 `*.js` 是打包产物，打包时去掉了各依赖文件头的版权声明。下面是打进去的每个第三方包的许可与声明；`vue`、`typebox` 与构建预设的工具是 peer 依赖或普通依赖，不在其中。",
        noticeSection("构建期实现（index.js、browser.js、components.js 等）", libraryNotices),
        noticeSection("构建预设与作者命令（build.js、cli.js）", await packageNotices(packageDirectories(toolModules))),
    ].join("\n\n") + "\n");
    await cp(join(repoRoot, "LICENSE"), join(outDir, "LICENSE"));
    // 命令的声明文件用不上：它只作 bin。
    await rm(join(outDir, "cli.d.ts"), {force: true});
    await cp(join(packageRoot, "plugin-sdk/template"), join(outDir, "template"), {recursive: true});
    // 模板的开发依赖补上作者项目自己装的包，范围与应用自己用的一致；SDK 自己的范围由 `create` 按装上的 SDK 版本填。
    const templatePackage = join(outDir, "template/_package.json");
    const template = JSON.parse(await readFile(templatePackage, "utf8")) as {devDependencies: Record<string, string>};
    template.devDependencies = {...template.devDependencies, ...await dependencyRanges(AUTHOR_PACKAGES)};
    await writeFile(templatePackage, `${JSON.stringify(template, null, 4)}\n`);
    await copyExamples(outDir);
    const peers = await dependencyRanges(["vue", "typebox"]);
    // vue 的每个版本都把 @vue/reactivity 钉在同一个版本上：用与 vue 相同的范围，作者项目里两者才配成一对。
    peers["@vue/reactivity"] = peers.vue!;
    await writeFile(join(outDir, "package.json"), `${JSON.stringify({
        name: SDK_NAME,
        version: PRODUCT_VERSION,
        description: "NeuroBook 插件 SDK：类型与构建期实现；插件运行时由宿主提供同一份",
        type: "module",
        bin: {nbooke: "./cli.js"},
        exports: {
            ...Object.fromEntries(SDK_ENTRIES.map((entry) => [entry.subpath, {types: `./${entryName(entry)}.d.ts`, import: `./${entryName(entry)}.js`}])),
            "./build": {types: "./build.d.ts", import: "./build.js"},
        },
        peerDependencies: peers,
        // 只用 Bun 运行：作者命令的抬头行是 bun，构建预设与包里的实现都只在 Bun 上验证。
        engines: {bun: await bunRange()},
        dependencies: await dependencyRanges(BUILD_DEPENDENCIES),
        files: ["**/*.js", "**/*.d.ts", "template/", "examples/", "docs/", "specs/", "README.md", "LICENSE", "THIRD-PARTY-NOTICES.md"],
        license: "AGPL-3.0-only",
        repository: {type: "git", url: "git+https://github.com/notnotype/neuro-book.git", directory: "packages/neuro-book/plugin-sdk"},
        keywords: ["neurobook", "plugin", "sdk", "vue", "bun"],
        homepage: "https://github.com/notnotype/neuro-book/tree/master/packages/neuro-book/plugin-sdk#readme",
        bugs: {url: "https://github.com/notnotype/neuro-book/issues"},
        publishConfig: {access: "public"},
    }, null, 4)}\n`);
    await writeAuthorDocs(outDir);
    return {directory: outDir, tarball: await bunPack(outDir)};
}

/**
 * 用 `bun pm pack` 把生成的目录打成作者 `bun add` 的 tarball，放在目录旁边，文件名按 npm 的惯例 `<作用域>-<名字>-<版本>.tgz`；
 * 同名的旧 tarball 被覆盖。`--filename` 直接给出路径，不解析命令的输出。
 */
async function bunPack(directory: string): Promise<string> {
    const tarball = join(dirname(directory), `${SDK_NAME.replace(/^@/u, "").replace("/", "-")}-${PRODUCT_VERSION}.tgz`);
    await promisify(execFile)("bun", ["pm", "pack", "--quiet", "--filename", tarball], {cwd: directory});
    if (!existsSync(tarball)) throw new Error(`bun pm pack 没有打出 ${tarball}`);
    return tarball;
}

if (import.meta.main) {
    const {directory, tarball} = await buildSdk(resolve(process.argv[2] ?? join(packageRoot, "dist/plugin-sdk")));
    console.log(`插件 SDK 已生成：${directory}`);
    console.log(tarball);
}
