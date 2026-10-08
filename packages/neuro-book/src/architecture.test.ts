/**
 * 包内依赖方向（packages/neuro-book/AGENTS.md 目录约定）：前端代码不引后端与 Bun/Node；后端不引前端；
 * 共用目录、插件描述与产品清单不引任何一侧；跨插件的运行时导入只能指向对方的 `shared/contracts.ts`，类型照旧可以
 * `import type`（docs/adr/0025-service-keys-by-id.md；例外：Lab 的场景可以在运行时引用别的插件的前端与共用代码，用来
 * 挂载它们的组件、建场景自己的局部宿主；Lab 只在开发模式加载）；只有开发监督进程能引 Vite；测试库只在测试里用；
 * 开发清单与开发插件（Lab）只经开发入口引用（后端、项目子进程与前端各一个），前端开发入口只能动态加载，生产构建才不含它们。
 * `src/ui/` 是宿主与插件共用的前端组件，只用前端库与共用代码；`import.meta.glob` 只给 Lab 的组件索引用：
 * 它把扫描到的模块全部带进构建图，用在别处会把整片目录打进产品。
 * 前端误引后端代码时打包与类型检查不一定失败（Bun 能解析两侧），所以按导入语句检查。
 * 测试文件与 `testing/` 不受限：它们要在同一进程里搭真实后端或运行环境。反过来，产品代码不引用 `testing/`、内核的
 * `@notnotype/nb-runtime/<机制>/testing` 入口与 `examples/`（docs/testing/README.md 的“测试文件组织”）：它们不进产品构建。
 * 示例插件（`examples/plugins/`）按第三方插件的写法，与 `src/plugins/` 同样检查，跨插件只引用对方（含内置插件）的
 * `shared/contracts.ts`；它们的路径相对 src，带 `../examples/` 前缀。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";

const SRC = join(import.meta.dir);
const EXAMPLE_PLUGINS = join(SRC, "..", "examples", "plugins");

interface ImportUse {
    readonly file: string;
    readonly specifier: string;
    readonly typeOnly: boolean;
    /** `import("…")`：运行时加载，按运行时导入判定。 */
    readonly dynamic?: boolean;
}

/** `import.meta.glob` 的使用位置（相对 src）。 */
function globUsers(files: ReadonlyArray<string>): string[] {
    return files.filter((file) => readFileSync(file, "utf8").includes("import.meta.glob")).map((file) => relative(SRC, file));
}

const globAllowed = (file: string): boolean => file.startsWith("plugins/lab/web/");

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === "testing" ? [] : sourceFiles(path);
        return /\.(ts|vue)$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

const IMPORT_PATTERN = /^\s*(?:import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gmu;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*["']([^"']+)["']\s*\)/gu;

function importsOf(file: string): ImportUse[] {
    const text = readFileSync(file, "utf8");
    const at = relative(SRC, file);
    return [
        ...[...text.matchAll(IMPORT_PATTERN)].map((match) => ({file: at, specifier: match[2] as string, typeOnly: match[1] !== undefined})),
        ...[...text.matchAll(DYNAMIC_IMPORT_PATTERN)].map((match) => ({file: at, specifier: match[1] as string, typeOnly: false, dynamic: true})),
    ];
}

/** 导入目标在 src 内的相对路径；包名与 node 内置返回 null。 */
function targetInSrc(use: ImportUse): string | null {
    if (use.specifier.startsWith("nbook/")) return use.specifier.slice("nbook/".length);
    if (use.specifier.startsWith(".")) return relative(SRC, resolve(SRC, dirname(use.file), use.specifier));
    return null;
}

const has = (path: string, segment: string): boolean => path.split("/").includes(segment);
/** 后端代码：服务端与项目子进程两个宿主，以及插件的 `backend/`（两种进程共用）。 */
const isBackend = (path: string): boolean => path.startsWith("server/") || path.startsWith("project/") || has(path, "backend");
/** 插件目录（`plugins/<插件>` 或 `../examples/plugins/<插件>`）；同名的内置插件与示例插件是两个插件。 */
const pluginOf = (path: string): string | null => /^((?:\.\.\/examples\/)?plugins\/[^/]+)\//u.exec(path)?.[1] ?? null;
const isExample = (path: string): boolean => path.startsWith("../examples/");
const isPlatformModule = (specifier: string): boolean => specifier.startsWith("node:") || specifier === "bun" || specifier.startsWith("bun:");
const isFrontendPackage = (specifier: string): boolean => specifier === "vue" || specifier.startsWith("vue/") || specifier.startsWith("@vitejs/");
const TEST_LIBRARIES = ["vitest", "@vue/test-utils", "happy-dom", "@playwright/test"];
/** 静态引用开发清单的只有这几个开发入口；开发插件的代码另外允许开发清单引用它的描述。 */
const DEVELOPMENT_ENTRIES = ["server/development-main.ts", "project/development-main.ts", "web/development-plugins.ts"];
const isDevelopmentPlugin = (path: string): boolean => path.startsWith("plugins/lab/");
const isPluginContracts = (target: string): boolean => /^(?:\.\.\/examples\/)?plugins\/[^/]+\/shared\/contracts(?:\.ts)?$/u.test(target);
/** 路径段含 `testing`：本包的测试支持目录，或内核的 `@notnotype/nb-runtime/<机制>/testing` 入口。 */
const importsTesting = (use: ImportUse, target: string | null): boolean => use.specifier.split("/").includes("testing") || (target !== null && has(target, "testing"));
const labSceneMayImport = (file: string, target: string): boolean => file.startsWith("plugins/lab/web/fixtures/") && /^plugins\/[^/]+\/(?:web|shared)\//u.test(target);
const isTestLibrary = (specifier: string): boolean => TEST_LIBRARIES.some((name) => specifier === name || specifier.startsWith(`${name}/`));

function violationsOf(uses: ReadonlyArray<ImportUse>): string[] {
    const found: string[] = [];
    for (const use of uses) {
        const target = targetInSrc(use);
        const where = `${use.file} → ${use.specifier}`;
        const web = has(use.file, "web") || use.file.startsWith("ui/");
        const server = isBackend(use.file);
        const neutral = use.file.startsWith("shared/") || has(use.file, "shared") || /^(?:\.\.\/examples\/)?plugins\/[^/]+\/plugin\.ts$/u.test(use.file) || use.file === "manifest.ts" || use.file === "development-manifest.ts";
        if (web && (isPlatformModule(use.specifier) || (target !== null && isBackend(target)))) found.push(`前端引用了后端或运行平台：${where}`);
        if (server && (isFrontendPackage(use.specifier) || (target !== null && has(target, "web")))) found.push(`后端引用了前端：${where}`);
        if (neutral && target !== null && (isBackend(target) || has(target, "web"))) found.push(`共用代码引用了一侧的实现：${where}`);
        const from = pluginOf(use.file);
        const to = target === null ? null : pluginOf(target);
        if (from !== null && to !== null && from !== to && !use.typeOnly && !isPluginContracts(target as string) && !labSceneMayImport(use.file, target as string)) {
            found.push(`跨插件的运行时导入只能指向对方的 shared/contracts.ts：${where}`);
        }
        if ((use.specifier === "vite" || use.specifier.startsWith("vite/")) && !use.file.startsWith("server/dev/")) found.push(`只有开发监督进程能引用 Vite：${where}`);
        if (isTestLibrary(use.specifier)) found.push(`产品代码引用了测试库：${where}`);
        if (importsTesting(use, target)) found.push(`产品代码引用了测试支持代码（testing/ 或内核的 */testing 入口）：${where}`);
        if (target !== null && isExample(target) && !isExample(use.file)) found.push(`产品代码引用了示例：${where}`);
        if (target === "development-manifest" && !DEVELOPMENT_ENTRIES.includes(use.file)) found.push(`只有开发入口能引用开发清单：${where}`);
        if (target !== null && isDevelopmentPlugin(target) && !isDevelopmentPlugin(use.file) && use.file !== "development-manifest.ts" && !DEVELOPMENT_ENTRIES.includes(use.file)) {
            found.push(`只有开发入口能引用开发插件：${where}`);
        }
        if (use.file.startsWith("ui/") && target !== null && !target.startsWith("ui/") && !target.startsWith("shared/")) found.push(`共享前端组件只能引用 ui/ 与 shared/：${where}`);
        if (target === "web/development-plugins" && !(use.dynamic === true && use.file === "web/main.ts")) found.push(`前端开发入口只能由 web/main.ts 在 import.meta.env.DEV 分支里动态加载：${where}`);
    }
    return found;
}

describe("包内依赖方向", () => {
    it("前后端、共用代码与插件之间只按目录约定引用", () => {
        expect(violationsOf([...sourceFiles(SRC), ...sourceFiles(EXAMPLE_PLUGINS)].flatMap(importsOf))).toEqual([]);
    });

    it("import.meta.glob 只出现在 Lab", () => {
        expect(globUsers(sourceFiles(SRC)).filter((file) => !globAllowed(file))).toEqual([]);
        expect(globUsers(sourceFiles(SRC))).toContain("plugins/lab/web/component-index.ts");
        expect(globAllowed("web/main.ts")).toBe(false);
    });

    it("每条规则都能拦下对应的违规（防止解析或判定失效后永远通过）", () => {
        const use = (file: string, specifier: string, typeOnly = false): ImportUse => ({file, specifier, typeOnly});
        const cases: ReadonlyArray<ImportUse> = [
            use("web/host/window.ts", "nbook/server/start"),
            use("web/host/window.ts", "node:fs"),
            use("plugins/http/backend/plugin.ts", "../web/view"),
            use("plugins/http/backend/plugin.ts", "vue"),
            use("project/start.ts", "vue"),
            use("web/host/window.ts", "nbook/plugins/storage/backend/plugin"),
            use("shared/browser-bootstrap.ts", "nbook/plugins/http/backend/dispatch"),
            use("plugins/workbench/web/plugin.ts", "nbook/plugins/diagnostics/web/plugin"),
            use("web/main.ts", "vite"),
            use("web/host/window.ts", "@vue/test-utils"),
            use("server/main.ts", "nbook/development-manifest"),
            use("web/plugins.ts", "nbook/plugins/lab/web/plugin"),
            use("web/main.ts", "./development-plugins"),
            {file: "web/mount.ts", specifier: "./development-plugins", typeOnly: false, dynamic: true},
            use("ui/JsonViewer.vue", "nbook/web/host/window"),
            use("ui/JsonViewer.vue", "node:fs"),
            use("plugins/lab/web/fixtures/command-scene/lab-command-scene.ts", "nbook/plugins/commands/plugin"),
            use("plugins/lab/web/LabShell.vue", "nbook/plugins/workbench/web/commands/keymap"),
            use("plugins/projects/web/plugin.ts", "nbook/plugins/workbench/web/contracts"),
            use("plugins/projects/web/plugin.ts", "nbook/plugins/commands/shared/registry"),
            use("server/start.ts", "nbook/server/testing/test-plugins"),
            use("plugins/storage/backend/plugin.ts", "./testing/partition-writer"),
            use("web/host/window.ts", "@notnotype/nb-runtime/remote/testing"),
            use("server/main.ts", "../../examples/plugins/notes/backend/plugin"),
            use("../examples/plugins/notes/backend/plugin.ts", "nbook/plugins/storage/backend/plugin"),
            use("../examples/plugins/notes/backend/plugin.ts", "../../clock/backend/plugin"),
            use("../examples/plugins/notes/web/plugin.ts", "../backend/plugin"),
            use("../examples/plugins/notes/backend/plugin.ts", "../web/plugin"),
        ];
        expect(cases.map((item) => violationsOf([item]).length)).toEqual(cases.map(() => 1));
        expect(violationsOf([
            use("plugins/workbench/web/plugin.ts", "nbook/plugins/diagnostics/web/plugin", true),
            use("plugins/projects/web/plugin.ts", "nbook/plugins/workbench/shared/contracts"),
            use("plugins/storage/web/plugin.ts", "nbook/plugins/commands/shared/contracts"),
            use("server/development-main.ts", "nbook/development-manifest"),
            use("project/development-main.ts", "nbook/development-manifest"),
            use("development-manifest.ts", "./plugins/lab/plugin"),
            use("web/development-plugins.ts", "nbook/plugins/lab/web/plugin"),
            use("plugins/lab/web/fixtures/command-scene/lab-command-scene.ts", "nbook/plugins/commands/shared/registry"),
            use("plugins/lab/web/fixtures/command-scene/LabCommandSceneLayer.vue", "nbook/plugins/workbench/web/components/WorkbenchCommandPalette.vue"),
            use("../examples/plugins/notes/backend/plugin.ts", "nbook/plugins/storage/shared/contracts"),
            use("../examples/plugins/notes/backend/plugin.ts", "../../clock/shared/contracts"),
            use("../examples/plugins/notes/web/plugin.ts", "../shared/contracts"),
            use("../examples/plugins/notes/backend/plugin.ts", "nbook/plugins/storage/backend/plugin", true),
        ])).toEqual([]);

        expect(importsOf(join(SRC, "web", "main.ts")).some((item) => item.specifier === "./development-plugins" && item.dynamic === true)).toBe(true);
        expect(violationsOf(importsOf(join(SRC, "web", "main.ts")))).toEqual([]);
        const parsed = importsOf(join(SRC, "web", "host", "window.ts"));
        expect(parsed.some((item) => item.specifier === "nbook/shared/browser-bootstrap" && !item.typeOnly)).toBe(true);
        expect(parsed.some((item) => item.specifier === "nbook/manifest" && item.typeOnly)).toBe(true);
        // 示例插件确实在扫描范围里，路径带 `../examples/` 前缀。
        const example = importsOf(join(EXAMPLE_PLUGINS, "notes", "backend", "plugin.ts"));
        expect(example.some((item) => item.file === "../examples/plugins/notes/backend/plugin.ts" && item.specifier === "../shared/contracts")).toBe(true);
    });
});
