/**
 * 包内依赖方向（packages/neuro-book/AGENTS.md 目录约定）：前端代码不引后端与 Bun/Node；后端不引前端；
 * 共用目录、插件描述与产品清单不引任何一侧；跨插件只用 `import type`；只有开发监督进程能引 Vite；测试库只在测试里用；
 * 开发清单与开发插件（Lab）只经两个开发入口引用，前端开发入口只能动态加载，生产构建才不含它们。
 * `src/ui/` 是宿主与插件共用的前端组件，只用前端库与共用代码；`import.meta.glob` 只给 Lab 的组件索引用：
 * 它把扫描到的模块全部带进构建图，用在别处会把整片目录打进产品。
 * 前端误引后端代码时打包与类型检查不一定失败（Bun 能解析两侧），所以按导入语句检查。
 * 测试文件与 `testing/` 不受限：它们要在同一进程里搭真实后端或运行环境。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";

const SRC = join(import.meta.dir);

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
const pluginOf = (path: string): string | null => /^plugins\/([^/]+)\//u.exec(path)?.[1] ?? null;
const isPlatformModule = (specifier: string): boolean => specifier.startsWith("node:") || specifier === "bun" || specifier.startsWith("bun:");
const isFrontendPackage = (specifier: string): boolean => specifier === "vue" || specifier.startsWith("vue/") || specifier.startsWith("@vitejs/");
const TEST_LIBRARIES = ["vitest", "@vue/test-utils", "happy-dom", "@playwright/test"];
/** 静态引用开发清单的只有这两个开发入口；开发插件的代码另外允许开发清单引用它的描述。 */
const DEVELOPMENT_ENTRIES = ["server/development-main.ts", "web/development-plugins.ts"];
const isDevelopmentPlugin = (path: string): boolean => path.startsWith("plugins/lab/");
const isTestLibrary = (specifier: string): boolean => TEST_LIBRARIES.some((name) => specifier === name || specifier.startsWith(`${name}/`));

function violationsOf(uses: ReadonlyArray<ImportUse>): string[] {
    const found: string[] = [];
    for (const use of uses) {
        const target = targetInSrc(use);
        const where = `${use.file} → ${use.specifier}`;
        const web = has(use.file, "web") || use.file.startsWith("ui/");
        const server = has(use.file, "server");
        const neutral = use.file.startsWith("shared/") || has(use.file, "shared") || /^plugins\/[^/]+\/plugin\.ts$/u.test(use.file) || use.file === "manifest.ts" || use.file === "development-manifest.ts";
        if (web && (isPlatformModule(use.specifier) || (target !== null && has(target, "server")))) found.push(`前端引用了后端或运行平台：${where}`);
        if (server && (isFrontendPackage(use.specifier) || (target !== null && has(target, "web")))) found.push(`后端引用了前端：${where}`);
        if (neutral && target !== null && (has(target, "server") || has(target, "web"))) found.push(`共用代码引用了一侧的实现：${where}`);
        const from = pluginOf(use.file);
        const to = target === null ? null : pluginOf(target);
        if (from !== null && to !== null && from !== to && !use.typeOnly) found.push(`跨插件的运行时导入（只允许 import type）：${where}`);
        if ((use.specifier === "vite" || use.specifier.startsWith("vite/")) && !use.file.startsWith("server/dev/")) found.push(`只有开发监督进程能引用 Vite：${where}`);
        if (isTestLibrary(use.specifier)) found.push(`产品代码引用了测试库：${where}`);
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
        expect(violationsOf(sourceFiles(SRC).flatMap(importsOf))).toEqual([]);
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
            use("plugins/http/server/plugin.ts", "../web/view"),
            use("plugins/http/server/plugin.ts", "vue"),
            use("shared/browser-bootstrap.ts", "nbook/plugins/http/server/dispatch"),
            use("plugins/workbench/web/plugin.ts", "nbook/plugins/diagnostics/web/plugin"),
            use("web/main.ts", "vite"),
            use("web/host/window.ts", "@vue/test-utils"),
            use("server/main.ts", "nbook/development-manifest"),
            use("web/plugins.ts", "nbook/plugins/lab/web/plugin"),
            use("web/main.ts", "./development-plugins"),
            {file: "web/mount.ts", specifier: "./development-plugins", typeOnly: false, dynamic: true},
            use("ui/JsonViewer.vue", "nbook/web/host/window"),
            use("ui/JsonViewer.vue", "node:fs"),
        ];
        expect(cases.map((item) => violationsOf([item]).length)).toEqual(cases.map(() => 1));
        expect(violationsOf([
            use("plugins/workbench/web/plugin.ts", "nbook/plugins/diagnostics/web/plugin", true),
            use("server/development-main.ts", "nbook/development-manifest"),
            use("development-manifest.ts", "./plugins/lab/plugin"),
            use("web/development-plugins.ts", "nbook/plugins/lab/web/plugin"),
        ])).toEqual([]);

        expect(importsOf(join(SRC, "web", "main.ts")).some((item) => item.specifier === "./development-plugins" && item.dynamic === true)).toBe(true);
        expect(violationsOf(importsOf(join(SRC, "web", "main.ts")))).toEqual([]);
        const parsed = importsOf(join(SRC, "web", "host", "window.ts"));
        expect(parsed.some((item) => item.specifier === "nbook/shared/browser-bootstrap" && !item.typeOnly)).toBe(true);
        expect(parsed.some((item) => item.specifier === "nbook/manifest" && item.typeOnly)).toBe(true);
    });
});
