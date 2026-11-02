/**
 * 生成 Agent 读的产品文档（docs/specs/agent/resources.md 输出 8）：`<输出>/builtin/sdk/` 是插件 SDK 的作者文档（与 SDK 包里
 * 同一个生成逻辑），`<输出>/agent/` 是 Agent 插件自己的文档。开发时生成到 `dist/docs/`，打应用包时 `pack-app.ts` 生成到包里
 * 的 `docs/`；服务端用 `plugins/agent/backend/docs-root.ts` 按同一布局找它。
 *
 * 用法：`bun run build:agent-docs [输出目录，缺省 dist/docs]`。
 */

import {cp, mkdir, rm} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

import {writeSdkDocs} from "../plugin-sdk/pack";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

export async function buildAgentDocs(outDir: string): Promise<void> {
    // 只替换自己生成的两个子目录：输出目录里别的东西不动。
    for (const name of ["builtin", "agent"]) await rm(join(outDir, name), {recursive: true, force: true});
    await mkdir(outDir, {recursive: true});
    await writeSdkDocs(join(outDir, "builtin", "sdk"));
    await cp(join(packageRoot, "src/plugins/agent/docs"), join(outDir, "agent"), {recursive: true});
}

if (import.meta.main) {
    const outDir = process.argv[2] ?? join(packageRoot, "dist/docs");
    await buildAgentDocs(outDir);
    console.log(`Agent 的产品文档已生成：${outDir}`);
}
