/**
 * `@notnotype/nb-harness/kit/tools`：与应用无关的内置工具（docs/specs/agent/builtin-tools.md）。工具只经宿主给的 `SessionFiles` 读写
 * （docs/specs/harness/host-kit.md），不自己写盘；说明里属于宿主的事实由 `BuiltinToolTexts` 给。宿主补贡献 id、`provider` 与给模型的
 * 名字，再按自己的贡献机制交给内核。
 */

import {globDeclaration, globTool, grepDeclaration, grepTool} from "./search.js";
import {hashlineDeclaration, hashlineTool, replaceDeclaration, replaceTool} from "./edit.js";
import {readDeclaration, readTool} from "./read.js";
import type {SessionEditStores} from "./snapshot.js";
import type {BuiltinToolTexts, KitToolDeclaration, KitToolImplementation} from "./types.js";
import {writeDeclaration, writeTool} from "./write.js";

export {imageFormat, prepareImage} from "./image.js";
export type {ImageFormat, PreparedImage} from "./image.js";
export {previewEdit} from "./edit.js";
export {PREVIEW_FILE_BYTES, previewChanges} from "./preview.js";
export type {PreviewKind} from "./preview.js";
export {MAX_READ_LINES, renderSnapshot, SNAPSHOT_MAX_BYTES} from "./read.js";
export {runGlob, runGrep} from "./search.js";
export {SessionEditStores} from "./snapshot.js";
export type {BuiltinToolTexts, KitToolDeclaration, KitToolImplementation} from "./types.js";

export type BuiltinToolName = "read" | "write" | "edit" | "editReplace" | "grep" | "glob";

/** 声明：纯数据，宿主在清单里静态登记用。 */
export function builtinDeclarations(texts: BuiltinToolTexts): Readonly<Record<BuiltinToolName, KitToolDeclaration>> {
    return {
        read: readDeclaration(texts.pathParameter),
        write: writeDeclaration(texts.pathParameter),
        edit: hashlineDeclaration(texts.editNote),
        editReplace: replaceDeclaration(texts.editNote),
        grep: grepDeclaration,
        glob: globDeclaration,
    };
}

/** 实现：每次激活一套，行锚快照跟着这一代；审批预览与压缩后的放回要读同一份快照，由宿主建好 `stores` 传进来。 */
export function builtinTools(options: {readonly stores: SessionEditStores}): Readonly<Record<BuiltinToolName, KitToolImplementation>> {
    const {stores} = options;
    return {
        read: readTool(stores),
        write: writeTool(stores),
        edit: hashlineTool(stores),
        editReplace: replaceTool(stores),
        grep: grepTool,
        glob: globTool,
    };
}
