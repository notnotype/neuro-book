import {describe, expect, it} from "bun:test";

import {readdir, readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** 模块源码：本目录与 `testing/` 下排除测试的 TS 文件，返回相对本目录的路径。 */
async function listModuleSources(): Promise<string[]> {
    const entries = await readdir(moduleDir, {recursive: true});
    return entries.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort();
}

function specifiersOf(code: string): string[] {
    const fromSpecifiers = [...code.matchAll(/^\s*(?:import|export)\b[^"']*?\bfrom\s+["']([^"']+)["']/gmu)].map((match) => match[1]!);
    const sideEffectSpecifiers = [...code.matchAll(/^\s*import\s+["']([^"']+)["']/gmu)].map((match) => match[1]!);
    return [...fromSpecifiers, ...sideEffectSpecifiers];
}

describe("runtime remote 模块边界", () => {
    it("源码只导入本模块、TypeBox 与 lifecycle/services 入口：不依赖插件宿主与应用内核，不 import 框架、驱动或宿主环境", async () => {
        const sources = await listModuleSources();
        expect(sources).toContain("remote.ts");
        expect(sources).toContain(join("testing", "in-process.ts"));
        for (const name of sources) {
            const code = await readFile(join(moduleDir, name), "utf8");
            // testing/ 下的文件以 `../` 指回本模块。
            const local = name.startsWith("testing") ? /^\.\.\/[^/]+$/u : /^\.\/[^/]+$/u;
            for (const specifier of specifiersOf(code)) {
                const allowed = local.test(specifier) || /^(?:typebox|typebox\/value|\.\.\/lifecycle\/lifecycle|\.\.\/services\/services)$/u.test(specifier);
                expect(allowed, `${name} 导入了 ${specifier}`).toBe(true);
            }
            expect(code, `${name} 不得使用动态 import`).not.toMatch(/\bimport\s*\(/u);
            // 节点与路由在浏览器、服务端与项目子进程里共用：宿主环境由链路与宿主回调注入。
            expect(code, `${name} 不得引用宿主全局对象`).not.toMatch(/\b(?:process|window|document)\./u);
        }
    });
});
