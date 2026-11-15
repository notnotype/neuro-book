/**
 * 第三方插件的构建预设（docs/specs/runtime/plugin-api.md 的“SDK”、plugin-code-loading.md 输出 2–5）：把作者目录构建成
 * 可以安装的插件目录。
 *
 * 与应用无关：“这是哪个应用”的事实（引擎键、共享模块、宿主提供的包、登记全局名……）都来自调用方交来的平台档案，应用另有
 * 一层绑定自己档案的封装给作者用。
 *
 * 作者合同：
 * - `package.json` 给 `publisher`、`name`、`version`，可选 `displayName`、`description`、`license`、`engines.<引擎键>`（缺省取
 *   `^<产品版本>`）、`pluginVersions`，以及 `<档案的 authorField>.definitions`（入口定义模块，缺省 `backend/plugin.ts`、
 *   `web/plugin.ts` 里存在的）；
 * - 要带消息目录时，`package.json` 写 `l10n.source`（源语言），目录放在 `locales/<语言>.json`，语言列表由这些文件得出；
 *   这时显示名与说明写在源语言目录的 `manifest.displayName`、`manifest.description`，不写在 `package.json`（目录是唯一的来源）；
 * - `plugin.ts` 导出插件描述 `descriptor`，id 是 `<publisher>.<name>`、版本与 `package.json` 相同；
 * - 每个入口定义模块导出一个或多个 `PluginDefinition`，与内置插件同一写法。模块顶层会在构建时执行一次（为了读出声明）。
 *   入口模块存在却没有导出任何插件定义时构建失败：多半是忘了 `export`。
 *
 * 产物：
 * - `package.json`：作者的字段加上由代码定义生成的清单（档案里清单格式的 `build`，生成即校验）；
 * - 每个入口一个文件 `<入口 id>.js`（带 source map，`sources` 是相对作者目录的路径），只导出 `activate`，声明以清单为准。
 *   外壳只引用这个入口所在的插件定义，定义模块里入口用不到的别的导出（以及它们的样式）照常被摇掉。
 *   服务端与项目入口是 ESM；浏览器入口包成登记工厂并压缩，脚本执行时调用宿主的 `register`，每次激活宿主调用一次工厂。
 *   插件自己的动态导入都内联进这个文件，共享模块的动态导入在浏览器产物里也经工厂的 `require` 取；
 * - `style.css`：各入口的样式合并后包进 `@layer components`，加上插件用到的 Lucide 图标的规则（宿主只为自己源码里出现过的
 *   图标类生成规则）；
 * - `locales/<语言>.json`：作者的消息目录原样复制，先按与安装相同的规则检查（docs/specs/runtime/plugin-manifest.md 的 `l10n`）。
 *
 * 共享模块（档案的 `sharedModules`）留作外部引用；纯度检查按打包器的模块图核对：打进了宿主那一份 Vue（`vue`、
 * `@vue/reactivity`、`@vue/runtime-*`）或档案列出的宿主包的实现就失败，外部引用（静态与动态导入）不在宿主模块表里也失败
 * （“未共享”），两件事都在构建时报出。
 */

import {existsSync} from "node:fs";
import {mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile} from "node:fs/promises";
import {builtinModules, createRequire} from "node:module";
import {stripVTControlCharacters} from "node:util";
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

import {localeTagProblem, parseCatalog} from "@notnotype/nb-runtime/plugin-manifest";
import type {ManifestL10n, ManifestProblem, ManifestSource, MessageCatalog} from "@notnotype/nb-runtime/plugin-manifest";
import type {ContributionDeclaration, PluginDefinition, PluginDescriptor, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import {getIconData, iconToHTML, iconToSVG, svgToURL} from "@iconify/utils";
import vue from "@vitejs/plugin-vue";
import * as compiler from "vue/compiler-sfc";
import {build as vite, createServer} from "vite";
import type {Plugin} from "vite";

import {isInside} from "../backend/paths";
import {DESCRIPTOR_CHECK} from "../shared/descriptor-check";
import type {DescriptorCheck} from "../shared/descriptor-check";
import {notSharedMessage} from "../shared/plugin-code-error";
import type {PlatformProfile} from "../shared/profile";

const DEFAULT_DEFINITIONS = ["backend/plugin.ts", "web/plugin.ts"];
const BUILT_LOCATIONS = ["server", "project", "browser"] as const;
type BuiltLocation = (typeof BUILT_LOCATIONS)[number];

/**
 * 必须用宿主那一份的 Vue 包：它们带响应式状态与组件实例，打进第二份就和宿主互相看不见。其它 `@vue/*`（`@vue/shared`、
 * `@vue/devtools-api` 这类无状态的工具包，vue-router、Pinia 都依赖后者）照常打进插件。
 */
const HOST_VUE_PACKAGES = ["vue", "@vue/reactivity", "@vue/runtime-core", "@vue/runtime-dom"];
/**
 * 由宿主提供、不许打进产物的包：Vue 加上档案列出的宿主包（打进去会出现第二份）。它们（含子路径）的引用一律留作外部，再按
 * 模块表判断能不能用；经相对路径之类绕过包名、解析到它们目录里的模块，就是打进了第二份。
 */
function hostPackages(profile: PlatformProfile): string[] {
    return [...HOST_VUE_PACKAGES, ...profile.hostPackages];
}

function packagePattern(name: string): RegExp {
    return new RegExp(`^${name.replaceAll("/", "\\/")}($|\\/)`, "u");
}
/** 从 `vue` 再导出的包：引用改写成外部的 `vue`，与宿主是同一份（依赖里的库常直接引用它们）。 */
const VUE_REEXPORTED = /^@vue\/runtime-(?:core|dom)$/u;

/**
 * 解析别名，Vite `resolve.alias` 写法的子集。不直接用 Vite 的类型：生成的 SDK 包里 `./build` 的声明文件引用了它，作者的
 * 构建脚本做类型检查时就要连带检查 Vite 的声明（还要装 Node 的类型）。
 */
export interface BuildAlias {
    readonly find: string | RegExp;
    readonly replacement: string;
}

export interface BuildPluginOptions {
    /** 作者目录：含 `package.json` 与 `plugin.ts`。 */
    readonly root: string;
    /** 输出目录：不存在或为空。 */
    readonly outDir: string;
    /** 额外的解析别名。仓库里的示例把 SDK 指到应用源码；仓库外的作者不用。 */
    readonly alias?: ReadonlyArray<BuildAlias>;
    /** 另外不许打进产物的目录。仓库里是应用源码：SDK 的别名指到那里，打进去就是第二份 SDK。 */
    readonly forbiddenDirectories?: ReadonlyArray<string>;
    /**
     * 开发构建（作者工具的 `--dev`）：产物清单的版本是作者的 `version` 加上这一刻的构建元数据（`devVersion`），在插件页
     * 安装时按升级处理（docs/specs/runtime/plugin-api.md 的“作者工具”）。
     */
    readonly dev?: {readonly now: Date};
    /** 输出目录里是这个插件上次的产物（或中断的构建留下的中间目录）时先清空；不是的话照样拒绝，不删别人的目录。 */
    readonly clean?: boolean;
    /** 打印 Vite 的日志；执行入口定义出错时报告带完整堆栈（作者工具的 `--verbose`）。缺省只报作者文件里出错的位置与消息。 */
    readonly verbose?: boolean;
}

/**
 * 按贡献点的附加构建步骤：构建预设本身不认识、又要带上文件的贡献（例如 Agent 的 Skill），由拥有贡献点的一方交进来，通用的构建
 * 预设不认识它们的语义。在纯度检查之后、写输出之前运行：写进 `out` 的文件与别的产物一起移进输出目录，有问题时构建失败。
 */
export interface ContributionBuild {
    readonly capability: string;
    /** 这一步有问题时，构建失败的一句话原因。 */
    readonly failure: string;
    /** `contributions` 是清单里这个贡献点的全部贡献（顶层与各入口的）；`out` 对应输出目录的根。 */
    build(input: {readonly root: string; readonly out: string; readonly contributions: ReadonlyArray<ContributionDeclaration>}): Promise<{readonly problems: ReadonlyArray<ManifestProblem>}>;
}

export interface BuildPluginResult {
    /** 写进 `package.json` 的清单。 */
    readonly manifest: Record<string, unknown>;
    /** 相对输出目录的文件。 */
    readonly files: ReadonlyArray<string>;
    /** 不让构建失败、但作者该知道的事（例如源码里写了不存在的图标）。 */
    readonly warnings: ReadonlyArray<string>;
}

/** 构建失败：`problems` 逐条列出原因，路径是清单字段或源码模块。 */
export class PluginBuildError extends Error {
    /** 一句话的原因，不含逐条问题。 */
    readonly summary: string;
    readonly problems: ReadonlyArray<ManifestProblem>;

    // 不写成 `ErrorOptions`：它是 ES2022 的库类型，生成的 `./build` 声明文件会要求作者的 `lib` 至少是 ES2022。
    constructor(summary: string, problems: ReadonlyArray<ManifestProblem>, options?: {readonly cause?: unknown}) {
        super(`${summary}：${problems.map((problem) => (problem.path === "" ? problem.message : `${problem.path}：${problem.message}`)).join("；")}`, options);
        this.name = "PluginBuildError";
        this.summary = summary;
        this.problems = problems;
    }
}

interface AuthorPackage {
    readonly publisher: string;
    readonly name: string;
    readonly version: string;
    readonly displayName?: string;
    readonly description?: string;
    readonly license?: string;
    readonly engines?: Readonly<Record<string, string>>;
    readonly pluginVersions?: Readonly<Record<string, string>>;
}

interface LocatedEntry {
    readonly entry: PluginEntryDefinition;
    readonly location: BuiltLocation;
    /** 定义这个入口的模块（绝对路径）与模块里插件定义的导出名。 */
    readonly module: string;
    readonly exportName: string;
}

/** 一次构建里打包器看到的事实，供纯度检查与图标扫描。 */
interface BundleFacts {
    readonly modules: string[];
    /** 外部引用（静态与动态导入）到引入它的第一个模块；引入者不明时为 null。 */
    readonly externals: Map<string, string | null>;
}

function isPluginDefinition(value: unknown): value is PluginDefinition {
    return typeof value === "object" && value !== null && typeof (value as {id?: unknown}).id === "string" && Array.isArray((value as {entries?: unknown}).entries);
}

/** 读一个 JSON 对象；读不了、不是 JSON 或不是对象时以 `PluginBuildError` 失败。 */
async function readJsonObject(file: string, what: string): Promise<Record<string, unknown>> {
    let raw: unknown;
    try {
        raw = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
        throw new PluginBuildError(`读不了${what}`, [{path: "package.json", message: `${file}：${error instanceof Error ? error.message : String(error)}`}], {cause: error});
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new PluginBuildError(`${what}不是对象`, [{path: "package.json", message: file}]);
    return raw as Record<string, unknown>;
}

async function readAuthor(root: string): Promise<{readonly author: AuthorPackage; readonly raw: Record<string, unknown>}> {
    const raw = await readJsonObject(join(root, "package.json"), "插件目录的 package.json");
    const record = raw as Partial<Record<keyof AuthorPackage, unknown>>;
    const problems: ManifestProblem[] = [];
    for (const field of ["publisher", "name", "version"] as const) {
        if (typeof record[field] !== "string" || record[field] === "") problems.push({path: field, message: "package.json 必须写这个字段"});
    }
    if (problems.length > 0) throw new PluginBuildError("插件目录的 package.json 不完整", problems);
    return {author: raw as unknown as AuthorPackage, raw};
}

/** 作者目录里的消息目录：清单的 `l10n`、要原样复制的文件，与从源语言目录摘出的显示名和说明。 */
interface AuthorCatalogs {
    readonly l10n: ManifestL10n;
    readonly files: ReadonlyArray<{readonly tag: string; readonly text: string}>;
    readonly displayName?: string;
    readonly description?: string;
}

const LOCALES_DIR = "locales";

/** 源语言目录里 `manifest.<field>` 的文字；没写为 undefined，写成了嵌套对象时记一条问题。 */
function manifestText(catalog: MessageCatalog, field: "displayName" | "description", file: string, problems: ManifestProblem[]): string | undefined {
    const section = catalog.manifest;
    if (section === undefined) return undefined;
    if (typeof section === "string") {
        problems.push({path: file, message: "manifest 要写成对象（manifest.displayName、manifest.description），这里是字符串"});
        return undefined;
    }
    const value = section[field];
    if (value === undefined || typeof value === "string") return value;
    problems.push({path: file, message: `manifest.${field} 要写成字符串`});
    return undefined;
}

/**
 * 读作者的消息目录：没有 `l10n` 也没有 `locales/` 时为 null；规则见文件头的作者合同。`locales/` 里只放 `<语言>.json`，文件名
 * 要是规范写法的语言标签，内容按 nb-runtime 的目录规则检查；任何一处不合格都让构建失败，写错的目录不能当没写。
 */
async function readAuthorCatalogs(root: string, raw: Record<string, unknown>, author: AuthorPackage): Promise<AuthorCatalogs | null> {
    const field = raw.l10n;
    const directory = join(root, LOCALES_DIR);
    const hasDirectory = existsSync(directory);
    if (field === undefined && !hasDirectory) return null;
    const fail = (problems: ReadonlyArray<ManifestProblem>): never => {
        throw new PluginBuildError("Invalid message catalogs", problems);
    };
    if (field === undefined) fail([{path: "l10n", message: "有 locales/ 目录时要在 package.json 写 l10n.source（源语言）"}]);
    if (typeof field !== "object" || field === null || Array.isArray(field) || Object.keys(field).some((key) => key !== "source")) {
        fail([{path: "l10n", message: "只写 {source: <源语言>}，语言列表由 locales/ 里的文件得出"}]);
    }
    const source = (field as {readonly source?: unknown}).source;
    if (typeof source !== "string") return fail([{path: "l10n.source", message: "要写源语言，例如 zh-CN"}]);
    const sourceProblem = localeTagProblem(source);
    if (sourceProblem !== null) fail([{path: "l10n.source", message: sourceProblem}]);
    if (!hasDirectory) fail([{path: LOCALES_DIR, message: `没有 locales/ 目录：源语言的目录要放在 locales/${source}.json`}]);

    const problems: ManifestProblem[] = [];
    const files: Array<{readonly tag: string; readonly text: string}> = [];
    let sourceCatalog: MessageCatalog | null = null;
    for (const entry of (await readdir(directory, {withFileTypes: true})).sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
        const file = `${LOCALES_DIR}/${entry.name}`;
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
            problems.push({path: file, message: "locales/ 里只放 <语言>.json 文件"});
            continue;
        }
        const tag = entry.name.slice(0, -".json".length);
        const tagProblem = localeTagProblem(tag);
        if (tagProblem !== null) {
            problems.push({path: file, message: `文件名${tagProblem}`});
            continue;
        }
        const text = await readFile(join(directory, entry.name), "utf8");
        const parsed = parseCatalog(text);
        if (!parsed.ok) {
            problems.push(...parsed.problems.map((problem) => ({path: file, message: problem.path === "" ? problem.message : `${problem.path}：${problem.message}`})));
            continue;
        }
        if (tag === source) sourceCatalog = parsed.catalog;
        files.push({tag, text});
    }
    if (!files.some((item) => item.tag === source) && !problems.some((problem) => problem.path === `${LOCALES_DIR}/${source}.json`)) {
        problems.push({path: LOCALES_DIR, message: `缺少源语言 ${source} 的目录 locales/${source}.json`});
    }
    for (const name of ["displayName", "description"] as const) {
        if (author[name] !== undefined) problems.push({path: name, message: `有消息目录时${name === "displayName" ? "显示名" : "说明"}写在源语言目录的 manifest.${name}，不写在 package.json`});
    }
    const sourceFile = `${LOCALES_DIR}/${source}.json`;
    const displayName = sourceCatalog === null ? undefined : manifestText(sourceCatalog, "displayName", sourceFile, problems);
    const description = sourceCatalog === null ? undefined : manifestText(sourceCatalog, "description", sourceFile, problems);
    if (problems.length > 0) fail(problems);
    // 源语言排在最前，其余按标签排序：生成的清单与产物跨机器一致。
    const locales = [source, ...files.map((item) => item.tag).filter((tag) => tag !== source)];
    return {l10n: {source, locales}, files, ...(displayName === undefined ? {} : {displayName}), ...(description === undefined ? {} : {description})};
}

/**
 * 作者 `package.json` 里档案字段下的入口定义模块；没写为 undefined。写了但不是字符串数组时构建失败：写错的设置不能当没写，
 * 否则会改找缺省的模块、静默漏掉作者指定的入口。
 */
function definitionsField(raw: Record<string, unknown>, field: string): ReadonlyArray<string> | undefined {
    const settings = raw[field];
    if (settings === undefined) return undefined;
    const path = `${field}.definitions`;
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) throw new PluginBuildError("插件目录的 package.json 不合规则", [{path: field, message: "必须是对象"}]);
    const definitions = (settings as {readonly definitions?: unknown}).definitions;
    if (definitions === undefined) return undefined;
    if (!Array.isArray(definitions)) throw new PluginBuildError("插件目录的 package.json 不合规则", [{path, message: "必须是入口定义模块路径的数组"}]);
    const problems = definitions.flatMap((item, index) => (typeof item === "string" && item !== "" ? [] : [{path: `${path}.${String(index)}`, message: "必须是非空的模块路径"}]));
    if (problems.length > 0) throw new PluginBuildError("插件目录的 package.json 不合规则", problems);
    return definitions as ReadonlyArray<string>;
}

/**
 * 单文件组件的编译。编译器直接交给插件：模块执行环境（`runnerImport`）里插件不会自己去找 `vue/compiler-sfc`，按作者目录
 * 也不一定找得到（作者项目里的 vue 只是 peer 依赖）。
 */
function vuePlugin(): Plugin {
    return vue({compiler});
}

/**
 * 执行描述与入口定义模块，只读声明、不调用 `activate`。用一个不监听端口的 Vite 开发服务的 SSR 加载：它与产物构建同一套
 * 插件与别名，能加载 `.vue` 与 TypeScript。关掉依赖发现：发现进行中时 `close()` 不结算。关掉 WebSocket 服务：中间件模式
 * 下 `hmr: false` 也仍会监听固定的 HMR 端口，同一台机器上并行构建时端口被占，报错打到输出里。
 */
async function loadModules(root: string, alias: ReadonlyArray<BuildAlias>, files: ReadonlyArray<string>, verbose: boolean): Promise<Array<Record<string, unknown>>> {
    const server = await createServer({
        configFile: false,
        root,
        // 缺省不打印：执行出错时 Vite 先打一段自己的日志与堆栈，作者的错误淹在里面；这里自己报（evaluationProblem）。
        logLevel: verbose ? "info" : "silent",
        appType: "custom",
        plugins: [vuePlugin()],
        resolve: {alias: [...alias]},
        server: {middlewareMode: true, hmr: false, ws: false, watch: null},
        optimizeDeps: {noDiscovery: true, include: []},
    });
    try {
        const loaded: Array<Record<string, unknown>> = [];
        for (const file of files) {
            try {
                loaded.push(await server.ssrLoadModule(file));
            } catch (error) {
                if (error instanceof Error) server.ssrFixStacktrace(error);
                throw new PluginBuildError("执行入口定义失败", [evaluationProblem(error, root, file, verbose)]);
            }
        }
        return loaded;
    } finally {
        await server.close();
    }
}

/**
 * 堆栈里的一个位置：`at 名字 (文件:行:列)` 或 `at 文件:行:列`，文件可以是 `file://` 地址或带盘符的路径。路径里可以有括号与
 * 空格（目录叫 `author (copy)` 很常见），所以不按括号切：从 `at ` 或最左边的 `(` 后面第一个像路径开头的地方起，到行尾的
 * `:行:列` 为止。
 */
const STACK_FRAME = /(?:^at |\()((?:file:\/\/)?(?:\/|[A-Za-z]:[\\/]).*?):(\d+):(\d+)\)?$/u;

/**
 * 执行入口定义时抛出的错误 → 一条构建问题。路径是堆栈里第一个落在作者目录里（不在 `node_modules`）的位置，写成
 * “文件:行:列”：错误常常抛在被引入的模块里（例如命令写在 `shared/contracts.ts`），不是正在执行的那个入口文件。找不到作者
 * 的位置（打包器或依赖自己出错）时路径是那个入口文件，消息后面带堆栈的第一个位置。`verbose` 时消息后面附完整堆栈。
 * 作者目录的路径里有空格时也走这条退路：Vite 执行模块时用 `//# sourceURL=<路径>` 标出文件，Bun（1.4）不认带空格的
 * `sourceURL`，堆栈里只剩 Vite 自己的文件。
 */
function evaluationProblem(error: unknown, root: string, file: string, verbose: boolean): ManifestProblem {
    const message = error instanceof Error ? error.message : String(error);
    const frames = (error instanceof Error ? error.stack ?? "" : "").split("\n").slice(1).flatMap((line) => {
        const match = STACK_FRAME.exec(line.trim());
        if (match === null) return [];
        const path = match[1]!.startsWith("file://") ? fileURLToPath(match[1]!) : match[1]!;
        return [{path, line: match[2]!, column: match[3]!}];
    });
    const own = frames.find((frame) => isInside(frame.path, root) && !frame.path.split(sep).includes("node_modules"));
    const stack = verbose && error instanceof Error && error.stack !== undefined ? `\n${error.stack}` : "";
    if (own !== undefined) return {path: `${relative(root, own.path)}:${own.line}:${own.column}`, message: `${message}${stack}`};
    const first = frames[0];
    return {path: relative(root, file), message: `${message}${stack === "" && first !== undefined ? `（${first.path}:${first.line}:${first.column}）` : stack}`};
}

/**
 * 作者项目里装的包的根目录（真实路径）；没有这个包时为 null。按 Node 的办法逐级找 `node_modules/<包名>`，不用
 * `require.resolve`：Bun 的解析会套用 tsconfig 的路径别名，仓库里会把 SDK 解析进应用源码。
 */
async function packageRoot(fromRoot: string, name: string): Promise<string | null> {
    for (let directory = fromRoot; ; directory = dirname(directory)) {
        const candidate = join(directory, "node_modules", name);
        if (existsSync(join(candidate, "package.json"))) return realpath(candidate);
        if (dirname(directory) === directory) return null;
    }
}

function isNodeBuiltin(specifier: string): boolean {
    return specifier.startsWith("node:") || specifier === "bun" || specifier.startsWith("bun:") || builtinModules.includes(specifier);
}

/** `@vue/runtime-core`、`@vue/runtime-dom` 的引用改成外部的 `vue`。在 `external` 判断之后、解析时改写：别名做不到。 */
function vueRuntimePlugin(): Plugin {
    return {
        name: "plugin-vue-runtime",
        enforce: "pre",
        resolveId: (id) => (VUE_REEXPORTED.test(id) ? {id: "vue", external: true} : null),
    };
}

/**
 * 记下打包器的模块图：打进了哪些模块、留下了哪些外部引用、各是谁引入的。外部引用从打进来的每个模块的导入里找：Rolldown
 * 输出块的 `imports`、`dynamicImports` 不列外部模块的动态导入，外部模块的 `getModuleInfo` 也不带 `importers`（1.1 实测）。
 * 磁盘上的模块（打进来的，和没用到而被摇掉的）id 是绝对路径，`\0` 开头的是虚拟模块；剩下的说明符就是外部引用。
 */
function factsPlugin(facts: BundleFacts): Plugin {
    return {
        name: "plugin-bundle-facts",
        generateBundle(_options, bundle) {
            const record = (id: string, importer: string | null): void => {
                if (!isAbsolute(id) && !id.startsWith("\0") && !Object.hasOwn(bundle, id) && !facts.externals.has(id)) facts.externals.set(id, importer);
            };
            for (const output of Object.values(bundle)) {
                if (output.type !== "chunk") continue;
                facts.modules.push(...output.moduleIds);
                for (const module of output.moduleIds) {
                    const info = this.getModuleInfo(module);
                    for (const id of [...(info?.importedIds ?? []), ...(info?.dynamicallyImportedIds ?? [])]) record(id, module);
                }
                // 打包器自己的运行时辅助代码（例如服务端产物里的 `node:module`）没有模块信息。
                for (const id of output.imports) record(id, null);
            }
        },
    };
}

/**
 * 浏览器产物的登记外壳：CommonJS 模块体包进工厂函数，脚本执行时交给宿主；外壳经 banner 与 footer 加上，source map 由
 * 打包器一并换算。
 * - `"use strict"` 写在工厂函数体开头：作者写的是 ES 模块，本来就是严格模式，服务端产物（ESM）也是；包成脚本里的普通函数
 *   后不写就成了非严格，同一份源码两端语义不同。
 * - 脚本地址在脚本执行时记下：`document.currentScript` 只在脚本同步执行期间有值，工厂是之后每次激活才调用的。
 *   `import.meta.url` 在构建时换成它（见 `buildEntry` 的 `define`）。外层的块让这个变量不落到全局。
 */
const SCRIPT_URL = "__pluginScriptUrl";

function registerBanner(registryGlobal: string): string {
    return `{const ${SCRIPT_URL} = document.currentScript.src; globalThis[${JSON.stringify(registryGlobal)}].register(${SCRIPT_URL}, function (module, exports, require) {"use strict";`;
}
const REGISTER_FOOTER = "});}";

/** 入口的外壳模块：按读声明时记下的导出名取出插件定义里的这个入口，只导出它的 `activate`。 */
function shellSource(located: LocatedEntry): string {
    return [
        `import * as source from ${JSON.stringify(located.module)};`,
        `const entry = source[${JSON.stringify(located.exportName)}].entries.find((item) => item.id === ${JSON.stringify(located.entry.id)} && item.location === ${JSON.stringify(located.location)});`,
        // 只提供组件、没有初始化逻辑的浏览器入口可以不写 activate（plugin-api.md 的“输入与前置条件”）。
        `export const activate = entry.activate ?? (() => ({}));`,
        "",
    ].join("\n");
}

/**
 * source map 里的源文件路径：相对作者目录，不带构建机的目录结构（产物会发布出去）。作者目录之外的依赖（工作区提升到上层的
 * `node_modules`、软链）取 `node_modules/` 之后的部分；构建时生成的外壳取它在临时目录里的名字。
 */
function sourcePath(file: string, root: string, workDir: string): string {
    const path = isInside(file, workDir) ? join("plugin-build", relative(workDir, file))
        : isInside(file, root) ? relative(root, file)
        : file.includes(`${sep}node_modules${sep}`) ? file.slice(file.lastIndexOf(`${sep}node_modules${sep}`) + 1)
        : join("external", basename(file));
    return path.split(sep).join("/");
}

async function buildEntry(input: {
    readonly root: string;
    readonly profile: PlatformProfile;
    readonly located: LocatedEntry;
    readonly alias: ReadonlyArray<BuildAlias>;
    readonly workDir: string;
}): Promise<{readonly directory: string; readonly facts: BundleFacts}> {
    const {located} = input;
    const shell = join(input.workDir, `${located.entry.id}.shell.ts`);
    await writeFile(shell, shellSource(located));
    const directory = join(input.workDir, located.entry.id);
    const facts: BundleFacts = {modules: [], externals: new Map()};
    const alwaysExternal = hostPackages(input.profile).map(packagePattern);
    const external = (id: string): boolean => !VUE_REEXPORTED.test(id) && (alwaysExternal.some((pattern) => pattern.test(id)) || isNodeBuiltin(id));
    const browser = located.location === "browser";
    try {
        await vite({
            configFile: false,
            root: input.root,
            logLevel: "warn",
            plugins: [vueRuntimePlugin(), vuePlugin(), factsPlugin(facts)],
            resolve: {alias: [...input.alias]},
            define: browser ? {"process.env.NODE_ENV": JSON.stringify("production"), "import.meta.url": SCRIPT_URL} : {},
            build: {
                outDir: directory,
                emptyOutDir: true,
                // 浏览器每次装载都下载、解析整份产物；服务端产物从磁盘读，不压缩以便读栈。
                minify: browser,
                sourcemap: true,
                ssr: browser ? false : shell,
                target: browser ? "es2022" : "node22",
                lib: browser ? {entry: shell, formats: ["cjs"], fileName: () => `${located.entry.id}.js`, cssFileName: located.entry.id} : undefined,
                rolldownOptions: {
                    external,
                    // 插件耗时提示（PLUGIN_TIMINGS）说的是构建预设自带的各个 Vite 插件回调花了多久，作者改不了它们，只会以为构建出了问题。
                    checks: {pluginTimings: false},
                    output: {
                        codeSplitting: false,
                        sourcemapPathTransform: (source, sourcemapPath) => sourcePath(resolve(dirname(sourcemapPath), source), input.root, input.workDir),
                        ...(browser
                            // CommonJS 产物里外部模块的动态导入默认留成 `import(<包名>)`：经典脚本里没有 import map，裸说明符解析失败。
                            // 改成 `require`，与静态导入一样从宿主模块表取。
                            ? {banner: registerBanner(input.profile.registryGlobal), footer: REGISTER_FOOTER, dynamicImportInCjs: false}
                            : {entryFileNames: `${located.entry.id}.js`, format: "es" as const}),
                    },
                },
            },
            ssr: browser ? undefined : {noExternal: true, target: "node"},
        });
    } catch (error) {
        throw bundlerError(error, input.root, located) ?? error;
    }
    return {directory, facts};
}

/**
 * 打包器报告的错误（Rolldown 的错误带 `errors` 数组，每项有错误码、消息与位置）换成 `PluginBuildError`：路径是入口 id，
 * 消息去掉终端颜色码。浏览器入口的“不支持的特性”另说明原因：登记工厂是同步执行的 CommonJS 函数，顶层 await 这类只有 ES
 * 模块才有的写法用不了，作者从没选过输出格式，原样的“cjs 不支持”看不懂。不是这种形状的错误原样抛出。
 */
function bundlerError(error: unknown, root: string, located: LocatedEntry): PluginBuildError | null {
    const errors = typeof error === "object" && error !== null ? (error as {readonly errors?: unknown}).errors : undefined;
    if (!Array.isArray(errors) || errors.length === 0) return null;
    const problems = errors.map((item: {readonly code?: unknown; readonly message?: unknown; readonly id?: unknown; readonly loc?: {readonly line?: unknown; readonly column?: unknown}}): ManifestProblem => {
        const where = typeof item.id === "string" && isAbsolute(item.id) ? `${relative(root, item.id)}${typeof item.loc?.line === "number" ? `:${String(item.loc.line)}:${String(item.loc.column)}` : ""}：` : "";
        const hint = located.location === "browser" && item.code === "UNSUPPORTED_FEATURE" ? "（浏览器入口打成同步执行的登记工厂，不支持顶层 await 这类只有 ES 模块才有的写法：把它挪进 activate）" : "";
        return {path: `entries.${located.entry.id}`, message: `${where}${stripVTControlCharacters(String(item.message ?? item.code)).split("\n")[0]!.trim()}${hint}`};
    });
    return new PluginBuildError("打包失败", problems, {cause: error});
}

/**
 * 纯度检查：打进了不许打进的包，或外部引用不在本位置的宿主模块表里。“未共享”写上引入它的模块：常常是间接依赖引进来的，
 * 作者要知道换哪个库。
 */
function purityProblems(input: {
    readonly profile: PlatformProfile;
    readonly location: BuiltLocation;
    readonly entry: string;
    readonly facts: BundleFacts;
    readonly forbidden: ReadonlyArray<{readonly name: string; readonly directory: string}>;
    readonly root: string;
    readonly workDir: string;
}): ManifestProblem[] {
    const {location, entry, facts, forbidden} = input;
    const problems: ManifestProblem[] = [];
    const allowed = location === "browser" ? input.profile.sharedModules.browser : input.profile.sharedModules.server;
    for (const [specifier, importer] of facts.externals) {
        if (allowed.includes(specifier) || (location !== "browser" && isNodeBuiltin(specifier))) continue;
        const from = importer === null || !isAbsolute(importer) ? "" : `（由 ${sourcePath(importer.split("?")[0]!, input.root, input.workDir)} 引入）`;
        // 档案给的改法提示：例如应用的私有组件库不发布，作者照着内置插件的写法直接导入时，提示从 SDK 的子路径导入。
        const hint = input.profile.notSharedHints.filter((item) => packagePattern(item.packageName).test(specifier)).map((item) => `；${item.hint}`).join("");
        problems.push({path: `entries.${entry}`, message: `${notSharedMessage(specifier)}${from}：该入口未共享（共享的是 ${allowed.join("、")}）${hint}`});
    }
    const bundled = new Map<string, string>();
    for (const module of facts.modules) {
        // `\0` 开头的是打包器的虚拟模块（运行时辅助代码），不是磁盘上的文件。
        const file = module.split("?")[0]!;
        if (!isAbsolute(file)) continue;
        const hit = forbidden.find((item) => isInside(file, item.directory));
        if (hit !== undefined && !bundled.has(hit.name)) bundled.set(hit.name, file);
    }
    for (const [name, file] of bundled) problems.push({path: `entries.${entry}`, message: `打进了 ${name} 的实现（${file}）：它由宿主提供，插件要从包名导入、不能自带一份`});
    return problems;
}

/**
 * 插件用到的 Lucide 图标类；宿主的公共遮罩规则匹配 `i-lucide-` 前缀，这里只补每个图标的 `--svg`。`texts` 是清单的 JSON
 * 文本（声明里的图标在入口激活前就要显示，而声明不一定写在入口导入的模块里）与各入口模块图里的源码（含打进来的依赖）。
 * 别的图标集（`i-<集>-<名字>`）没有规则，只给警告。拼接出来的类名静态找不到，作者文档里写明。
 */
async function iconRules(texts: Iterable<string>, root: string): Promise<{readonly css: string; readonly warnings: string[]}> {
    const names = new Set<string>();
    const others = new Set<string>();
    for (const text of texts) {
        for (const match of text.matchAll(/\bi-([a-z0-9]+)-([a-z0-9]+(?:-[a-z0-9]+)*)\b/gu)) {
            if (match[1] === "lucide") names.add(match[2]!);
            else others.add(match[0]);
        }
    }
    const warnings = [...others].sort().map((name) => `图标类 ${name} 不是 Lucide 图标：插件只能用 Lucide 图标，它不会显示`);
    if (names.size === 0) return {css: "", warnings};
    const lucide = JSON.parse(await readFile(iconSetFile(root), "utf8")) as Parameters<typeof getIconData>[0];
    const rules: string[] = [];
    for (const name of [...names].sort()) {
        const data = getIconData(lucide, name);
        if (data === null) {
            warnings.push(`源码里的图标类 i-lucide-${name} 在 Lucide 里不存在，不会显示`);
            continue;
        }
        const built = iconToSVG(data, {height: "1em"});
        rules.push(`.i-lucide-${name} { --svg: ${svgToURL(iconToHTML(built.body, built.attributes))}; }`);
    }
    return {css: rules.join("\n"), warnings};
}

/** Lucide 图标数据：先找作者项目的，没有就用构建预设自己依赖的那份。 */
function iconSetFile(root: string): string {
    const id = "@iconify-json/lucide/icons.json";
    try {
        return createRequire(join(root, "package.json")).resolve(id);
    } catch {
        return createRequire(import.meta.url).resolve(id);
    }
}

/** 清单里某个贡献点的贡献：顶层的 `contributes` 加各入口的 `contributes`。 */
function contributionsOf(manifest: Record<string, unknown>, capability: string): ContributionDeclaration[] {
    const lists: unknown[] = [manifest.contributes];
    if (typeof manifest.entries === "object" && manifest.entries !== null) for (const entry of Object.values(manifest.entries)) lists.push((entry as {contributes?: unknown}).contributes);
    return lists.flatMap((list) => (Array.isArray(list) ? (list as ContributionDeclaration[]) : [])).filter((item) => item.capability === capability);
}

/** 目录下的全部文件，相对 `base`，用 `/` 分段。 */
async function filesUnder(directory: string, base: string): Promise<string[]> {
    const found: string[] = [];
    for (const item of await readdir(directory, {withFileTypes: true})) {
        const path = join(directory, item.name);
        if (item.isDirectory()) found.push(...await filesUnder(path, base));
        else found.push(relative(base, path).split(sep).join("/"));
    }
    return found;
}

export async function buildPlugin(profile: PlatformProfile, options: BuildPluginOptions, contributionBuilds: ReadonlyArray<ContributionBuild> = []): Promise<BuildPluginResult> {
    const root = resolve(options.root);
    const outDir = resolve(options.outDir);
    const alias = options.alias ?? [];
    await prepareOutDir(profile, root, outDir, options.clean === true);
    const {author, raw} = await readAuthor(root);
    const id = `${author.publisher}.${author.name}`;
    const catalogs = await readAuthorCatalogs(root, raw, author);
    const displayName = catalogs === null ? author.displayName : catalogs.displayName;
    const description = catalogs === null ? author.description : catalogs.description;

    // 1. 读声明：执行描述与入口定义模块，不调用 activate。
    const definitionFiles = (definitionsField(raw, profile.authorField) ?? DEFAULT_DEFINITIONS.filter((file) => existsSync(join(root, file)))).map((file) => join(root, file));
    const [descriptorModule, ...definitionModules] = await loadModules(root, alias, [join(root, "plugin.ts"), ...definitionFiles], options.verbose === true);
    const descriptor = descriptorModule!.descriptor as PluginDescriptor | undefined;
    if (descriptor === undefined) throw new PluginBuildError("plugin.ts 没有导出 descriptor", [{path: "plugin.ts", message: "要导出插件描述 descriptor"}]);
    if (descriptor.id !== id || descriptor.version !== author.version) {
        throw new PluginBuildError("插件描述与 package.json 不一致", [{path: "plugin.ts", message: `描述是 ${descriptor.id}@${descriptor.version}，package.json 是 ${id}@${author.version}`}]);
    }
    const definitions: PluginDefinition[] = [];
    const located: LocatedEntry[] = [];
    const problems: ManifestProblem[] = [];
    for (const [index, file] of definitionFiles.entries()) {
        const found = Object.entries(definitionModules[index]!).filter((item): item is [string, PluginDefinition] => isPluginDefinition(item[1]));
        if (found.length === 0) problems.push({path: relative(root, file), message: "没有导出插件定义：是否忘了 export？"});
        if (found.length > 1) problems.push({path: relative(root, file), message: `导出了 ${String(found.length)} 个插件定义（${found.map(([name]) => name).join("、")}），一个模块只能导出一个`});
        for (const [exportName, value] of found) {
            if (value.id !== id) {
                problems.push({path: relative(root, file), message: `导出的插件定义的 id 是 ${value.id}，插件是 ${id}`});
                continue;
            }
            definitions.push(value);
            for (const entry of value.entries) {
                if (!(BUILT_LOCATIONS as ReadonlyArray<string>).includes(entry.location)) {
                    problems.push({path: `entries.${entry.id}`, message: `构建预设只构建 ${BUILT_LOCATIONS.join("、")} 位置的入口：${entry.location}`});
                    continue;
                }
                located.push({entry, location: entry.location as BuiltLocation, module: file, exportName});
            }
        }
    }
    // 插件描述的运行位置要与实际有入口的位置一致：宿主按描述决定在哪些实例里装哪一侧的定义，多写或漏写都会让入口静默不登记。
    // 只在定义本身没问题时核对：模块没导出定义时，“少了这个位置的入口”只是它的后果。
    const declared = new Set<string>(descriptor.locations);
    const actual = new Set<string>(located.map((item) => item.location));
    const missing = [...actual].filter((location) => !declared.has(location));
    const unused = [...declared].filter((location) => !actual.has(location));
    const consistent = problems.length === 0;
    if (consistent && missing.length > 0) problems.push({path: "plugin.ts", message: `插件描述的 locations 没有写 ${missing.join("、")}，可是这些位置有入口。在 definePlugin 的 locations 里加上它们`});
    if (consistent && unused.length > 0) problems.push({path: "plugin.ts", message: `插件描述的 locations 写了 ${unused.join("、")}，可是这些位置没有入口。去掉它们，或者检查入口模块是否导出了插件定义`});
    // 描述的自检在全部定义模块执行之后调用：它查的声明定义在这些模块里。
    const check = (descriptor as {readonly [DESCRIPTOR_CHECK]?: DescriptorCheck})[DESCRIPTOR_CHECK];
    for (const message of check?.() ?? []) problems.push({path: "plugin.ts", message});
    if (problems.length > 0) throw new PluginBuildError("入口定义不合格", problems);

    const source: ManifestSource = {
        descriptor: {...descriptor, version: options.dev === undefined ? descriptor.version : devVersion(author.version, options.dev.now)},
        definitions,
        engine: author.engines?.[profile.format.platform.engine] ?? `^${profile.productVersion}`,
        ...(author.pluginVersions === undefined ? {} : {pluginVersions: author.pluginVersions}),
        ...(typeof displayName === "string" ? {displayName} : {}),
        ...(typeof description === "string" ? {description} : {}),
        ...(catalogs === null ? {} : {l10n: catalogs.l10n}),
        ...(author.license === undefined ? {} : {license: author.license}),
        mainOf: (entry: PluginEntryDefinition) => `${entry.id}.js`,
    };
    // 清单表达不了的定义（入口 id 重复、schema 进不了 JSON……）在构建前就报出：下面要按入口 id 写文件，入口 id 的规则由
    // 清单校验保证。
    const early = profile.format.build(source);
    if (early.status === "invalid") throw new PluginBuildError("代码定义写不成清单", early.problems);

    // 2. 逐入口构建（Rolldown 的多入口构建不能同时关掉代码分割）。
    const forbidden: Array<{readonly name: string; readonly directory: string}> = [];
    for (const name of hostPackages(profile)) {
        const directory = await packageRoot(root, name);
        if (directory !== null) forbidden.push({name, directory});
    }
    for (const directory of options.forbiddenDirectories ?? []) forbidden.push({name: "应用源码（SDK 的别名指向这里）", directory: await realpath(directory)});
    // 中间产物放在输出目录里的隐藏目录：最后按文件 rename 到输出目录，同一个目录之下必然在同一个文件系统上。系统临时目录
    // 常在另一个文件系统（tmpfs），输出目录的父目录可能不可写或在挂载点之外，两处都会让 rename 失败。构建被中断时残留也只在
    // 输出目录里，下次构建前要先清空它（输出目录必须为空）。
    await mkdir(outDir, {recursive: true});
    const workDir = await mkdtemp(join(outDir, profile.buildTempPrefix));
    const files: string[] = [];
    const styles: string[] = [];
    const sources = new Set<string>();
    try {
        const built: Array<{readonly located: LocatedEntry; readonly directory: string}> = [];
        for (const item of located) {
            const {directory, facts} = await buildEntry({root, profile, located: item, alias, workDir});
            problems.push(...purityProblems({profile, location: item.location, entry: item.entry.id, facts, forbidden, root, workDir}));
            for (const module of facts.modules) {
                const file = module.split("?")[0]!;
                if (isAbsolute(file) && existsSync(file)) sources.add(file);
            }
            built.push({located: item, directory});
        }
        if (problems.length > 0) throw new PluginBuildError("产物不纯", problems);

        // 2b. 贡献要带的文件（例如 Skill）：写进中间目录，最后与别的产物一起移进输出目录。顶层的名字不能与构建自己写的撞上。
        const extraDir = join(workDir, "contributions");
        await mkdir(extraDir, {recursive: true});
        for (const step of contributionBuilds) {
            const contributions = contributionsOf(early.json, step.capability);
            if (contributions.length === 0) continue;
            const result = await step.build({root, out: extraDir, contributions});
            if (result.problems.length > 0) throw new PluginBuildError(step.failure, result.problems);
        }
        const reserved = new Set(["package.json", "style.css", LOCALES_DIR, ...located.flatMap((item) => [`${item.entry.id}.js`, `${item.entry.id}.js.map`])]);
        const extras = await readdir(extraDir);
        const taken = extras.filter((name) => reserved.has(name));
        if (taken.length > 0) throw new PluginBuildError("贡献带的文件与构建产物重名", taken.map((name) => ({path: name, message: `${name} 是构建预设自己要写的文件，贡献的目录换个名字`})));

        // 3. 样式与图标。
        for (const {located: item, directory} of built) {
            const css = join(directory, `${item.entry.id}.css`);
            if (existsSync(css)) styles.push(await readFile(css, "utf8"));
        }
        // 最终清单只比 early 多一个 style 字段，图标从 early 里找。
        const texts = [JSON.stringify(early.json)];
        for (const file of sources) texts.push(await readFile(file, "utf8"));
        const icons = await iconRules(texts, root);
        const merged = [...new Set(styles.map((text) => text.trim()).filter((text) => text !== ""))];
        const style = merged.length === 0 && icons.css === "" ? null : `@layer components {\n${[...merged, icons.css].filter((text) => text !== "").join("\n")}\n}\n`;

        // 4. 清单与输出。
        const final = profile.format.build({...source, ...(style === null ? {} : {style: "style.css"})});
        if (final.status === "invalid") throw new PluginBuildError("代码定义写不成清单", final.problems);
        const manifest = final.json;

        await mkdir(outDir, {recursive: true});
        for (const {located: item, directory} of built) {
            for (const name of [`${item.entry.id}.js`, `${item.entry.id}.js.map`]) {
                if (!existsSync(join(directory, name))) continue;
                await rename(join(directory, name), join(outDir, name));
                files.push(name);
            }
        }
        for (const name of extras) {
            await rename(join(extraDir, name), join(outDir, name));
            files.push(...await filesUnder(join(outDir, name), outDir));
        }
        if (style !== null) {
            await writeFile(join(outDir, "style.css"), style);
            files.push("style.css");
        }
        if (catalogs !== null) {
            await mkdir(join(outDir, LOCALES_DIR), {recursive: true});
            for (const {tag, text} of catalogs.files) {
                await writeFile(join(outDir, LOCALES_DIR, `${tag}.json`), text);
                files.push(`${LOCALES_DIR}/${tag}.json`);
            }
        }
        await writeFile(join(outDir, "package.json"), `${JSON.stringify(manifest, null, 4)}\n`);
        files.push("package.json");
        return {manifest, files: files.sort(), warnings: icons.warnings};
    } finally {
        await rm(workDir, {recursive: true, force: true});
    }
}

/**
 * 开发版本（作者工具的 `--dev`）：作者的版本加上构建元数据 `+dev.<UTC 时间到秒>.<毫秒>`。用构建元数据而不是预发布段：
 * `0.1.0-dev.…` 比 `0.1.0` 旧，插件页会当成降级，依赖它的插件写的 `^0.1.0` 也不接受预发布版本；构建元数据不改变 semver 的
 * 优先级，`compareVersions` 再按它排出先后，所以每次构建都比上一次新，安装按升级处理。时间与毫秒分成两段数字：连在一起的
 * 17 位超过安全整数，比较不出先后。
 */
export function devVersion(version: string, now: Date): string {
    const [seconds, millis] = now.toISOString().replace(/Z$/u, "").split(".") as [string, string];
    const stamp = `dev.${seconds.replace(/\D/gu, "")}.${String(Number(millis))}`;
    return version.includes("+") ? `${version}.${stamp}` : `${version}+${stamp}`;
}

/**
 * 输出目录里是不是这个插件上次的产物（可以清空重建）：清单的 publisher、name 与作者的相同，并且有 `entries`（构建预设总会写，
 * 作者的 `package.json` 不写）；或者只有中断的构建留下的中间目录。
 */
export async function isPreviousBuild(profile: PlatformProfile, root: string, outDir: string): Promise<boolean> {
    const names = await readdir(outDir);
    if (names.every((item) => item.startsWith(profile.buildTempPrefix))) return true;
    const manifest = join(outDir, "package.json");
    if (!existsSync(manifest)) return false;
    const [author, previous] = await Promise.all([readJsonObject(join(root, "package.json"), "插件目录的 package.json"), readJsonObject(manifest, "输出目录里的 package.json")]);
    return previous.publisher === author.publisher && previous.name === author.name && typeof previous.entries === "object" && previous.entries !== null;
}

/** 输出目录要么不存在、为空，要么（`clean` 时）是这个插件上次的产物，先清空；别的情况拒绝，不递归删除不是自己生成的目录。 */
async function prepareOutDir(profile: PlatformProfile, root: string, outDir: string, clean: boolean): Promise<void> {
    if (!existsSync(outDir) || (await readdir(outDir)).length === 0) return;
    if (!clean) throw new PluginBuildError("输出目录不是空的", [{path: "", message: outDir}]);
    if (!(await isPreviousBuild(profile, root, outDir))) throw new PluginBuildError("输出目录里不是这个插件上次的产物，不清理", [{path: "", message: outDir}]);
    await rm(outDir, {recursive: true});
}
