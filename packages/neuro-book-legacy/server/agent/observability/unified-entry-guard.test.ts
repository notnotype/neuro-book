/**
 * 统一入口 guard：server/ 下除 allowlist 外，禁止任何文件直接从 @earendil-works/pi-ai
 * import streamSimple / completeSimple——所有 provider 调用必须走 traced-provider，
 * 否则该调用对 Pi 请求 trace 不可见。
 *
 * 仓库没有 eslint / biome 的模块级 import 限制（模块级限制会误伤合法的 pi-ai 类型 import），
 * 本扫描测试是这条约束的唯一机器强制点。新增合法直连点必须显式改 ALLOWLIST 并说明理由。
 */
import {readFile, readdir} from "node:fs/promises";
import {join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

// 本文件位于 server/agent/observability/，上跳两级即 server/。
const serverRoot = fileURLToPath(new URL("../../", import.meta.url));

/** 允许直接调用 Models streamSimple/completeSimple 的唯一生产 seam。 */
const ALLOWLIST = new Set([
    "agent/observability/traced-provider.ts",
]);

/** 匹配自 pi-ai 的具名 import/export 子句或命名空间 import；`[^}]` 天然跨行。 */
const PI_AI_IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+["']@earendil-works\/pi-ai["']/g;
const FORBIDDEN_GLOBAL_API_RE = /\b(?:stream|streamSimple|complete|completeSimple|getModel|getModels|getProviders|registerApiProvider|registerFauxProvider)\b/;

async function collectTsFiles(dir: string, out: string[]): Promise<void> {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules") {
                await collectTsFiles(join(dir, entry.name), out);
            }
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
            out.push(join(dir, entry.name));
        }
    }
}

describe("pi 请求统一入口 guard", () => {
    it("server/ 禁止 /compat、旧全局 registry API 和绕过 traced seam 的 Models 调用", async () => {
        const files: string[] = [];
        await collectTsFiles(serverRoot, files);
        expect(files.length).toBeGreaterThan(100); // 扫描面兜底：路径算错时立刻暴露

        const violations: string[] = [];
        for (const file of files) {
            const rel = relative(serverRoot, file).replaceAll("\\", "/");
            const source = await readFile(file, "utf8");
            if (source.includes("@earendil-works/pi-ai/compat")) {
                violations.push(rel);
                continue;
            }
            for (const match of source.matchAll(PI_AI_IMPORT_RE)) {
                if (match[1]!.startsWith("*") || FORBIDDEN_GLOBAL_API_RE.test(match[1]!)) {
                    violations.push(rel);
                    break;
                }
            }
            if (!violations.includes(rel) && !ALLOWLIST.has(rel) && /\.\s*(?:streamSimple|completeSimple)\s*\(/.test(source)) {
                violations.push(rel);
            }
        }
        expect(violations).toEqual([]);
    });
});
