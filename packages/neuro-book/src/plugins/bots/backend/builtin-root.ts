/**
 * 找 `nbook.bots` 自己的预设文件的根（docs/specs/bots/bots.md“输入与前置条件”：内置插件的文件在应用包里，源码运行与安装包用同一套
 * 查找）：同内置表情包（`stickers/backend/builtin-root.ts`），按包根找。打包后的应用在 `<包>/bots/`（`scripts/pack-app.ts` 复制进去），
 * 从源码运行时在 `<包>/src/plugins/bots/builtin/`。两处都没有时为 null，缺省预设不可用。
 */

import {existsSync} from "node:fs";
import {join} from "node:path";

import {packageRootOf} from "nbook/backend/package-root";

/** 在打包后的应用里的目录名。 */
export const PACKED_BOTS_DIRECTORY = "bots";
/** 在源码里的位置（相对包根的各段）：从源码运行时读这里，打包时从这里复制。 */
export const SOURCE_BOTS_DIRECTORY = ["src", "plugins", "bots", "builtin"] as const;

/** `from` 是起点目录（缺省本模块所在目录），测试用它模拟安装布局。 */
export function locateBuiltinBots(from: string = import.meta.dir): string | null {
    const root = packageRootOf(from);
    if (root === null) return null;
    return [join(root, PACKED_BOTS_DIRECTORY), join(root, ...SOURCE_BOTS_DIRECTORY)].find((candidate) => existsSync(candidate)) ?? null;
}
