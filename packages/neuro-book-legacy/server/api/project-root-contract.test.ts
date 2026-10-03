/**
 * Project identity HTTP 合同审计（Task 118 Phase 4B）：
 * `server/api/**` 的 HTTP 边界只允许以单段 `projectRoot` 接收 Project identity，
 * 禁止再出现 `projectPath` 形态的 query / body / multipart / 路由参数解析。
 *
 * 服务端内部旧形态（如 `WorkspaceFileTarget.projectPath`、session metadata）不在
 * 本审计范围，随 slice 2 的 `ProjectPath` brand 删除一并收口。
 * 这也是 Phase 8「生产零命中审计」的第一块：覆盖全部 route 文件，不依赖任何注册表。
 */
import {readFile, readdir} from "node:fs/promises";
import {join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const apiRoot = fileURLToPath(new URL("./", import.meta.url));

/** HTTP 边界的 projectPath 取参形态；命中任何一条即违反公开合同。 */
const FORBIDDEN_PATTERNS: readonly {pattern: RegExp; reason: string}[] = [
    {pattern: /query\??\.projectPath\b/u, reason: "inline query 仍在读取 projectPath"},
    {pattern: /params\??\.projectPath\b/u, reason: "路由参数仍在读取 projectPath"},
    {pattern: /projectPath\s*:\s*z[._]/u, reason: "zod schema 仍声明 projectPath 参数"},
    {pattern: /readTextPart\([^)]*,\s*["']projectPath["']\s*\)/u, reason: "multipart 仍在读取 projectPath 表单字段"},
    {pattern: /requireProjectPathQuery/u, reason: "已删除的 projectPath query helper 不得复活"},
];

async function collectTsFiles(dir: string, out: string[]): Promise<void> {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
        if (entry.isDirectory()) {
            await collectTsFiles(join(dir, entry.name), out);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
            out.push(join(dir, entry.name));
        }
    }
}

describe("server/api projectRoot HTTP 合同审计", () => {
    it("HTTP 边界零 projectPath 参数", async () => {
        const files: string[] = [];
        await collectTsFiles(apiRoot, files);
        expect(files.length).toBeGreaterThan(40); // 扫描面兜底：路径算错时立刻暴露

        const violations: string[] = [];
        for (const file of files) {
            const rel = relative(apiRoot, file).replaceAll("\\", "/");
            const source = await readFile(file, "utf8");
            for (const {pattern, reason} of FORBIDDEN_PATTERNS) {
                if (pattern.test(source)) {
                    violations.push(`${rel}: ${reason}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });
});
