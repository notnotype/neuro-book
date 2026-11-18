/**
 * 找 Agent 读的产品文档目录（docs/specs/agent/resources.md 输出 8）：从本模块所在位置往上找到包根（有 `package.json` 的
 * 目录），打包后的应用在 `<包>/docs/`（`scripts/pack-app.ts`），开发时在 `<包>/dist/docs/`（`bun run build:agent-docs`）。
 * 两处都没有时为 null，`docs://` 说明要先生成。
 */

import {existsSync} from "node:fs";
import {join} from "node:path";

import {packageRootOf} from "nbook/backend/package-root";

/** `from` 是起点目录（缺省本模块所在目录），测试用它模拟安装布局。 */
export function locateDocsRoot(from: string = import.meta.dir): string | null {
    const root = packageRootOf(from);
    if (root === null) return null;
    for (const candidate of [join(root, "docs"), join(root, "dist", "docs")]) {
        if (existsSync(join(candidate, "builtin")) || existsSync(join(candidate, "agent"))) return candidate;
    }
    return null;
}
