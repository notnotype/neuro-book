/**
 * 找内置表情包的目录（docs/specs/agent/stickers.md 的内置来源与输出 1）：同 Agent 文档（`agent/backend/docs-root.ts`），按包根找
 * （`backend/package-root.ts`）。打包后的应用在 `<包>/stickers/`（`scripts/pack-app.ts` 复制进去），从源码运行
 * （开发、测试、e2e 的构建产物）时在 `<包>/src/plugins/stickers/builtin/`。两处都没有时为 null，目录不出内置的表情包。
 */

import {existsSync} from "node:fs";
import {join} from "node:path";

import {packageRootOf} from "nbook/backend/package-root";

/** 内置表情包在打包后的应用里的目录名（`scripts/pack-app.ts` 复制到这里）。 */
export const PACKED_BUILTIN_DIRECTORY = "stickers";
/** 内置表情包在源码里的位置（相对包根的各段）：从源码运行时读这里，打包时从这里复制。 */
export const SOURCE_BUILTIN_DIRECTORY = ["src", "plugins", "stickers", "builtin"] as const;

/** `from` 是起点目录（缺省本模块所在目录），测试用它模拟安装布局。 */
export function locateBuiltinStickers(from: string = import.meta.dir): string | null {
    const root = packageRootOf(from);
    if (root === null) return null;
    return [join(root, PACKED_BUILTIN_DIRECTORY), join(root, ...SOURCE_BUILTIN_DIRECTORY)].find((candidate) => existsSync(candidate)) ?? null;
}
