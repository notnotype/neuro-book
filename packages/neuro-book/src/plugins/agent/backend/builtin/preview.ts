/**
 * 审批预览在 NeuroBook 一侧的接线（docs/specs/agent/builtin-tools.md 输出 26）：哪个工具按哪种写法试算。试算本身在宿主套件
 * （`previewChanges`），只读、不激活提供方、不写日志。
 */

import {previewChanges} from "@notnotype/nb-harness/kit/tools";
import type {PreviewKind, SessionEditStores} from "@notnotype/nb-harness/kit/tools";
import type {SessionFiles} from "@notnotype/nb-harness/kit/files";

import type {ApprovalPreview} from "../../shared/remote";

const KINDS: Readonly<Record<string, PreviewKind>> = {"nbook.agent.write": "write", "nbook.agent.edit": "hashline", "nbook.agent.edit-replace": "replace"};

/** 不改文件的工具没有可预览的东西，交回空的预览。 */
export async function approvalPreview(tool: string, args: Readonly<Record<string, unknown>>, files: SessionFiles, stores: SessionEditStores, sessionId: string, signal: AbortSignal): Promise<ApprovalPreview> {
    const kind = KINDS[tool];
    return kind === undefined ? {files: []} : previewChanges(kind, args, files, stores, sessionId, signal);
}
