/**
 * 生成的 SDK 包能在仓库外使用（docs/specs/runtime/plugin-api.md 的“SDK”）：装进一个只有 vue、typebox、TypeScript 与
 * vue-tsc 的作者项目，普通 tsconfig 下类型检查通过（不跳过库文件，含单文件组件里用的 SDK 组件），构建预设的类型也能用，
 * 构建期实现能执行；类型导出的名字钉住，增删要改这里。作者文档、附表与它引用的 Spec 随包，包里 Markdown 的相对链接都打得开。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {manifestFormat} from "../src/plugin-platform-profile";

import {AUTHOR_PACKAGES} from "./dependencies";
import {buildSdk, clearPreviousSdk} from "./pack";
import type {BuiltSdk} from "./pack";
import {authorDirectory} from "./testing/author";
import {registeredFactory, runFactory} from "./testing/browser-artifact";
import {builtSdk} from "./testing/sdk";

let tmp = "";
let project = "";
let built: BuiltSdk;
/** 作者项目里装好的 SDK 包（从 tarball 解开的）。 */
let installed = "";

/**
 * 作者的插件源码：两端的入口、设置项、page 分区、宿主能力与界面文字都从 SDK 取；服务端与浏览器的入口分模块写（服务端产物
 * 不能带浏览器的 SDK）。
 */
const AUTHOR_SOURCES: Readonly<Record<string, string>> = {
    "src/shared.ts": `import {definePlugin} from "@notnotype/nb-plugin-sdk";
import {section, setting} from "@notnotype/nb-plugin-sdk/settings";
import type {SettingsSectionDeclaration} from "@notnotype/nb-plugin-sdk/settings";
import {pluginText} from "@notnotype/nb-plugin-sdk/text";
import type {Text} from "@notnotype/nb-plugin-sdk/text";
import {Type} from "typebox";

export const plugin = definePlugin({id: "acme.hello", version: "1.0.0", locations: ["server", "browser"]});
// 文字引用：键按目录的类型核对，复数形归到不带后缀的键。服务端入口也引用本模块，\`/text\` 两端都能用。
export interface Catalog {greeting: {hello: string; files_one: string; files_other: string}}
export const text = pluginText<Catalog>(plugin.id);
export const files: Text = text("greeting.files", {count: 2});
// @ts-expect-error 目录里没有这个键。
export const typo = text("greeting.helo");
// list 分区与设置项：顶层声明，写进插件描述。
export const list = section(plugin, {name: "list", title: "你好", icon: "i-lucide-smile", groups: [{id: "basic", title: {"zh-CN": "基本", "en-US": "Basic"}}]});
export const greeting = setting(plugin, {name: "greeting", schema: Type.String(), default: "hi", title: "问候", layers: ["user"], applies: "now", section: list, group: "basic"});
// @ts-expect-error list 分区没有 layout（那是 page 分区的字段）。
export const wrong: SettingsSectionDeclaration = {title: {"zh-CN": "错", "en-US": "Wrong"}, icon: "i-lucide-x", category: "plugins", layout: "fill"};
export const descriptor = plugin.descriptor([greeting, list]);
`,
    "src/backend.ts": `import {hostClockKey} from "@notnotype/nb-plugin-sdk";
import {defineStore} from "@notnotype/nb-plugin-sdk/state";

import {plugin} from "./shared";

export const counter = defineStore("counter", () => ({state: {count: 0}, actions: {}}));
export const server = plugin.definition([plugin.entry({location: "server", dependencies: [{key: hostClockKey}], activate: (context) => {
    const now: number = context.services.require(hostClockKey).now();
    void now;
    return {};
}})]);
`,
    "src/web.ts": `import {command} from "@notnotype/nb-plugin-sdk/commands";
import {settingsKey} from "@notnotype/nb-plugin-sdk/settings";
import {choices, settingsPage} from "@notnotype/nb-plugin-sdk/settings/browser";
import type {OptionSource} from "@notnotype/nb-plugin-sdk/settings/browser";
import {statusItem, view} from "@notnotype/nb-plugin-sdk/workbench";
import type {ItemImplementation} from "@notnotype/nb-plugin-sdk/workbench";
// 静态导入单文件组件：构建预设读入口定义时会执行到它对 SDK 组件的导入，组件的构建期实现要在 SDK 包里。
import HelloView from "./HelloView.vue";
import {plugin} from "./shared";

const panel = view(plugin, {name: "panel", title: {"zh-CN": "你好", "en-US": "Hello"}, icon: "i-lucide-smile", load: async () => HelloView});
const page = settingsPage(plugin, {name: "main", title: "你好", icon: "i-lucide-smile", load: async () => ({default: {}})});
// 选项来源：给设置项的下拉列表供数据。
const voices = choices(plugin, {name: "voices"});
const options = (): OptionSource<string> => ({status: "ready", items: [{value: "calm", label: {"zh-CN": "平静", "en-US": "Calm"}}]});
const say = command(plugin, {name: "say", title: "打招呼", description: "Say hello", effect: "read"});
const status = statusItem(plugin, {name: "status", title: "你好", order: 100, command: say});
const item: ItemImplementation = {text: () => "hi", tooltip: () => "hello", state: () => "normal"};
export const browser = plugin.definition([plugin.entry({
    location: "browser",
    activationEvents: ["onStartup"],
    dependencies: [{key: settingsKey}],
    contributions: {panel, page, voices, say, status},
    activate: () => ({contributions: {
        panel: panel.implement(() => ({greeting: "hi"})),
        page: page.implement(),
        voices: voices.implement(options),
        say: say.implement(() => ({ok: true, value: null})),
        status: status.implement(item),
    }}),
})]);
`,
    "src/HelloView.vue": `<script setup lang="ts">
import {Button} from "@notnotype/nb-plugin-sdk/components";
import {usePluginText} from "@notnotype/nb-plugin-sdk/text/browser";
import type {ViewContext} from "@notnotype/nb-plugin-sdk/workbench";

import type {Catalog} from "./shared";

const props = defineProps<{context: ViewContext; greeting: string}>();
const text = usePluginText<Catalog>("acme.hello");
</script>

<template>
    <div class="hello"><Button variant="primary">{{ props.greeting }}</Button><span>{{ props.context.id }}</span><span>{{ text("greeting.hello") }}</span></div>
</template>

<style scoped>
.hello {
    padding: var(--space-4);
}
</style>
`,
    // 作者自己的构建脚本：用构建预设的类型，不是入口定义（不在 nbook.definitions 里）。
    "src/build.ts": `import {buildPlugin, PluginBuildError} from "@notnotype/nb-plugin-sdk/build";
import type {BuildPluginOptions, BuildPluginResult} from "@notnotype/nb-plugin-sdk/build";

const options: BuildPluginOptions = {root: ".", outDir: "dist", alias: [{find: /^~\\//u, replacement: "./src/"}]};
export async function run(): Promise<BuildPluginResult | ReadonlyArray<string>> {
    try {
        return await buildPlugin(options);
    } catch (error) {
        if (error instanceof PluginBuildError) return error.problems.map((problem) => \`\${problem.path}：\${problem.message}\`);
        throw error;
    }
}
`,
};

/** Markdown 行内链接里的相对路径（去掉锚点并解码）；绝对地址与页内锚点不算。 */
function relativeLinks(markdown: string): string[] {
    return [...markdown.matchAll(/\]\(([^()\s]+)\)/gu)]
        .map((match) => match[1]!)
        .filter((url) => !/^[a-z][a-z0-9+.-]*:/iu.test(url) && !url.startsWith("#"))
        .map((url) => decodeURIComponent(url.split("#", 1)[0]!));
}

/** `.d.ts` 末尾 `export {…}` 里导出的名字（`a as b` 取 b，去掉 `type`）。 */
function declaredExports(text: string): string[] {
    const list = /export \{([^}]*)\};?\s*$/u.exec(text.trimEnd())?.[1];
    if (list === undefined) throw new Error("声明文件末尾没有 export 列表");
    return list.split(",").map((item) => item.trim().replace(/^type /u, "").split(" as ").at(-1)!.trim()).filter((name) => name !== "").sort();
}

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-sdk", "pack");
    built = await builtSdk();
    // 作者项目：装上 SDK 的 tarball 与作者机器上要有的包（peer 依赖、TypeScript 与构建预设的依赖，链到仓库里同一份，不联网）。
    project = await authorDirectory(join(tmp, "author"), built.tarball);
    installed = join(project, "node_modules/@notnotype/nb-plugin-sdk");
    await mkdir(join(project, "src"), {recursive: true});
    await writeFile(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: false, lib: ["ES2020", "DOM"]}, include: ["src"]}));
    for (const [path, text] of Object.entries(AUTHOR_SOURCES)) await writeFile(join(project, path), text);
    await writeFile(join(project, "package.json"), JSON.stringify({publisher: "acme", name: "hello", version: "1.0.0", type: "module", nbook: {definitions: ["src/backend.ts", "src/web.ts"]}}));
    await writeFile(join(project, "plugin.ts"), `export {descriptor} from "./src/shared";\n`);
}, 240_000);

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("生成的 SDK 包", () => {
    it("peer 依赖是 vue、@vue/reactivity（与 vue 同一范围，两者成对发布）与 typebox；./build 带类型", async () => {
        const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8")) as {peerDependencies: Record<string, string>; exports: Record<string, Record<string, string>>};
        expect(Object.keys(manifest.peerDependencies).sort()).toEqual(["@vue/reactivity", "typebox", "vue"]);
        expect(manifest.peerDependencies["@vue/reactivity"]).toBe(manifest.peerDependencies.vue!);
        expect(manifest.exports["./build"]).toEqual({types: "./build.d.ts", import: "./build.js"});
    });

    it("发布用的元数据：许可、源码仓库、公开访问；tarball 里带 AGPL 的 LICENSE 与打进去的第三方包的许可", async () => {
        const manifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8")) as Record<string, unknown>;
        expect(manifest).toMatchObject({license: "AGPL-3.0-only", repository: {directory: "packages/neuro-book/plugin-sdk"}, publishConfig: {access: "public"}, files: expect.arrayContaining(["LICENSE", "THIRD-PARTY-NOTICES.md"])});
        expect(manifest).toMatchObject({keywords: expect.arrayContaining(["neurobook", "plugin"]), homepage: expect.stringContaining("plugin-sdk"), bugs: {url: expect.stringContaining("/issues")}});
        expect(await readFile(join(installed, "LICENSE"), "utf8")).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
        const notices = await readFile(join(installed, "THIRD-PARTY-NOTICES.md"), "utf8");
        expect(notices).toContain("## 构建期实现");
        expect(notices).not.toContain("@notnotype/");
    });

    it("tarball 里有示例插件的源码与模板（含 `_gitignore`）；不带场景测试、场地、测试文件与构建产物；模板的开发依赖带上作者项目自己装的包", async () => {
        const files = (await readdir(installed, {recursive: true})).map((file) => file.split("\\").join("/"));
        expect(files).toEqual(expect.arrayContaining(["examples/plugins/focus/plugin.ts", "examples/plugins/focus/web/FocusPanel.vue", "examples/external/declarative/package.json", "template/_gitignore", "template/_package.json"]));
        expect(files.filter((file) => file.startsWith("examples/") && (/^examples\/(scenarios|testing)\//u.test(file) || file.endsWith(".test.ts") || file.split("/").includes("dist")))).toEqual([]);
        const template = JSON.parse(await readFile(join(installed, "template/_package.json"), "utf8")) as {devDependencies: Record<string, string>};
        expect(Object.keys(template.devDependencies).sort()).toEqual(["@notnotype/nb-plugin-sdk", ...AUTHOR_PACKAGES].sort());
        expect(Object.values(template.devDependencies).filter((range) => range.includes("__") && range !== "^__SDK_VERSION__")).toEqual([]);
    });

    it("输出目录是上次生成的 SDK 包：清空，旧文件不留", async () => {
        const previous = join(tmp, "previous");
        await mkdir(previous, {recursive: true});
        await writeFile(join(previous, "package.json"), JSON.stringify({name: "@notnotype/nb-plugin-sdk", version: "0.0.0"}));
        await writeFile(join(previous, "stale.js"), "");
        await clearPreviousSdk(previous);
        expect(existsSync(previous)).toBe(false);
    });

    it("带作者文档、导出、组件与主题变量三份附表和作者文档引用的 Spec；包里 Markdown 的相对链接都能打开，指向包外的改成文字", async () => {
        const sdk = installed;
        const exportsDoc = await readFile(join(sdk, "docs/exports.md"), "utf8");
        // 每个子路径一节，写明服务端能不能用；名字取自入口文件。
        expect(exportsDoc).toContain("## `@notnotype/nb-plugin-sdk/storage`");
        expect(exportsDoc).toContain("`defineRecord`");
        expect(exportsDoc).toMatch(/## `@notnotype\/nb-plugin-sdk\/workbench`\n\n- 服务端入口能不能用：不能/u);
        expect(await readFile(join(sdk, "docs/components.md"), "utf8")).toContain("`Button`");
        const tokens = await readFile(join(sdk, "docs/tokens.md"), "utf8");
        expect(tokens).toContain("`--space-2`");
        expect(tokens).toContain("`--accent-main`");
        // 仓库里的作者文档指向 docs/specs/ 的每一份 Spec，包里都有副本。
        const sourceReadme = fileURLToPath(new URL("./README.md", import.meta.url));
        const specsRoot = fileURLToPath(new URL("../../../docs/specs/", import.meta.url));
        const referenced = [...new Set(relativeLinks(await readFile(sourceReadme, "utf8")).map((url) => relative(specsRoot, resolve(dirname(sourceReadme), url))))];
        expect(referenced.length).toBeGreaterThan(0);
        expect(referenced.filter((spec) => !existsSync(join(sdk, "specs", spec)))).toEqual([]);
        // 包里的 README 不指向包外：作者装的包里只有这些文件。
        const links = relativeLinks(await readFile(join(sdk, "README.md"), "utf8"));
        expect(links.length).toBe(relativeLinks(await readFile(sourceReadme, "utf8")).length);
        expect(links.filter((url) => relative(sdk, resolve(sdk, url)).startsWith("..") || !existsSync(resolve(sdk, url)))).toEqual([]);
        // Spec 副本里指向没随包的文档的链接改成文字：包里的链接都打得开，包外的那份写明在仓库里的路径。
        const broken: string[] = [];
        for (const file of await readdir(join(sdk, "specs"), {recursive: true})) {
            if (!file.endsWith(".md")) continue;
            const text = await readFile(join(sdk, "specs", file), "utf8");
            for (const url of relativeLinks(text)) {
                const target = resolve(dirname(join(sdk, "specs", file)), url);
                if (relative(sdk, target).startsWith("..") || !existsSync(target)) broken.push(`${file} → ${url}`);
            }
        }
        expect(broken).toEqual([]);
        expect(await readFile(join(sdk, "specs/runtime/plugin-api.md"), "utf8")).toContain("（仓库里的 `docs/adr/");
    });

    it("输出目录不是空的、也不是上次生成的 SDK 包：拒绝，不删里面的文件", async () => {
        const other = join(tmp, "not-sdk");
        await mkdir(other, {recursive: true});
        await writeFile(join(other, "package.json"), JSON.stringify({name: "my-project"}));
        await expect(buildSdk(other)).rejects.toThrow("不清理");
        expect(await readdir(other)).toEqual(["package.json"]);
    });

    it("仓库外的作者项目用普通 tsconfig 类型检查通过，声明文件本身也检查（不跳过库文件），单文件组件里的 SDK 组件有类型", async () => {
        const result = Bun.spawnSync({cmd: ["node", join(project, "node_modules/vue-tsc/bin/vue-tsc.js"), "-p", project], cwd: project, stdout: "pipe", stderr: "pipe"});
        expect(`${result.stdout.toString()}${result.stderr.toString()}`).toBe("");
        expect(result.exitCode).toBe(0);
    }, 60_000);

    it("声明文件写错的地方会被类型检查拦下：page 分区少了必填的 icon", async () => {
        await writeFile(join(project, "src/wrong.ts"), `import {settingsPage} from "@notnotype/nb-plugin-sdk/settings/browser";\nimport {plugin} from "./shared";\nsettingsPage(plugin, {name: "x", title: "x", load: async () => ({default: {}})});\n`);
        try {
            const result = Bun.spawnSync({cmd: ["node", join(project, "node_modules/vue-tsc/bin/vue-tsc.js"), "-p", project], cwd: project, stdout: "pipe"});
            expect(result.stdout.toString()).toContain("'icon'");
        } finally {
            await rm(join(project, "src/wrong.ts"));
        }
    }, 60_000);

    it("作者 API 写错时，类型检查的诊断写明是哪一项：漏写、多写、浏览器助手写进服务端入口、视图属性名写错、没声明的依赖、设置项名、要参数的命令、没声明 remoteProvides", async () => {
        await writeFile(join(project, "src/wrong-entry.ts"), `import {definePlugin, hostClockKey, provideRemote, remoteService} from "@notnotype/nb-plugin-sdk";
import {setting} from "@notnotype/nb-plugin-sdk/settings";
import {Type} from "typebox";
import {command} from "@notnotype/nb-plugin-sdk/commands";
import {view} from "@notnotype/nb-plugin-sdk/workbench";
import HelloView from "./HelloView.vue";
const plugin = definePlugin({id: "acme.hello", version: "1.0.0", locations: ["server", "browser"]});
const say = command(plugin, {name: "say", title: "x", description: "x", effect: "write"});
const ping = command(plugin, {name: "ping", title: "x", description: "x", effect: "read"});
const panel = view(plugin, {name: "panel", title: "x", icon: "i-lucide-x", load: async () => HelloView});
const lazyPanel = view(plugin, {name: "lazy", title: "x", icon: "i-lucide-x", load: () => import("./HelloView.vue")});
const echo = remoteService(plugin, {name: "echo", version: 1, provider: "server", callers: ["browser"], methods: {get: {input: Type.Object({}), output: Type.String(), effect: "read"}}});
export const missing = plugin.entry({location: "server", contributions: {say, ping}, activate: () => ({contributions: {say: say.implement(() => ({ok: true, value: null}))}})});
export const extra = plugin.entry({location: "server", contributions: {say}, activate: () => ({contributions: {say: say.implement(() => ({ok: true, value: null})), surplus: ping.implement(() => ({ok: true, value: null}))}})});
export const misplaced = plugin.entry({location: "server", contributions: {panel}, activate: () => ({contributions: {panel: panel.implement()}})});
export const props = lazyPanel.implement(() => ({greting: "hi"}));
export const undeclared = plugin.entry({location: "server", activate: (context) => { void context.services.require(hostClockKey); return {}; }});
export const kebab = setting(plugin, {name: "daily-goal", schema: Type.Integer(), default: 0, title: "x"});
export const needsArgs = command(plugin, {name: "add", title: "x", description: "x", effect: "write", args: Type.Object({words: Type.Integer()})});
export const noProvides = plugin.entry({location: "server", activate: async () => ({remote: [provideRemote(echo, () => ({methods: {get: () => ({ok: true, value: "x"})}}))]})});
`);
        try {
            const result = Bun.spawnSync({cmd: ["node", join(project, "node_modules/vue-tsc/bin/vue-tsc.js"), "-p", project, "--pretty", "false"], cwd: project, stdout: "pipe"});
            // 一条诊断是“文件(行,列): error …”一行，加上它下面缩进的说明链。
            const diagnostics = result.stdout.toString().split(/\n(?=\S)/u);
            const at = (row: number): string => diagnostics.filter((text) => text.startsWith(`src/wrong-entry.ts(${String(row)},`)).join("\n");
            expect(at(13)).toContain("'ping'");
            expect(at(14)).toContain("多写的贡献实现：surplus");
            expect(at(15)).toContain("只能写进浏览器入口：panel");
            expect(at(16)).toContain("greting");
            // 规则提前到编辑器：报错里写着问题与改法。
            expect(at(17)).toContain("这个服务没有写进入口的 dependencies");
            expect(at(18)).toContain("设置项名用小驼峰（点分段）：daily-goal");
            expect(at(19)).toContain("命令参数有必填项");
            expect(at(20)).toContain("入口没有声明 remoteProvides");
        } finally {
            await rm(join(project, "src/wrong-entry.ts"));
        }
    }, 60_000);

    it("构建期实现能在作者项目里执行，运行时导出与源码的导出面相同", async () => {
        const probe = join(project, "probe.mjs");
        await writeFile(probe, `const index = await import("@notnotype/nb-plugin-sdk");\nconsole.log(JSON.stringify(Object.keys(index).sort()));\n`);
        const result = Bun.spawnSync({cmd: ["bun", probe], cwd: project, stdout: "pipe", stderr: "pipe"});
        expect(result.stderr.toString()).toBe("");
        expect(JSON.parse(result.stdout.toString())).toEqual(Object.keys(await import("../src/sdk/index")).sort());
    }, 60_000);

    it("类型导出的名字", async () => {
        const actual = Object.fromEntries(await Promise.all(Object.keys(DECLARED).map(async (file) => [file, declaredExports(await readFile(join(installed, `${file}.d.ts`), "utf8"))] as const)));
        expect(actual).toEqual(Object.fromEntries(Object.entries(DECLARED).map(([file, names]) => [file, [...names].sort()])));
        // 组件子路径的声明与源码里逐个列出的名单一致：nb-ui 入口里别的导出不会混进来。
        const listed = [...(await readFile(fileURLToPath(new URL("../src/sdk/components.ts", import.meta.url)), "utf8")).matchAll(/export (?:type )?\{([^}]+)\}/gu)].flatMap((match) => match[1]!.split(",").map((name) => name.trim()).filter((name) => name !== ""));
        expect(declaredExports(await readFile(join(installed, "components.d.ts"), "utf8"))).toEqual([...listed].sort());
        // nb-ui 的模板类型补充（任何组件都接受 ARIA 属性与 role）随组件声明一起交给作者，打开模板严格检查的作者才不会被误报。
        const components = await readFile(join(installed, "components.d.ts"), "utf8");
        expect(components).toContain('declare module "vue"');
        expect(components).toContain('"aria-description"?: string;');
    });

    it("仓库外用生成的包里的构建预设构建插件：清单合格，产物只引用宿主共享的模块", async () => {
        const {buildPlugin} = await import(join(installed, "build.js")) as typeof import("./build");
        const out = join(tmp, "hello-dist");
        const result = await buildPlugin({root: project, outDir: out});
        expect(result.files).toEqual(["browser.js", "browser.js.map", "package.json", "server.js", "server.js.map", "style.css"]);
        const manifest = manifestFormat.read(JSON.parse(await readFile(join(out, "package.json"), "utf8")));
        if (manifest.status !== "valid") throw new Error(JSON.stringify(manifest.problems));
        expect(manifest.manifest.entries.map((entry) => entry.id)).toEqual(["server", "browser"]);
        expect(manifest.manifest.contributes.map((item) => item.id)).toEqual(["acme.hello/greeting", "acme.hello.list"]);
        // 像宿主那样执行浏览器产物，看工厂经 require 真的取了哪些模块。
        const {required} = await runFactory(await registeredFactory(await readFile(join(out, "browser.js"), "utf8")));
        // 单文件组件编译后引用 vue。
        expect([...new Set(required)].sort()).toEqual([
            "@notnotype/nb-plugin-sdk",
            "@notnotype/nb-plugin-sdk/commands",
            "@notnotype/nb-plugin-sdk/components",
            "@notnotype/nb-plugin-sdk/settings",
            "@notnotype/nb-plugin-sdk/settings/browser",
            // 文字的两个入口也由宿主共享：插件取到的翻译端口是窗口注入的那一个。
            "@notnotype/nb-plugin-sdk/text",
            "@notnotype/nb-plugin-sdk/text/browser",
            "@notnotype/nb-plugin-sdk/workbench",
            // 共享模块里的 shared.ts 写设置项的 schema。
            "typebox",
            "vue",
        ]);
    }, 120_000);
});

/** 每个子路径的声明文件导出的名字（类型与值），组件子路径另行对照源码。 */
const DECLARED: Readonly<Record<string, ReadonlyArray<string>>> = {
    "index": ["ActivationContext", "AuthorActivationContext", "AuthorEntry", "AuthorEntryOutput", "BoundImplementation", "ContributionDeclaration", "ContributionDescriptor", "ContributionHandle", "ContributionHelper", "ContributionPointDefinition", "ContributionReceiver", "DiagnosticsService", "EventSource", "PluginBuilder", "PluginDefinition", "PluginDescriptor", "PluginEntryDefinition", "RemoteContract", "RemoteOutcome", "RemoteResult", "RemoteResultFor", "RemoteSink", "RemoteSubscribeOptions", "RemoteSubscription", "RuntimeClock", "ServiceKey", "StateRoot", "defineEntry", "definePlugin", "defineRemoteService", "defineServiceKey", "diagnosticsKey", "eventSource", "fail", "hostClockKey", "hostStateRootKey", "ok", "orThrow", "provideRemote", "provideService", "provideServicePerConsumer", "remoteService"],
    "text": ["CatalogKey", "LocaleMap", "Text", "TextParams", "TextRef", "pluginText"],
    "text/browser": ["BoundText", "TextPort", "usePluginText", "useText"],
    "state": ["definePublicState", "defineStore"],
    "storage": ["RecordDefinition", "RecordHandle", "RecordSnapshot", "Revision", "StorageFailure", "StorageService", "UpdateResult", "WriteResult", "defineRecord", "storageKey"],
    "files": ["Baseline", "CallOptions", "CommitExpect", "CommitOptions", "ReadPath", "ServerFilesResult", "StagedSink", "WorkspaceFiles", "baselineOf", "workspaceFilesKey"],
    "settings": ["SETTINGS_CHOICES_POINT", "SETTINGS_PAGES_POINT", "SETTINGS_SECTIONS_POINT", "SectionHelper", "SettingDefinition", "SettingLayer", "SettingWriteResult", "SettingsChoicesDeclaration", "SettingsFailure", "SettingsPageDeclaration", "SettingsSectionCategory", "SettingsSectionDeclaration", "SettingsService", "defineSetting", "displayLocale", "section", "setting", "settingsChoicesEvent", "settingsKey"],
    "settings/browser": ["ChoicesHelper", "OptionSource", "SettingsChoicesImplementation", "SettingsPageActions", "SettingsPageContext", "SettingsPageHelper", "SettingsPageList", "SettingsPageWriteFailure", "SettingsRow", "SettingsSaveBar", "choices", "settingsPage"],
    "commands": ["COMMANDS_POINT", "CommandDeclaration", "CommandFailure", "CommandFailureCode", "CommandHelper", "CommandImplementation", "CommandResult", "CommandService", "command", "commandServiceKey"],
    "workbench": ["ItemDeclaration", "ItemImplementation", "OPEN_VIEW_COMMAND", "PropsOf", "StatusItemHelper", "ViewContext", "ViewDeclaration", "ViewHelper", "ViewImplementation", "ViewLocation", "WORKBENCH_STATUSBAR_ITEMS_POINT", "WORKBENCH_VIEWS_POINT", "statusItem", "view"],
};
