/**
 * 内置工具：资源寻址（方案到提供者）、受根约束的文件访问接口、read 与 edit。行为合同见 docs/specs/harness/builtin-tools.md。
 * 本地文件访问的实现在子入口 ./builtin/local（只有它用 Node 的文件系统）。
 */

import {createStaticToolSource} from "../tools/tools";
import type {ToolSource} from "../tools/tools";
import {editTool} from "./edit";
import {readTool} from "./read";
import {createSnapshotStores} from "./stores";
import type {ReadBudget, ResourceAccess, SnapshotStores} from "./types";

export type {
    DirectoryProvider, EditStore, FileAccess, FileKind, FilesFailure, FilesResult, ReadBudget, ResourceAccess, ResourceAddress, ResourceProvider, SchemeContext, SchemeDefinition, SchemeInfo,
    SnapshotStores, ToolDefinition, ToolSource, VirtualProvider,
} from "./types";
export {createSnapshotStores} from "./stores";
export {createResourceAccess} from "./resources";
export {createArtifactProvider} from "./artifacts";
export type {ArtifactReader} from "./artifacts";
export {formatAddress, parseAddress} from "./address";
export {readTool} from "./read";
export {editTool} from "./edit";

/**
 * read 与 edit 共用一套按会话分开的快照存储；来源是静态的，get 返回同一份定义。
 * 快照存储的寿命归装配方：自己建一份传进来，会话结束后 release(sessionId)；不传就由本来源持有，直到来源被丢弃。
 */
export function createBuiltinTools(input: {resources: ResourceAccess; read?: ReadBudget; stores?: SnapshotStores}): ToolSource {
    const stores = input.stores ?? createSnapshotStores();
    return createStaticToolSource([readTool({resources: input.resources, stores, ...input.read}), editTool({resources: input.resources, stores})]);
}
