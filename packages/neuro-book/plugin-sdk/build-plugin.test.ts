/**
 * 构建预设（docs/specs/runtime/plugin-code-loading.md 输出 2、5，plugin-api.md 的“SDK”）：清单由代码定义生成并通过校验；
 * 每个入口一个文件、只导出 activate；浏览器产物登记工厂、只引用宿主模块表；样式包进 @layer components 并带上用到的图标；
 * 纯度检查按模块图拦下打包进来的 Vue、未共享的模块与绕过 SDK 的内核。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {existsSync, statSync} from "node:fs";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {createTestTmpRoot, resolveTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createPluginInventory} from "../src/plugin-platform/backend/inventory";
import {NO_INSTALLED_PLUGINS} from "../src/plugin-platform/backend/startup";
import {BROWSER_SHARED_MODULES, manifestFormat, NEUROBOOK_PROFILE} from "../src/plugin-platform-profile";
import {buildExample, EXAMPLES_ROOT, IN_REPO_BUILD} from "./build-examples";
import {buildPlugin, PluginBuildError} from "./build";
import {registeredFactory, runFactory} from "./testing/browser-artifact";
import {linkAuthorModules} from "./testing/author";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-plugin-build", "build-plugin");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 在临时目录里写一个作者项目：`files` 是相对路径到内容；作者机器上的依赖（加上 `extra`）链到仓库里同一份。 */
async function authorProject(name: string, files: Readonly<Record<string, string>>, extra: ReadonlyArray<string> = []): Promise<string> {
    const root = join(tmp, name);
    await linkAuthorModules(root, extra);
    await writeFile(join(root, "package.json"), JSON.stringify({publisher: "acme", name, version: "1.0.0", type: "module"}));
    // 运行位置按写出的入口模块给：插件描述的 locations 与实际的入口要一致，构建核对。
    const locations = [...("backend/plugin.ts" in files ? ["server"] : []), ...("web/plugin.ts" in files ? ["browser"] : [])];
    await writeFile(join(root, "plugin.ts"), `export const descriptor = {id: "acme.${name}", version: "1.0.0", locations: ${JSON.stringify(locations)}};\n`);
    await writeAll(root, files);
    return root;
}

async function writeAll(root: string, files: Readonly<Record<string, string>>): Promise<void> {
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), {recursive: true});
        await writeFile(join(root, path), text);
    }
}

async function build(root: string) {
    return buildPlugin({root, outDir: join(root, "dist"), ...IN_REPO_BUILD});
}

async function failure(root: string): Promise<ReadonlyArray<string>> {
    try {
        await build(root);
    } catch (error) {
        if (error instanceof PluginBuildError) return error.problems.map((problem) => problem.message);
        throw error;
    }
    throw new Error("期望构建失败");
}

/** 像宿主那样执行一次浏览器产物并激活：返回 activate 的结果与工厂经 require 取过的模块。 */
async function activateBrowser(root: string): Promise<{readonly value: Record<string, unknown>; readonly required: ReadonlyArray<string>}> {
    const {exports, required} = await runFactory(await registeredFactory(await readFile(join(root, "dist/browser.js"), "utf8")));
    const activate = exports.activate as (context: unknown) => Promise<Record<string, unknown>>;
    return {value: await activate({}), required};
}

/** 最近的已存在的上级目录所在的设备。 */
function deviceOf(path: string): number {
    let directory = path;
    while (!existsSync(directory)) directory = dirname(directory);
    return statSync(directory).dev;
}

/** `/dev/shm` 存在且与测试临时根不在同一个文件系统上：才能测跨文件系统。 */
const crossDevice = existsSync("/dev/shm") && deviceOf("/dev/shm") !== deviceOf(resolveTmpRoot());

describe("构建示例 snippets", () => {
    it("清单由代码定义生成并通过校验；只有浏览器入口；样式包进 @layer components、带上分区与按钮的图标", async () => {
        const out = join(tmp, "snippets");
        const result = await buildExample("snippets", out);
        expect(result.files).toEqual(["browser.js", "browser.js.map", "locales/en-US.json", "locales/zh-CN.json", "package.json", "style.css"]);
        const manifest = JSON.parse(await readFile(join(out, "package.json"), "utf8")) as Record<string, unknown>;
        const read = manifestFormat.read(manifest);
        if (read.status !== "valid") throw new Error(JSON.stringify(read.problems));
        expect(read.manifest.id).toBe("example.snippets");
        expect(read.manifest.style).toBe("style.css");
        expect(read.manifest.entries.map((entry) => [entry.id, entry.location, entry.main, entry.activationEvents])).toEqual([["browser", "browser", "browser.js", ["onSettingsPage:example.snippets.main"]]]);
        expect(read.manifest.contributes.map((item) => item.id)).toEqual(["example.snippets/items"]);

        const style = await readFile(join(out, "style.css"), "utf8");
        expect(style.startsWith("@layer components {")).toBe(true);
        for (const icon of ["text-quote", "arrow-up", "arrow-down", "trash-2", "plus"]) expect(style).toContain(`.i-lucide-${icon} { --svg: url(`);
    }, 120_000);

    it("浏览器产物登记工厂；工厂只经宿主的 require 取共享模块，导出 activate", async () => {
        const code = await readFile(join(tmp, "snippets/browser.js"), "utf8");
        const {exports, required} = await runFactory(await registeredFactory(code));
        expect(typeof exports.activate).toBe("function");
        expect([...new Set(required)].every((id) => (BROWSER_SHARED_MODULES as ReadonlyArray<string>).includes(id))).toBe(true);
        // typebox 由宿主共享，不打进产物（plugin-code-loading 的宿主模块表）。
        expect(required).toContain("typebox");
        expect(code).toContain("//# sourceMappingURL=browser.js.map");
    }, 60_000);

    it("source map 的源文件是相对作者目录的路径，不带构建机的目录结构；宿主共享的 typebox 不在里面", async () => {
        const map = JSON.parse(await readFile(join(tmp, "snippets/browser.js.map"), "utf8")) as {sources: string[]};
        expect(map.sources).toContain("web/plugin.ts");
        expect(map.sources.some((source) => source.includes("typebox"))).toBe(false);
        expect(map.sources.filter((source) => source.startsWith("/") || source.startsWith("..") || source.includes(tmp))).toEqual([]);
    });

    it("示例的输出目录里有别的文件：拒绝构建，文件还在；里面是同一个示例上次的产物：照常重建", async () => {
        const out = join(tmp, "snippets-other");
        await mkdir(out, {recursive: true});
        await writeFile(join(out, "notes.txt"), "x");
        await expect(buildExample("snippets", out)).rejects.toBeInstanceOf(PluginBuildError);
        expect(await readdir(out)).toEqual(["notes.txt"]);
        // 输出目录就是示例目录（它的 package.json 有同样的 publisher 与 name）：拒绝，源码还在。
        const source = join(EXAMPLES_ROOT, "snippets");
        const before = (await readdir(source)).sort();
        await expect(buildExample("snippets", source)).rejects.toBeInstanceOf(PluginBuildError);
        expect((await readdir(source)).sort()).toEqual(before);
        const again = await buildExample("snippets", join(tmp, "snippets"));
        expect(again.files).toContain("browser.js");
    }, 120_000);
});

describe("作者项目", () => {
    it("服务端入口是 ESM、只引用宿主共享的 SDK 与 typebox；远程合同写进清单；浏览器入口的定义模块静态导入 .vue 也能生成清单", async () => {
        const root = await authorProject("echo", {
            "shared/contracts.ts": `import {defineRemoteService} from "@notnotype/nb-plugin-sdk";
import {Type} from "typebox";
export const echoContract = defineRemoteService({id: "acme.echo/echo", version: 1, provider: "server", callers: ["browser"], methods: {say: {input: Type.Object({text: Type.String({maxLength: 100})}, {additionalProperties: false}), output: Type.String(), effect: "read"}}});
`,
            "backend/plugin.ts": `import {defineEntry, provideRemote} from "@notnotype/nb-plugin-sdk";
import {echoContract} from "../shared/contracts";
let calls = 0;
export const echoServer = {id: "acme.echo", entries: [defineEntry({id: "server", location: "server", remoteProvides: [echoContract], activate: () => ({remote: [provideRemote(echoContract, () => ({methods: {say: ({text}) => ({ok: true, value: text + String(++calls)})}}))]})})]};
`,
            "web/Panel.vue": `<script setup lang="ts">\nconst props = defineProps<{text: string}>();\n</script>\n<template><p class="echo-panel">{{ props.text }}</p></template>\n<style scoped>.echo-panel { color: var(--text-muted); }</style>\n`,
            "web/plugin.ts": `import {defineEntry} from "@notnotype/nb-plugin-sdk";
import Panel from "./Panel.vue";
import {echoContract} from "../shared/contracts";
export const echoBrowser = {id: "acme.echo", entries: [defineEntry({id: "browser", location: "browser", remoteDelegates: [echoContract], activate: () => {
    (globalThis as {echoPanel?: unknown}).echoPanel = Panel;
    return {};
}})]};
`,
        });
        const result = await build(root);
        expect(result.files).toEqual(["browser.js", "browser.js.map", "package.json", "server.js", "server.js.map", "style.css"]);
        expect(Object.keys(result.manifest.contracts as object)).toEqual(["acme.echo/echo"]);
        const server = await readFile(join(root, "dist/server.js"), "utf8");
        expect([...server.matchAll(/^import .* from "([^"]+)";$/gmu)].map((match) => match[1]).sort()).toEqual(["@notnotype/nb-plugin-sdk", "typebox"]);
        expect(server).toContain("export {");
        expect(await readFile(join(root, "dist/style.css"), "utf8")).toContain(".echo-panel[data-v-");
    }, 120_000);

    it("自带一份 Vue（经相对路径导入 node_modules 里的 vue）：构建失败，指出打进了 vue", async () => {
        const root = await authorProject("own-vue", {
            "web/plugin.ts": `import {ref} from "../node_modules/vue/dist/vue.runtime.esm-bundler.js";\nexport const p = {id: "acme.own-vue", entries: [{id: "browser", location: "browser", activate: () => { ref(0); return {}; }}]};\n`,
        });
        expect(await failure(root)).toEqual([expect.stringContaining("打进了 vue 的实现")]);
    }, 60_000);

    it("引用宿主没有共享的模块（直接导入 nb-ui、绕过 SDK 的内核）：构建失败，写明未共享与引入它的模块；nb-ui 提示改从 SDK 导入组件", async () => {
        const root = await authorProject("unshared", {
            "web/plugin.ts": `import {Button} from "@notnotype/nb-ui/components";\nimport {useNotification} from "@notnotype/nb-ui/notifications";\nexport const p = {id: "acme.unshared", entries: [{id: "browser", location: "browser", activate: () => { useNotification(); void Button; return {}; }}]};\n`,
            "backend/plugin.ts": `import {defineEntry} from "@notnotype/nb-runtime/plugins";\nimport {defineProfile} from "@notnotype/nb-harness/kernel/contracts";\nvoid defineProfile;\nexport const s = {id: "acme.unshared", entries: [defineEntry({id: "server", location: "server", activate: () => ({})})]};\n`,
        }, ["@notnotype/nb-ui", "@notnotype/nb-runtime", "@notnotype/nb-harness"]);
        const problems = await failure(root);
        expect(problems).toContainEqual(expect.stringContaining("引用了宿主没有共享的模块 @notnotype/nb-ui/notifications（由 web/plugin.ts 引入）"));
        expect(problems).toContainEqual(expect.stringMatching(/引用了宿主没有共享的模块 @notnotype\/nb-ui\/components（由 web\/plugin\.ts 引入）.*nb-ui 的组件从 @notnotype\/nb-plugin-sdk\/components 导入/u));
        expect(problems).toContainEqual(expect.stringContaining("引用了宿主没有共享的模块 @notnotype/nb-runtime/plugins（由 backend/plugin.ts 引入）"));
        expect(problems).toContainEqual(expect.stringMatching(/引用了宿主没有共享的模块 @notnotype\/nb-harness\/kernel\/contracts（由 backend\/plugin\.ts 引入）.*@notnotype\/nb-plugin-sdk\/agent/u));
    }, 60_000);

    it("动态导入宿主没有共享的模块（浏览器里的 nb-ui 其它入口、服务端绕过 SDK 的内核）：同样构建失败", async () => {
        const root = await authorProject("dynamic-unshared", {
            "web/plugin.ts": `export const p = {id: "acme.dynamic-unshared", entries: [{id: "browser", location: "browser", activate: async () => { await import("@notnotype/nb-ui/notifications"); return {}; }}]};\n`,
            "backend/plugin.ts": `export const s = {id: "acme.dynamic-unshared", entries: [{id: "server", location: "server", activate: async () => { await import("@notnotype/nb-runtime/plugins"); return {}; }}]};\n`,
        }, ["@notnotype/nb-ui", "@notnotype/nb-runtime"]);
        const problems = await failure(root);
        expect(problems).toContainEqual(expect.stringContaining("引用了宿主没有共享的模块 @notnotype/nb-ui/notifications"));
        expect(problems).toContainEqual(expect.stringContaining("引用了宿主没有共享的模块 @notnotype/nb-runtime/plugins"));
    }, 60_000);

    it("浏览器里动态导入 vue、静态导入 @vue/runtime-core：都经 require 得到宿主模块表里的 vue", async () => {
        const root = await authorProject("vue-imports", {
            "web/plugin.ts": `import {ref as coreRef} from "@vue/runtime-core";\nexport const p = {id: "acme.vue-imports", entries: [{id: "browser", location: "browser", activate: async () => ({coreRef, dynamicRef: (await import("vue")).ref})}]};\n`,
        });
        await build(root);
        const {value, required} = await activateBrowser(root);
        const vue = await import("vue");
        expect(value.coreRef).toBe(vue.ref);
        expect(value.dynamicRef).toBe(vue.ref);
        expect([...new Set(required)]).toEqual(["vue"]);
    }, 60_000);

    it("其它 @vue/* 包（@vue/devtools-api、@vue/shared）照常打进插件", async () => {
        const root = await authorProject("vue-tools", {
            "node_modules/@vue/devtools-api/package.json": JSON.stringify({name: "@vue/devtools-api", version: "7.0.0", type: "module", exports: "./index.js"}),
            "node_modules/@vue/devtools-api/index.js": "export function setupDevtoolsPlugin() { return \"devtools\"; }\n",
            "web/plugin.ts": `import {setupDevtoolsPlugin} from "@vue/devtools-api";\nimport {isArray} from "@vue/shared";\nexport const p = {id: "acme.vue-tools", entries: [{id: "browser", location: "browser", activate: async () => ({devtools: setupDevtoolsPlugin(), array: isArray([])})}]};\n`,
        });
        await build(root);
        const {value, required} = await activateBrowser(root);
        expect(value).toEqual({devtools: "devtools", array: true});
        expect(required).toEqual([]);
        // 打进来的依赖在 source map 里写成 node_modules 下的路径，不带构建机的目录结构。
        const map = JSON.parse(await readFile(join(root, "dist/browser.js.map"), "utf8")) as {sources: string[]};
        expect(map.sources.some((source) => source.startsWith("node_modules/@vue/shared/"))).toBe(true);
    }, 60_000);

    it("浏览器产物是严格模式：对冻结对象赋值会抛错", async () => {
        const root = await authorProject("strict", {
            "web/plugin.ts": `const frozen = Object.freeze({count: 0});\nexport const p = {id: "acme.strict", entries: [{id: "browser", location: "browser", activate: async () => { try { (frozen as {count: number}).count = 1; return {threw: false}; } catch (error) { return {threw: error instanceof TypeError}; } }}]};\n`,
        });
        await build(root);
        expect((await activateBrowser(root)).value).toEqual({threw: true});
    }, 60_000);

    it("浏览器入口里写顶层 await：构建失败，写明文件位置与原因（登记工厂同步执行）；服务端入口里照常构建", async () => {
        const browser = await authorProject("tla-browser", {
            "web/plugin.ts": `const ready = await Promise.resolve(1);\nexport const p = {id: "acme.tla-browser", entries: [{id: "browser", location: "browser", activate: async () => ({ready})}]};\n`,
        });
        const problems = await failure(browser);
        expect(problems).toEqual([expect.stringMatching(/^web\/plugin\.ts:1:\d+：.*顶层 await/u)]);
        expect(problems[0]).not.toMatch(/\u001b\[/u);
        const server = await authorProject("tla-server", {
            "backend/plugin.ts": `const ready = await Promise.resolve(1);\nexport const s = {id: "acme.tla-server", entries: [{id: "server", location: "server", activate: async () => ({ready})}]};\n`,
        });
        expect((await build(server)).manifest).toMatchObject({entries: {server: {location: "server"}}});
    }, 60_000);

    it("浏览器产物里 import.meta.url 是脚本的地址，new URL(相对路径, import.meta.url) 以它为基址；服务端产物里是文件自己的 URL", async () => {
        const root = await authorProject("meta-url", {
            "web/plugin.ts": `export const p = {id: "acme.meta-url", entries: [{id: "browser", location: "browser", activate: async () => ({url: import.meta.url, asset: new URL(/* @vite-ignore */ "./missing.svg", import.meta.url).href})}]};\n`,
            "backend/plugin.ts": `export const s = {id: "acme.meta-url", entries: [{id: "server", location: "server", activate: async () => ({url: import.meta.url})}]};\n`,
        });
        await build(root);
        // 每次装载一个新的假页面（`registeredFactory`）：基址是那个脚本的地址，资源与脚本在同一目录。
        const {url, asset} = (await activateBrowser(root)).value as {readonly url: string; readonly asset: string};
        expect(url).toMatch(/^http:\/\/plugin\.test\/.+\/browser\.js$/u);
        expect(asset).toBe(url.replace(/browser\.js$/u, "missing.svg"));
        const server = await import(join(root, "dist/server.js")) as {activate: () => Promise<{url: string}>};
        expect((await server.activate()).url).toBe(pathToFileURL(join(root, "dist/server.js")).href);
    }, 60_000);

    it("图标只写在插件描述的声明里也有规则；别的图标集给警告", async () => {
        const root = await authorProject("icons", {
            "web/plugin.ts": `export const folder = "i-catppuccin-folder";\nexport const p = {id: "acme.icons", entries: [{id: "browser", location: "browser", activate: () => ({})}]};\n`,
        });
        await writeFile(join(root, "plugin.ts"), `export const descriptor = {id: "acme.icons", version: "1.0.0", locations: ["browser"], contributions: [{capability: "settings.sections", id: "acme.icons.main", declaration: {title: {"zh-CN": "图标", "en-US": "Icons"}, icon: "i-lucide-bell"}}]};\n`);
        const result = await build(root);
        expect(await readFile(join(root, "dist/style.css"), "utf8")).toContain(".i-lucide-bell { --svg: url(");
        expect(result.warnings).toEqual([expect.stringContaining("i-catppuccin-folder")]);
    }, 60_000);

    it("插件目录没有 package.json、或者它不是合法的 JSON：构建失败，写明文件", async () => {
        const root = join(tmp, "no-package");
        await mkdir(root, {recursive: true});
        let caught: unknown = null;
        try {
            await build(root);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(PluginBuildError);
        expect((caught as PluginBuildError).message).toContain(join(root, "package.json"));
        await writeFile(join(root, "package.json"), "{publisher: acme}");
        expect(await failure(root)).toEqual([expect.stringContaining(join(root, "package.json"))]);
    }, 60_000);

    it.skipIf(!crossDevice)("系统临时目录在另一个文件系统上（TMPDIR=/dev/shm）：命令行构建照样成功", async () => {
        const root = await authorProject("cross-device", {
            "web/plugin.ts": `export const p = {id: "acme.cross-device", entries: [{id: "browser", location: "browser", activate: () => ({})}]};\n`,
        });
        const child = Bun.spawn({
            cmd: [process.execPath, fileURLToPath(new URL("./cli.ts", import.meta.url)), "build", root],
            env: {...process.env, TMPDIR: "/dev/shm"},
            stdout: "pipe",
            stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        // 输出目录里只有产物：放在里面的中间产物目录用完就删。
        expect((await readdir(join(root, "dist"))).sort()).toEqual(["browser.js", "browser.js.map", "package.json"]);
    }, 60_000);

    it("执行入口定义时出错：报出错的作者文件:行:列与消息（不是引入它的入口文件，路径里有括号也一样）；--verbose 另附完整堆栈", async () => {
        const root = await authorProject("thrower", {
            "shared(copy)/contracts.ts": `export const ok = 1;\nexport const value: number = (() => {\n    throw new Error("合同模块算不出来");\n})();\n`,
            "backend/plugin.ts": `import {defineEntry} from "@notnotype/nb-plugin-sdk";\nimport {value} from "../shared(copy)/contracts";\nexport const server = {id: "acme.thrower", entries: [defineEntry({id: "server", location: "server", activate: () => (void value, {})})]};\n`,
        });
        const problemsOf = async (verbose: boolean) => {
            try {
                await buildPlugin({root, outDir: join(root, "dist"), ...IN_REPO_BUILD, verbose});
            } catch (error) {
                if (error instanceof PluginBuildError) return error.problems;
                throw error;
            }
            throw new Error("期望构建失败");
        };
        const [quiet] = await problemsOf(false);
        expect(quiet).toEqual({path: expect.stringMatching(/^shared\(copy\)\/contracts\.ts:3:\d+$/u), message: "合同模块算不出来"});
        const [verbose] = await problemsOf(true);
        expect(verbose!.path).toBe(quiet!.path);
        expect(verbose!.message).toContain("合同模块算不出来\nError: 合同模块算不出来\n");
    }, 60_000);

    it("用助手定义了设置项却没写进 plugin.descriptor([…])（定义在只有入口引入的模块里也查得到）：构建失败，写明是哪一项", async () => {
        const root = await authorProject("unlisted", {
            "shared/contracts.ts": `import {definePlugin} from "@notnotype/nb-plugin-sdk";
import {setting} from "@notnotype/nb-plugin-sdk/settings";
import {Type} from "typebox";
export const plugin = definePlugin({id: "acme.unlisted", version: "1.0.0", locations: ["server"]});
export const listed = setting(plugin, {name: "listed", schema: Type.Boolean(), default: false, title: "Listed"});
`,
            "backend/plugin.ts": `import {setting} from "@notnotype/nb-plugin-sdk/settings";
import {Type} from "typebox";
import {plugin} from "../shared/contracts";
export const forgotten = setting(plugin, {name: "forgotten", schema: Type.Boolean(), default: false, title: "Forgotten"});
export const server = plugin.definition([plugin.entry({location: "server", activate: () => ({})})]);
`,
            "plugin.ts": `import {listed, plugin} from "./shared/contracts";\nexport const descriptor = plugin.descriptor([listed]);\n`,
        });
        let caught: unknown = null;
        try {
            await build(root);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(PluginBuildError);
        expect((caught as PluginBuildError).problems).toEqual([{path: "plugin.ts", message: expect.stringContaining("设置项 acme.unlisted/forgotten 定义了，却没有写进 plugin.descriptor([…])")}]);
    }, 60_000);

    it("远程合同用了 Refine：构建前就失败，指出合同与方法", async () => {
        const root = await authorProject("refined", {
            "backend/plugin.ts": `import {defineEntry, defineRemoteService, provideRemote} from "@notnotype/nb-plugin-sdk";
import {Type} from "typebox";
const contract = defineRemoteService({id: "acme.refined/x", version: 1, provider: "server", callers: ["browser"], methods: {get: {input: Type.Object({}, {additionalProperties: false}), output: Type.Refine(Type.String(), (value) => value.length > 0), effect: "read"}}});
export const s = {id: "acme.refined", entries: [defineEntry({id: "server", location: "server", remoteProvides: [contract], activate: () => ({remote: [provideRemote(contract, () => ({methods: {get: () => ({ok: true, value: "x"})}}))]})})]};
`,
        });
        let caught: unknown = null;
        try {
            await build(root);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(PluginBuildError);
        expect((caught as PluginBuildError).problems).toContainEqual(expect.objectContaining({path: "contracts.acme.refined/x.methods.get.output", message: expect.stringContaining("Refine")}));
    }, 60_000);

    it("插件描述与 package.json 不一致、输出目录不是空的：构建失败", async () => {
        const root = await authorProject("mismatch", {"web/plugin.ts": "export const p = {id: \"acme.mismatch\", entries: []};\n"});
        await writeFile(join(root, "plugin.ts"), `export const descriptor = {id: "acme.other", version: "1.0.0", locations: []};\n`);
        expect(await failure(root)).toEqual([expect.stringContaining("acme.other@1.0.0")]);
        await mkdir(join(root, "dist"), {recursive: true});
        await writeFile(join(root, "dist/left.txt"), "x");
        expect(await failure(root)).toEqual([join(root, "dist")]);
    }, 60_000);

    it("插件描述的 locations 与实际有入口的位置不一致：构建失败，写明多写或漏写的位置", async () => {
        const root = await authorProject("located", {"web/plugin.ts": "export const p = {id: \"acme.located\", entries: [{id: \"browser\", location: \"browser\", activate: () => ({})}]};\n"});
        await writeFile(join(root, "plugin.ts"), `export const descriptor = {id: "acme.located", version: "1.0.0", locations: ["server", "browser"]};\n`);
        expect(await failure(root)).toEqual([expect.stringContaining("写了 server，可是这些位置没有入口")]);
        await writeFile(join(root, "plugin.ts"), `export const descriptor = {id: "acme.located", version: "1.0.0", locations: []};\n`);
        expect(await failure(root)).toEqual([expect.stringContaining("没有写 browser，可是这些位置有入口")]);
    }, 60_000);

    it("入口定义模块忘了 export 或导出了两个插件定义：构建失败，指出模块（不再静默少一个入口）", async () => {
        const root = await authorProject("unexported", {
            "web/plugin.ts": "export const p = {id: \"acme.unexported\", entries: [{id: \"browser\", location: \"browser\", activate: () => ({})}]};\n",
            "backend/plugin.ts": "const s = {id: \"acme.unexported\", entries: [{id: \"server\", location: \"server\", activate: () => ({})}]};\nexport const unrelated = 1;\n",
        });
        expect(await failure(root)).toEqual([expect.stringContaining("忘了 export")]);
        await writeFile(join(root, "backend/plugin.ts"), "export const a = {id: \"acme.unexported\", entries: []};\nexport const b = {id: \"acme.unexported\", entries: []};\n");
        expect(await failure(root)).toEqual([expect.stringContaining("导出了 2 个插件定义")]);
        // 显式写了入口模块、但写错：构建失败，不改找缺省的模块。
        const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, unknown>;
        await writeFile(join(root, "package.json"), JSON.stringify({...manifest, nbook: {definitions: ["web/plugin.ts", 42]}}));
        expect(await failure(root)).toEqual(["必须是非空的模块路径"]);
    }, 60_000);
});

describe("消息目录（locales/）", () => {
    const ENTRY = {"web/plugin.ts": "export const p = {id: \"acme.ENTRY\", entries: [{id: \"browser\", location: \"browser\", activate: () => ({})}]};\n"};
    /** 带一个浏览器入口与给定消息目录的作者项目；`l10n` 写进作者的 package.json。 */
    async function catalogProject(name: string, l10n: unknown, files: Readonly<Record<string, string>>, extra: Record<string, unknown> = {}): Promise<string> {
        const root = await authorProject(name, {"web/plugin.ts": ENTRY["web/plugin.ts"].replace("ENTRY", name), ...files});
        await writeFile(join(root, "package.json"), JSON.stringify({publisher: "acme", name, version: "1.0.0", type: "module", ...(l10n === undefined ? {} : {l10n}), ...extra}));
        return root;
    }

    it("目录原样复制进产物并列入文件；清单写 l10n（源语言在前），显示名与说明从源语言目录摘出；产物能照常安装", async () => {
        const zh = `${JSON.stringify({manifest: {displayName: "问候", description: "打个招呼"}, greeting: {hello: "你好，{{name}}"}}, null, 2)}\n`;
        const en = JSON.stringify({manifest: {displayName: "Greeter"}, greeting: {hello: "Hello, {{name}}"}});
        const root = await catalogProject("greeter", {source: "zh-CN"}, {"locales/zh-CN.json": zh, "locales/en-US.json": en});
        const result = await build(root);
        expect(result.files).toEqual(["browser.js", "browser.js.map", "locales/en-US.json", "locales/zh-CN.json", "package.json"]);
        expect(result.manifest).toMatchObject({l10n: {source: "zh-CN", locales: ["zh-CN", "en-US"]}, displayName: "问候", description: "打个招呼"});
        expect(await readFile(join(root, "dist/locales/zh-CN.json"), "utf8")).toBe(zh);
        const written = JSON.parse(await readFile(join(root, "dist/package.json"), "utf8")) as Record<string, unknown>;
        expect(manifestFormat.read(written)).toMatchObject({status: "valid", manifest: {l10n: {source: "zh-CN", locales: ["zh-CN", "en-US"]}}});

        const inventory = createPluginInventory({root: join(tmp, "greeter-state", "plugins"), profile: NEUROBOOK_PROFILE, builtin: [], startup: NO_INSTALLED_PLUGINS, record: () => undefined});
        expect(await inventory.install(join(root, "dist"))).toMatchObject({ok: true});
    }, 60_000);

    it("缺源语言的目录、目录不是合法 JSON、叶子不是字符串：构建失败，写明文件与键路径", async () => {
        const en = JSON.stringify({title: "Title"});
        expect(await failure(await catalogProject("no-source", {source: "zh-CN"}, {"locales/en-US.json": en}))).toEqual(["缺少源语言 zh-CN 的目录 locales/zh-CN.json"]);
        expect(await failure(await catalogProject("bad-json", {source: "en-US"}, {"locales/en-US.json": "{"}))).toEqual([expect.stringContaining("不是合法的 JSON")]);
        expect(await failure(await catalogProject("leaf", {source: "en-US"}, {"locales/en-US.json": JSON.stringify({menu: {open: 1, close: ["x"]}})}))).toEqual([
            "menu.open：值必须是字符串或嵌套的对象，这里是number",
            "menu.close：值必须是字符串或嵌套的对象，这里是数组",
        ]);
    }, 60_000);

    it("文件名不是规范写法的语言标签、有 locales/ 却没写 l10n、l10n 写了别的字段、显示名同时写在 package.json：构建失败", async () => {
        const en = JSON.stringify({title: "Title"});
        expect(await failure(await catalogProject("lower", {source: "en-US"}, {"locales/en-US.json": en, "locales/zh-cn.json": en}))).toEqual([expect.stringContaining("规范写法 zh-CN")]);
        expect(await failure(await catalogProject("unsourced", undefined, {"locales/en-US.json": en}))).toEqual([expect.stringContaining("l10n.source")]);
        expect(await failure(await catalogProject("listed", {source: "en-US", locales: ["en-US"]}, {"locales/en-US.json": en}))).toEqual([expect.stringContaining("语言列表由 locales/ 里的文件得出")]);
        expect(await failure(await catalogProject("named", {source: "en-US"}, {"locales/en-US.json": en}, {displayName: "Named"}))).toEqual([expect.stringContaining("manifest.displayName，不写在 package.json")]);
    }, 60_000);
});
