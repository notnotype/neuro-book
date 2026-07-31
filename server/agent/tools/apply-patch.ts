import {lstat, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import {createPatch} from "diff";
import {firstChangedLine} from "nbook/server/agent/tools/file-tool-utils";
import type {FileScope, ResolvedFileAddress} from "nbook/server/workspace-files/file-scope";
import {authorizeFileOperation} from "nbook/server/workspace-files/authorized-file-operation";

type AddOperation = {
    type: "add";
    path: string;
    lines: string[];
};

type DeleteOperation = {
    type: "delete";
    path: string;
};

type UpdateOperation = {
    type: "update";
    path: string;
    moveTo?: string;
    chunks: PatchChunk[];
    noTrailingNewline?: boolean;
};

type PatchOperation = AddOperation | DeleteOperation | UpdateOperation;

type PatchChunk = {
    oldLines: string[];
    newLines: string[];
};

type VirtualFileState = {
    displayPath: string;
    address: ResolvedFileAddress;
    absolutePath: string;
    content: string | null;
    original: string;
    exists: boolean;
};

export type PlannedFileChange = {
    displayPath: string;
    address: ResolvedFileAddress;
    absolutePath: string;
    action: "add" | "update" | "delete";
    original: string;
    originalExists: boolean;
    updated: string | null;
};

export type ApplyCodexPatchResult = {
    files: Array<{
        path: string;
        action: "add" | "update" | "delete";
    }>;
    /** 成功落盘的完整变更清单（含 before/after 全文），供调用方做文件历史归因记账。 */
    changes: PlannedFileChange[];
    diff: string;
    firstChangedLine?: number;
};

/**
 * 解析 Codex 风格 apply_patch 文本。
 */
export function parseCodexPatch(patchText: string): PatchOperation[] {
    const lines = patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (lines[0] !== "*** Begin Patch") {
        throw new Error("apply_patch 必须以 *** Begin Patch 开始。");
    }

    const operations: PatchOperation[] = [];
    let index = 1;
    while (index < lines.length) {
        const line = lines[index] ?? "";
        if (line === "*** End Patch") {
            const rest = lines.slice(index + 1);
            if (rest.length > 1 || rest.some((item) => item.length > 0)) {
                throw new Error("apply_patch 在 *** End Patch 之后不能包含额外内容。");
            }
            if (operations.length === 0) {
                throw new Error("apply_patch 至少需要一个 hunk。");
            }
            return operations;
        }
        if (line.startsWith("*** Add File: ")) {
            const parsed = parseAddOperation(lines, index);
            operations.push(parsed.operation);
            index = parsed.nextIndex;
            continue;
        }
        if (line.startsWith("*** Delete File: ")) {
            const path = line.slice("*** Delete File: ".length).trim();
            if (!path) {
                throw new Error("Delete File 缺少路径。");
            }
            operations.push({type: "delete", path});
            index++;
            continue;
        }
        if (line.startsWith("*** Update File: ")) {
            const parsed = parseUpdateOperation(lines, index);
            operations.push(parsed.operation);
            index = parsed.nextIndex;
            continue;
        }
        throw new Error(`无法解析 apply_patch 行：${line}`);
    }
    throw new Error("apply_patch 缺少 *** End Patch。");
}

/**
 * 提取一段 apply_patch 文本会写入/影响的全部目标路径。
 * 包含 Add/Update/Delete 的 File 路径，以及 Update 的 `*** Move to:` 重命名目标——
 * 后者是真实写入点，只读模式的写豁免/审批必须把它算作目标（Task 90 修复）。
 * 解析失败时返回空数组（fail-closed：调用方据此判定"目标不可识别，不豁免"）。
 */
export function extractPatchTargetPaths(patchText: string): string[] {
    try {
        const paths: string[] = [];
        for (const operation of parseCodexPatch(patchText)) {
            paths.push(operation.path);
            if (operation.type === "update" && operation.moveTo) {
                paths.push(operation.moveTo);
            }
        }
        return paths;
    } catch {
        return [];
    }
}

/**
 * 以 all-or-nothing 方式应用 Codex 风格 patch。
 */
export async function applyCodexPatch(input: {
    fileScope: FileScope;
    patchText: string;
    /** 调用方附加的领域写门禁；在任何文件读取或落盘前对全部目标执行。 */
    authorizeWrite?: (address: ResolvedFileAddress) => Promise<void>;
}): Promise<ApplyCodexPatchResult> {
    const operations = parseCodexPatch(input.patchText);
    const authorizedAddresses = new Map<string, ResolvedFileAddress>();
    for (const operation of operations) {
        const paths = operation.type === "update" && operation.moveTo
            ? [operation.path, operation.moveTo]
            : [operation.path];
        for (const patchPath of paths) {
            if (!authorizedAddresses.has(patchPath)) {
                const authorized = await authorizeFileOperation(input.fileScope, patchPath, "apply_patch");
                await input.authorizeWrite?.(authorized.address);
                authorizedAddresses.set(patchPath, authorized.address);
            }
        }
    }
    const fileState = new Map<string, VirtualFileState>();
    const changes = new Map<string, PlannedFileChange>();

    for (const operation of operations) {
        if (operation.type === "add") {
            const target = await readVirtualFile(fileState, authorizedPatchAddress(authorizedAddresses, operation.path), operation.path);
            if (target.exists && target.content !== null) {
                throw new Error(`文件已存在，不能 Add File：${operation.path}`);
            }
            const updated = linesToText(operation.lines, true);
            fileState.set(target.absolutePath, {
                ...target,
                content: updated,
                original: target.original,
            });
            changes.set(target.absolutePath, {
                displayPath: operation.path,
                address: target.address,
                absolutePath: target.absolutePath,
                action: "add",
                original: target.original,
                originalExists: target.exists,
                updated,
            });
            continue;
        }

        if (operation.type === "delete") {
            const target = await readVirtualFile(fileState, authorizedPatchAddress(authorizedAddresses, operation.path), operation.path);
            await assertPatchTargetIsFile(target.absolutePath, operation.path);
            fileState.set(target.absolutePath, {
                ...target,
                content: null,
                original: target.original,
            });
            changes.set(target.absolutePath, {
                displayPath: operation.path,
                address: target.address,
                absolutePath: target.absolutePath,
                action: "delete",
                original: target.original,
                originalExists: target.exists,
                updated: null,
            });
            continue;
        }

        const source = await readVirtualFile(fileState, authorizedPatchAddress(authorizedAddresses, operation.path), operation.path);
        await assertPatchTargetIsFile(source.absolutePath, operation.path);
        if (source.content === null) {
            throw new Error(`无法更新已删除文件：${operation.path}`);
        }
        const updated = applyUpdateChunks(source.content, operation);
        const sourceChange: PlannedFileChange = {
            displayPath: operation.path,
            address: source.address,
            absolutePath: source.absolutePath,
            action: operation.moveTo ? "delete" : "update",
            original: source.original,
            originalExists: source.exists,
            updated: operation.moveTo ? null : updated,
        };
        if (operation.moveTo) {
            const targetPath = operation.moveTo;
            const target = await readVirtualFile(fileState, authorizedPatchAddress(authorizedAddresses, targetPath), targetPath);
            fileState.set(source.absolutePath, {
                ...source,
                content: null,
                original: source.original,
            });
            fileState.set(target.absolutePath, {
                ...target,
                content: updated,
                original: target.original,
            });
            changes.set(source.absolutePath, sourceChange);
            changes.set(target.absolutePath, {
                displayPath: targetPath,
                address: target.address,
                absolutePath: target.absolutePath,
                action: target.original ? "update" : "add",
                original: target.original,
                originalExists: target.exists,
                updated,
            });
            continue;
        }
        fileState.set(source.absolutePath, {
            ...source,
            content: updated,
            original: source.original,
        });
        changes.set(source.absolutePath, sourceChange);
    }

    const plannedChanges = [...changes.values()];
    if (plannedChanges.length === 0) {
        throw new Error("apply_patch 没有产生文件变更。");
    }
    await writePlannedChanges(plannedChanges);

    const diff = plannedChanges.map((change) => {
        return createPatch(change.displayPath, change.original, change.updated ?? "", undefined, undefined, {context: 4});
    }).join("\n");
    return {
        files: plannedChanges.map((change) => ({
            path: change.displayPath,
            action: change.action,
        })),
        changes: plannedChanges,
        diff,
        firstChangedLine: firstChangedLine(diff),
    };
}

function parseAddOperation(lines: string[], startIndex: number): {operation: AddOperation; nextIndex: number} {
    const path = (lines[startIndex] ?? "").slice("*** Add File: ".length).trim();
    if (!path) {
        throw new Error("Add File 缺少路径。");
    }
    const addLines: string[] = [];
    let index = startIndex + 1;
    while (index < lines.length && !isPatchBoundary(lines[index] ?? "")) {
        const line = lines[index] ?? "";
        if (!line.startsWith("+")) {
            throw new Error(`Add File ${path} 只能包含 + 行。`);
        }
        addLines.push(line.slice(1));
        index++;
    }
    if (addLines.length === 0) {
        throw new Error(`Add File ${path} 必须包含至少一行内容。`);
    }
    return {
        operation: {type: "add", path, lines: addLines},
        nextIndex: index,
    };
}

function parseUpdateOperation(lines: string[], startIndex: number): {operation: UpdateOperation; nextIndex: number} {
    const path = (lines[startIndex] ?? "").slice("*** Update File: ".length).trim();
    if (!path) {
        throw new Error("Update File 缺少路径。");
    }
    let index = startIndex + 1;
    let moveTo: string | undefined;
    if ((lines[index] ?? "").startsWith("*** Move to: ")) {
        moveTo = (lines[index] ?? "").slice("*** Move to: ".length).trim();
        if (!moveTo) {
            throw new Error(`Update File ${path} 的 Move to 缺少路径。`);
        }
        index++;
    }

    const chunks: PatchChunk[] = [];
    let current: PatchChunk | null = null;
    let noTrailingNewline = false;
    while (index < lines.length && !isPatchBoundary(lines[index] ?? "")) {
        const line = lines[index] ?? "";
        if (line === "*** End of File") {
            noTrailingNewline = true;
            index++;
            continue;
        }
        if (line.startsWith("@@")) {
            if (current && (current.oldLines.length > 0 || current.newLines.length > 0)) {
                chunks.push(current);
            }
            current = {oldLines: [], newLines: []};
            index++;
            continue;
        }
        if (!current) {
            current = {oldLines: [], newLines: []};
        }
        if (line.startsWith(" ")) {
            current.oldLines.push(line.slice(1));
            current.newLines.push(line.slice(1));
            index++;
            continue;
        }
        if (line.startsWith("-")) {
            current.oldLines.push(line.slice(1));
            index++;
            continue;
        }
        if (line.startsWith("+")) {
            current.newLines.push(line.slice(1));
            index++;
            continue;
        }
        throw new Error(`Update File ${path} 包含无法解析的行：${line}`);
    }
    if (current && (current.oldLines.length > 0 || current.newLines.length > 0)) {
        chunks.push(current);
    }
    if (!moveTo && chunks.length === 0) {
        throw new Error(`Update File ${path} 必须包含变更。`);
    }
    return {
        operation: {type: "update", path, moveTo, chunks, noTrailingNewline},
        nextIndex: index,
    };
}

function isPatchBoundary(line: string): boolean {
    return line === "*** End Patch"
        || line.startsWith("*** Add File: ")
        || line.startsWith("*** Delete File: ")
        || line.startsWith("*** Update File: ");
}

async function readVirtualFile(
    fileState: Map<string, VirtualFileState>,
    address: ResolvedFileAddress,
    displayPath: string,
): Promise<VirtualFileState> {
    const absolutePath = address.absolutePath;
    const existing = fileState.get(absolutePath);
    if (existing) {
        return existing;
    }
    let exists = true;
    const original = await readFile(absolutePath, "utf-8").catch((error) => {
        if (isNotFoundError(error)) {
            exists = false;
            return "";
        }
        if (isDirectoryError(error)) {
            throw new Error(`apply_patch 只能修改文件，不能修改目录：${displayPath}`);
        }
        throw error;
    });
    return {
        displayPath,
        address,
        absolutePath,
        content: original,
        original,
        exists,
    };
}

async function writePlannedChanges(plannedChanges: PlannedFileChange[]): Promise<void> {
    const rollbackChanges = [...plannedChanges].reverse();
    try {
        for (const change of plannedChanges) {
            if (change.updated === null) {
                await rm(change.absolutePath, {force: false});
                continue;
            }
            await mkdir(dirname(change.absolutePath), {recursive: true});
            await writeFile(change.absolutePath, change.updated, "utf-8");
        }
    } catch (error) {
        await rollbackPlannedChanges(rollbackChanges);
        throw error;
    }
}

async function rollbackPlannedChanges(plannedChanges: PlannedFileChange[]): Promise<void> {
    for (const change of plannedChanges) {
        if (!change.originalExists) {
            await rm(change.absolutePath, {force: true}).catch(() => undefined);
            continue;
        }
        await mkdir(dirname(change.absolutePath), {recursive: true}).catch(() => undefined);
        await writeFile(change.absolutePath, change.original, "utf-8").catch(() => undefined);
    }
}

/** 读取预授权地址；缺失表示调用方破坏了“全部授权后再读写”的事务边界。 */
function authorizedPatchAddress(addresses: Map<string, ResolvedFileAddress>, displayPath: string): ResolvedFileAddress {
    const address = addresses.get(displayPath);
    if (!address) {
        throw new Error(`apply_patch 缺少预授权地址：${displayPath}`);
    }
    return address;
}

async function assertPatchTargetIsFile(absolutePath: string, displayPath: string): Promise<void> {
    const stat = await lstat(absolutePath).catch((error) => {
        if (isNotFoundError(error)) {
            throw new Error(`文件不存在：${displayPath}`);
        }
        throw error;
    });
    if (!stat.isFile()) {
        throw new Error(`apply_patch 只能修改文件，不能修改目录：${displayPath}`);
    }
}

function applyUpdateChunks(original: string, operation: UpdateOperation): string {
    let updated = original;
    let cursor = 0;
    for (const chunk of operation.chunks) {
        const oldText = linesToText(chunk.oldLines, true);
        const newText = linesToText(chunk.newLines, true);
        const matchIndex = updated.indexOf(oldText, cursor);
        const fallbackIndex = matchIndex >= 0 ? matchIndex : updated.indexOf(trimTrailingNewline(oldText), cursor);
        if (fallbackIndex < 0) {
            throw new Error(`Patch application failed; missing context in ${operation.path}.`);
        }
        const matchedText = matchIndex >= 0 ? oldText : trimTrailingNewline(oldText);
        updated = updated.slice(0, fallbackIndex) + newText + updated.slice(fallbackIndex + matchedText.length);
        cursor = fallbackIndex + newText.length;
    }
    if (operation.noTrailingNewline) {
        updated = trimTrailingNewline(updated);
    }
    if (updated === original && !operation.moveTo) {
        throw new Error(`No changes made to ${operation.path}.`);
    }
    return updated;
}

function linesToText(lines: string[], trailingNewline: boolean): string {
    if (lines.length === 0) {
        return "";
    }
    return lines.join("\n") + (trailingNewline ? "\n" : "");
}

function trimTrailingNewline(value: string): string {
    return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function isNotFoundError(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && (error as {code?: string}).code === "ENOENT");
}

function isDirectoryError(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && (error as {code?: string}).code === "EISDIR");
}
