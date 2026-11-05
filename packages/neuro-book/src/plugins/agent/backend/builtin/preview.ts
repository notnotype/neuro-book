/**
 * 审批预览（docs/specs/agent/builtin-tools.md 输出 26）：用户批准之前看这次调用会改出什么。只读：按当前磁盘试算，不写盘、不激活
 * 任何提供方（工具是懒包装，审批前建实现会提前激活），也不写日志（预览加上参数会把事件撑过内联上限）。
 *
 * 一批审批是一起问的、还没执行：同一个文件前面还有别的调用时，按当前磁盘算的可能算不出来（行锚对不上），得 `failed`。
 * 算出来的也可能和实际执行不同，以实际执行为准。
 */

import type {SessionResources} from "../../shared/resources";
import type {ApprovalPreview} from "../../shared/remote";

import type {SessionEditStores} from "./common";
import {previewEdit} from "./edit";

/** 单个文件超过它不预览：diff 在浏览器主线程上算，通道也要分段。 */
export const PREVIEW_FILE_BYTES = 256 * 1024;

const EDIT_MODES: Readonly<Record<string, "hashline" | "replace">> = {"nbook.agent.edit": "hashline", "nbook.agent.edit-replace": "replace"};

type PreviewFile = ApprovalPreview["files"][number];

/** 改前的内容按文字解；解不了（图片这类）得 `failed`，`write` 覆盖它时用户也该知道这不是文字。 */
function fileEntry(address: string, before: Uint8Array, after: string): PreviewFile {
    const bytes = Math.max(before.byteLength, Buffer.byteLength(after));
    if (bytes > PREVIEW_FILE_BYTES) return {address, kind: "too-large", bytes};
    try {
        return {address, kind: "diff", before: new TextDecoder("utf-8", {fatal: true}).decode(before), after};
    } catch {
        return {address, kind: "failed", code: "not-text"};
    }
}

export async function approvalPreview(tool: string, args: Readonly<Record<string, unknown>>, resources: SessionResources, stores: SessionEditStores, sessionId: string, signal: AbortSignal): Promise<ApprovalPreview> {
    if (tool === "nbook.agent.write") return {files: [await previewWrite(args, resources, signal)]};
    const mode = EDIT_MODES[tool];
    if (mode === undefined) return {files: []};
    const held = stores.acquire(sessionId);
    try {
        const {written, failure} = await previewEdit(mode, args, resources, held.store, signal);
        const files: PreviewFile[] = [];
        for (const [address, after] of written) {
            const read = await resources.read(address, {signal});
            files.push(read.ok ? fileEntry(address, read.value.bytes, after) : {address, kind: "failed", code: read.code});
        }
        for (const address of failure?.targets ?? []) files.push({address, kind: "failed", code: failure!.code});
        return {files};
    } finally {
        held.release();
    }
}

async function previewWrite(args: Readonly<Record<string, unknown>>, resources: SessionResources, signal: AbortSignal): Promise<PreviewFile> {
    const path = args.path as string;
    const expanded = resources.expand(path);
    if (!expanded.ok) return {address: path, kind: "failed", code: expanded.code};
    const read = await resources.read(expanded.address, {signal});
    if (read.ok) return fileEntry(expanded.address, read.value.bytes, args.content as string);
    return read.code === "not-found" ? fileEntry(expanded.address, new Uint8Array(), args.content as string) : {address: expanded.address, kind: "failed", code: read.code};
}
