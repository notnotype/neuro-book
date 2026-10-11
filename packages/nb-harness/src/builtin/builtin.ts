/**
 * 内置工具：受根约束的文件访问接口、read 与 edit。行为合同见 docs/specs/harness/builtin-tools.md。
 * 本地文件访问的实现在子入口 ./builtin/local（只有它用 Node 的文件系统）。
 */

import {createStaticToolSource} from "../tools/tools";
import type {ToolSource} from "../tools/tools";
import {editTool} from "./edit";
import {readTool} from "./read";
import {createSnapshotStores} from "./stores";
import type {FileAccess, ReadBudget, SnapshotStores} from "./types";

export type {EditStore, FileAccess, FileKind, FilesFailure, FilesResult, ReadBudget, SnapshotStores, ToolDefinition, ToolSource} from "./types";
export {createSnapshotStores} from "./stores";
export {readTool} from "./read";
export {editTool} from "./edit";

/**
 * read 与 edit 共用一套按会话分开的快照存储；来源是静态的，get 返回同一份定义。
 * 快照存储的寿命归装配方：自己建一份传进来，会话结束后 release(sessionId)；不传就由本来源持有，直到来源被丢弃。
 */
export function createBuiltinTools(input: {access: FileAccess; read?: ReadBudget; stores?: SnapshotStores}): ToolSource {
    const stores = input.stores ?? createSnapshotStores();
    return createStaticToolSource([readTool({access: input.access, stores, ...input.read}), editTool({access: input.access, stores})]);
}
