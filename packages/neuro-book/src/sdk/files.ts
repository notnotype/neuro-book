/**
 * 插件 SDK 的 `/files`：内置插件 `nbook.files` 的写入接口（docs/specs/workspace/resources.md 的“写入接口”）。服务端与项目实例的
 * 入口依赖 `workspaceFilesKey`，激活后读写书里与用户资产里的文件：读交回字节与基线或本机读路径，写经暂存与提交。浏览器入口
 * 不用它（浏览器的编辑器与文件树经自己的客户端）。
 * 规则同 `index.ts`：只再导出已有实现，每一项都是兼容范围内的承诺。
 */

export {baselineOf, workspaceFilesKey} from "nbook/plugins/files/shared/workspace-files";
export type {Baseline, CallOptions, CommitExpect, CommitOptions, ReadPath, ServerFilesResult, StagedSink, WorkspaceFiles} from "nbook/plugins/files/shared/workspace-files";
