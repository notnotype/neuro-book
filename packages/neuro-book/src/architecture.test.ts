/**
 * 包内依赖方向（packages/neuro-book/AGENTS.md 目录约定）：前端代码不引后端与 Bun/Node；后端不引前端；
 * 共用目录、插件描述与产品清单不引任何一侧；跨插件只用 `import type`；只有开发监督进程能引 Vite；测试库只在测试里用。
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
}

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return entry.name === "testing" ? [] : sourceFiles(path);
        return /\.(ts|vue)$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
    });
}

const IMPORT_PATTERN = /^\s*(?:import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gmu;

function importsOf(file: string): ImportUse[] {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(IMPORT_PATTERN)].map((match) => ({file: relative(SRC, file), specifier: match[2] as string, typeOnly: match[1] !== undefined}));
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
const isTestLibrary = (specifier: string): boolean => TEST_LIBRARIES.some((name) => specifier === name || specifier.startsWith(`${name}/`));

function violationsOf(uses: ReadonlyArray<ImportUse>): string[] {
    const found: string[] = [];
    for (const use of uses) {
        const target = targetInSrc(use);
        const where = `${use.file} → ${use.specifier}`;
        const web = has(use.file, "web");
        const server = has(use.file, "server");
        const neutral = use.file.startsWith("shared/") || has(use.file, "shared") || /^plugins\/[^/]+\/plugin\.ts$/u.test(use.file) || use.file === "manifest.ts";
        if (web && (isPlatformModule(use.specifier) || (target !== null && has(target, "server")))) found.push(`前端引用了后端或运行平台：${where}`);
        if (server && (isFrontendPackage(use.specifier) || (target !== null && has(target, "web")))) found.push(`后端引用了前端：${where}`);
        if (neutral && target !== null && (has(target, "server") || has(target, "web"))) found.push(`共用代码引用了一侧的实现：${where}`);
        const from = pluginOf(use.file);
        const to = target === null ? null : pluginOf(target);
        if (from !== null && to !== null && from !== to && !use.typeOnly) found.push(`跨插件的运行时导入（只允许 import type）：${where}`);
        if ((use.specifier === "vite" || use.specifier.startsWith("vite/")) && !use.file.startsWith("server/dev/")) found.push(`只有开发监督进程能引用 Vite：${where}`);
        if (isTestLibrary(use.specifier)) found.push(`产品代码引用了测试库：${where}`);
    }
    return found;
}

describe("包内依赖方向", () => {
    it("前后端、共用代码与插件之间只按目录约定引用", () => {
        expect(violationsOf(sourceFiles(SRC).flatMap(importsOf))).toEqual([]);
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
        ];
        expect(cases.map((item) => violationsOf([item]).length)).toEqual(cases.map(() => 1));
        expect(violationsOf([use("plugins/workbench/web/plugin.ts", "nbook/plugins/diagnostics/web/plugin", true)])).toEqual([]);

        const parsed = importsOf(join(SRC, "web", "host", "window.ts"));
        expect(parsed.some((item) => item.specifier === "nbook/shared/browser-bootstrap" && !item.typeOnly)).toBe(true);
        expect(parsed.some((item) => item.specifier === "nbook/manifest" && item.typeOnly)).toBe(true);
    });
});
