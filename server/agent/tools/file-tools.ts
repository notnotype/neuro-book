import {existsSync} from "node:fs";
import {mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {dirname, join, resolve, win32} from "node:path";
import {createPatch} from "diff";
import {Type} from "typebox";
import type {Static} from "typebox";
import {spawnOwnedProcess} from "@notnotype/owned-process";
import {recordContextAccess} from "nbook/server/agent/context-access/profile-context-access";
import {detectImageMimeType, firstChangedLine} from "nbook/server/agent/tools/file-tool-utils";
import {formatSize, DEFAULT_MAX_BYTES, truncateHead, type TruncationResult} from "nbook/server/agent/tools/truncate";
import {OutputAccumulator} from "nbook/server/agent/tools/output-accumulator";
import {
    BashOutputStore,
    isBashOutputLocator,
    type BashOutputReference,
} from "nbook/server/agent/tools/bash-output-store";
import type {NeuroAgentTool, NeuroToolResult, NeuroToolUpdateCallback, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {applyCodexPatch, extractPatchTargetPaths} from "nbook/server/agent/tools/apply-patch";
import {captureAgentWorkspaceWrite, recordAgentWorkspaceWrite} from "nbook/server/workspace-history/agent-file-recorder";
import {resolveSystemNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import {
    authorizeFileOperation,
    authorizeProcessCwd,
    type ResolvedFileTarget,
} from "nbook/server/workspace-files/authorized-file-operation";
import {
    runProjectFileMutation,
    runProjectFileOperation,
} from "nbook/server/workspace-files/project-data-plane-guard";
import {AttachmentError} from "nbook/server/agent/attachments/types";
import {AGENT_IMAGE_POLICY} from "nbook/server/agent/attachments/agent-attachment-policy";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import type {JsonValue} from "nbook/shared/dto/agent-job.dto";

const ReadSchema = Type.Object({
    path: Type.String({description: "Path to the file to read (relative or absolute)."}),
    offset: Type.Optional(Type.Integer({minimum: 1, description: "Line number to start reading from (1-indexed)."})),
    limit: Type.Optional(Type.Integer({minimum: 1, description: "Maximum number of lines to read."})),
    lineNumbers: Type.Optional(Type.Boolean({description: "Whether to prefix text output lines with 1-indexed line numbers. Defaults to true when offset/limit is used or output is truncated."})),
}, {additionalProperties: false});

const WriteSchema = Type.Object({
    path: Type.String({description: "Path to the file to write (relative or absolute)."}),
    content: Type.String({description: "Content to write to the file."}),
}, {additionalProperties: false});

const EditSchema = Type.Object({
    path: Type.String({description: "Path to the file to edit (relative or absolute)."}),
    edits: Type.Array(Type.Object({
        oldText: Type.String({description: "Exact unique text to replace."}),
        newText: Type.String({description: "Replacement text."}),
    }, {additionalProperties: false}), {description: "One or more exact, non-overlapping replacements."}),
}, {additionalProperties: false});

const ApplyPatchSchema = Type.Object({
    patch: Type.String({description: "Codex apply_patch patch text. It must start with *** Begin Patch and end with *** End Patch."}),
}, {additionalProperties: false});

const BashSchema = Type.Object({
    command: Type.String({description: "Bash command to execute."}),
    timeout: Type.Optional(Type.Number({description: "Timeout in seconds."})),
    background: Type.Optional(Type.Boolean({description: "Default false. Set true to run in background: returns jobId immediately, output arrives later as a follow-up message. Use for long-running commands (builds, test suites, servers)."})),
}, {additionalProperties: false});

type ReadInput = Static<typeof ReadSchema>;
type WriteInput = Static<typeof WriteSchema>;
type EditInput = Static<typeof EditSchema>;
type BashInput = Static<typeof BashSchema>;

type ReadDetails = {
    truncation?: TruncationResult;
    path: string;
    startLine?: number;
    endLine?: number;
    totalLines?: number;
    nextOffset?: number;
};

type EditDetails = {
    diff: string;
    firstChangedLine?: number;
};

type BashDetails = {
    truncation?: TruncationResult;
    fullOutput?: BashOutputReference;
};

const bashOutputStores = new Map<string, Promise<BashOutputStore>>();

/**
 * 构造 Pi 风格基础文件与 bash 工具。
 */
export function createFileTools(): NeuroAgentTool[] {
    return [
        createReadTool(),
        createWriteTool(),
        createEditTool(),
        createApplyPatchTool(),
        createBashTool(),
    ];
}

/** 使用统一授权边界解析工具路径，并捕获 exact Project generation。 */
async function resolveToolFile(
    context: ToolExecutionContext,
    inputPath: string,
    operation: "read" | "write" | "edit" | "apply_patch",
): Promise<ResolvedFileTarget> {
    const authorized = await authorizeFileOperation(context, inputPath, operation);
    return authorized.target;
}

function createReadTool(): NeuroAgentTool {
    return {
        key: "read",
        name: "read",
        label: "read",
        executionMode: "parallel",
        description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to 2000 lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete. Text output includes line numbers automatically when offset/limit is used or output is truncated; pass lineNumbers=true to force them for short full-file reads. In a Project-bound session, cwd is the current Project Workspace, so use lorebook/..., manuscript/... or other Project-relative paths. Any absolute filesystem path can be used directly. For another managed Project, prefer workspace/<project>/... when Project identity, open gate, History, or Context Access matters. Use read to examine files instead of cat/head/tail/sed.`,
        parameters: ReadSchema,
        async executeWithContext(context: ToolExecutionContext, _toolCallId: string, params: unknown, _userInput?: unknown, signal?: AbortSignal) {
            const input = params as ReadInput;
            if (isBashOutputLocator(input.path)) {
                const buffer = await (await bashOutputStore(context)).read(input.path);
                return formatTextRead(buffer, input, input.path);
            }
            const target = await resolveToolFile(context, input.path, "read");
            return runProjectFileOperation([target], async () => {
                const contextAccess = captureReadContextAccess(target);
                const absolutePath = target.absolutePath;
                const imageCandidate = detectImageMimeType(absolutePath) !== null;
                if (imageCandidate && (await stat(absolutePath)).size > AGENT_IMAGE_POLICY.maxImageBytes) {
                    throw new AttachmentError("limit_exceeded", "图片超过 read 工具允许大小。");
                }
                const buffer = await readFile(absolutePath);
                if (imageCandidate) {
                    if (buffer.byteLength > AGENT_IMAGE_POLICY.maxImageBytes) {
                        throw new AttachmentError("limit_exceeded", "图片超过 read 工具允许大小。");
                    }
                    if (!context.attachmentCodec) {
                        throw new Error("图片工具缺少 AgentAttachmentCodec。");
                    }
                    const attachment = await context.attachmentCodec.saveImage({
                        bytes: buffer,
                        name: absolutePath.split(/[\\/]/).pop(),
                    });
                    await recordReadContextAccess(context, contextAccess);
                    return {
                        content: [
                            {type: "text", text: `Read image file [${attachment.attachment.mimeType}]`},
                            attachment,
                        ],
                        details: normalizeToolResultDetails({path: absolutePath}),
                    };
                }

                await recordReadContextAccess(context, contextAccess);
                await recordRecoveryRead(context, target, buffer);
                return formatTextRead(buffer, input, absolutePath);
            });
        },
        async execute() {
            throw new Error("read 必须在 agent session workspace 内执行。");
        },
    };
}

type ReadContextAccessCapture = Readonly<{
    project: ReadyProjectSessionRef;
    filePath: string;
}>;

/** 在文件读取前捕获目标 Project 的精确 ready generation，读取后不得按 path 重新求根。 */
function captureReadContextAccess(
    target: ResolvedFileTarget,
): ReadContextAccessCapture | null {
    const filePath = target.relativePath;
    if (!target.project || !filePath) {
        return null;
    }
    if (!filePath.startsWith("lorebook/") && !filePath.startsWith("manuscript/")) {
        return null;
    }
    return Object.freeze({
        project: target.project,
        filePath,
    });
}

/** 使用读取前捕获的 Project generation 记录辅助访问状态。 */
async function recordReadContextAccess(context: ToolExecutionContext, capture: ReadContextAccessCapture | null): Promise<void> {
    if (!capture) {
        return;
    }
    try {
        await recordContextAccess({
            project: capture.project,
            profileKey: context.profileKey,
            sessionId: String(context.sessionId),
            filePath: capture.filePath,
        });
    } catch {
        // 访问推荐是辅助状态，不能影响 read 主流程。
    }
}

function addLineNumbers(content: string, firstLine: number): string {
    const lines = content.split("\n");
    return lines.map((line, index) => `${firstLine + index} | ${line}`).join("\n");
}

function createWriteTool(): NeuroAgentTool {
    return {
        key: "write",
        name: "write",
        label: "write",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: "Create or overwrite a file. Automatically creates parent directories. Use write only for new files or complete rewrites, not targeted edits to existing files.",
        parameters: WriteSchema,
        async executeWithContext(context: ToolExecutionContext, _toolCallId: string, params: unknown, _userInput?: unknown, signal?: AbortSignal) {
            const input = params as WriteInput;
            const target = await resolveToolFile(context, input.path, "write");
            return runProjectFileMutation([target], async () => {
                const absolutePath = target.absolutePath;
                const historyCapture = captureAgentWorkspaceWrite(target);
                // 记账 before：覆盖写前补读一次旧内容（不存在 = null，file.create 语义）
                const before = await readFile(absolutePath).catch(() => null);
                await mkdir(dirname(absolutePath), {recursive: true});
                await writeFile(absolutePath, input.content, "utf-8");
                await recordAgentWorkspaceWrite({
                    sessionId: context.sessionId,
                    capture: historyCapture,
                    before,
                    after: input.content,
                });
                await recordRecoveryWrite(context, target, input.content, "write");
                return {
                    content: [{type: "text", text: `Successfully wrote ${Buffer.byteLength(input.content, "utf-8")} bytes to ${input.path}`}],
                    details: undefined,
                };
            });
        },
        async execute() {
            throw new Error("write 必须在 agent session workspace 内执行。");
        },
    };
}

function createEditTool(): NeuroAgentTool {
    return {
        key: "edit",
        name: "edit",
        label: "edit",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. When changing multiple separate locations in one file, use one edit call with multiple entries in edits[]. Each oldText is matched against the original file, not incrementally. Merge nearby changes into one edit and keep oldText as small as possible while still unique.",
        parameters: EditSchema,
        prepareArguments(args: unknown) {
            if (!args || typeof args !== "object") {
                return args as EditInput;
            }
            const input = {...args as Record<string, unknown>};
            if (typeof input.edits === "string") {
                input.edits = JSON.parse(input.edits);
            }
            if (typeof input.oldText === "string" && typeof input.newText === "string") {
                input.edits = [...(Array.isArray(input.edits) ? input.edits : []), {
                    oldText: input.oldText,
                    newText: input.newText,
                }];
                delete input.oldText;
                delete input.newText;
            }
            return input as EditInput;
        },
        async executeWithContext(context: ToolExecutionContext, _toolCallId: string, params: unknown, _userInput?: unknown, signal?: AbortSignal) {
            const input = params as EditInput;
            if (!Array.isArray(input.edits) || input.edits.length === 0) {
                throw new Error("edits must contain at least one replacement.");
            }
            const target = await resolveToolFile(context, input.path, "edit");
            return runProjectFileMutation([target], async () => {
                const absolutePath = target.absolutePath;
                const historyCapture = captureAgentWorkspaceWrite(target);
                const original = await readFile(absolutePath, "utf-8");
                const updated = applyExactEdits(original, input.edits, input.path);
                await writeFile(absolutePath, updated, "utf-8");
                await recordAgentWorkspaceWrite({
                    sessionId: context.sessionId,
                    capture: historyCapture,
                    before: original,
                    after: updated,
                });
                await recordRecoveryWrite(context, target, updated, "edit");
                const diff = createPatch(input.path, original, updated, undefined, undefined, {context: 4});
                return {
                    content: [{type: "text", text: `Successfully replaced ${input.edits.length} block(s) in ${input.path}.`}],
                    details: normalizeToolResultDetails({
                        diff,
                        firstChangedLine: firstChangedLine(diff),
                    }),
                };
            });
        },
        async execute() {
            throw new Error("edit 必须在 agent session workspace 内执行。");
        },
    };
}

function createApplyPatchTool(): NeuroAgentTool {
    return {
        key: "apply_patch",
        name: "apply_patch",
        label: "apply_patch",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: "Use the `apply_patch` tool to edit files by passing a Codex apply_patch patch in the `patch` string field. Use it when a change is naturally cohesive in one verified patch. For multiple separate locations in one file, prefer one edit call with multiple entries in edits[].",
        parameters: ApplyPatchSchema,
        async executeWithContext(context: ToolExecutionContext, _toolCallId: string, params: unknown, _userInput?: unknown, signal?: AbortSignal) {
            const input = params as {patch: string};
            const targets: ResolvedFileTarget[] = [];
            for (const targetPath of extractPatchTargetPaths(input.patch)) {
                targets.push(await resolveToolFile(context, targetPath, "apply_patch"));
            }
            return runProjectFileMutation(targets, async () => {
                const captures = new Map<string, ReturnType<typeof captureAgentWorkspaceWrite>>();
                for (const target of targets) {
                    captures.set(
                        target.absolutePath,
                        captureAgentWorkspaceWrite(target),
                    );
                }
                const result = await applyCodexPatch({
                    context,
                    patchText: input.patch,
                    captureChange: (change) => captures.get(change.absolutePath) ?? null,
                });
                // 逐 change 归因记账。moveTo 形态在 planned changes 中已拆成源 delete + 目标 add/update，
                // 按拆分结果各记一条（改名+改内容不满足 rename 的「内容不变」语义，不聚合，v1 接受时间线在此断链）。
                for (const change of result.changes) {
                    await recordAgentWorkspaceWrite({
                        sessionId: context.sessionId,
                        capture: change.capture,
                        before: change.originalExists ? change.original : null,
                        after: change.updated,
                    });
                    if (change.updated !== null) {
                        await recordRecoveryWrite(context, change.target, change.updated, "apply_patch");
                    }
                }
                return {
                    content: [{type: "text", text: `Patch applied to ${result.files.map((file) => file.path).join(", ")}.`}],
                    details: normalizeToolResultDetails({
                        files: result.files,
                        diff: result.diff,
                        firstChangedLine: result.firstChangedLine,
                    }),
                };
            });
        },
        async execute() {
            throw new Error("apply_patch 必须在 agent session workspace 内执行。");
        },
    };
}

async function recordRecoveryRead(context: ToolExecutionContext, target: ResolvedFileTarget, buffer: Buffer): Promise<void> {
    if (!context.recoveryMaterials || !target.project || !target.relativePath || target.relativePath === ".") {
        return;
    }
    try {
        const fileStat = await stat(target.absolutePath);
        if (!fileStat.isFile()) {
            return;
        }
        context.recoveryMaterials.recordSuccess({
            target,
            source: "read",
            content: buffer.toString("utf8"),
            mtimeMs: fileStat.mtimeMs,
        });
    } catch {
        // 恢复材料是辅助状态，不能把已成功的 read 变成工具失败。
    }
}

async function recordRecoveryWrite(context: ToolExecutionContext, target: ResolvedFileTarget, content: string, source: "write" | "edit" | "apply_patch"): Promise<void> {
    if (!context.recoveryMaterials || !target.project || !target.relativePath || target.relativePath === ".") {
        return;
    }
    try {
        const fileStat = await stat(target.absolutePath);
        if (!fileStat.isFile()) {
            return;
        }
        context.recoveryMaterials.recordSuccess({target, source, content, mtimeMs: fileStat.mtimeMs});
    } catch {
        // 恢复材料是辅助状态，不能把已成功的 write/edit/apply_patch 变成工具失败。
    }
}

function createBashTool(): NeuroAgentTool {
    return {
        key: "bash",
        name: "bash",
        label: "bash",
        executionMode: "sequential",
        description: "Execute a bash command in the current Project Workspace, or in the Workspace Root when the session has no Current Project. The agent bin directories are prepended to PATH, with user assets before system assets, so use workspace node ... for content-node CLI tasks. Prefer / path separators in bash commands; quote Windows backslash paths if you must use them. Returns stdout and stderr merged. Output is truncated to the last 2000 lines or 50KB (whichever is hit first). If truncated, the retained output is addressed by a logical bash-output locator and can be read with the read tool while it remains available. Use bash for rg/find/ls/git/tests/build/workspace CLI, not for file reading or editing when a dedicated tool exists.",
        parameters: BashSchema,
        async executeWithContext(
            context: ToolExecutionContext,
            _toolCallId: string,
            params: unknown,
            _userInput?: unknown,
            signal?: AbortSignal,
            onUpdate?: NeuroToolUpdateCallback,
        ) {
            const input = params as BashInput;
            const bash = resolveBashPath();
            const authorizedScope = await authorizeProcessCwd(context);
            // 后台模式（PLAN-E）：立即返回 jobId，输出以 followup 消息回流；取消经 job signal 直接 kill 进程
            if (input.background) {
                const {job, jobEventCursor} = context.harness.jobs.spawn({
                    kind: "bash",
                    title: `bash: ${input.command.length > 60 ? `${input.command.slice(0, 60)}…` : input.command}`,
                    ownerSessionId: context.sessionId,
                    originToolCallId: _toolCallId,
                    ref: {command: input.command},
                    run: async (ctx) => {
                        const output = new OutputAccumulator(await (await bashOutputStore(context)).reserve());
                        try {
                            const result = await runBash({
                                bash,
                                command: input.command,
                                cwd: authorizedScope.root,
                                env: createBashEnvironment(context),
                                timeout: input.timeout,
                                signal: ctx.signal,
                                onData(data) {
                                    output.append(data);
                                    ctx.setPreview(output.snapshot().content.slice(-300));
                                },
                            });
                            const snapshot = output.snapshot(true);
                            const formatted = formatBashOutput(snapshot, result.exitCode);
                            if (result.exitCode !== 0) throw new Error(formatted.length > 4000 ? `${formatted.slice(0, 4000)}…` : formatted);
                            return {
                                resultPreview: `exit 0（输出 ${snapshot.content.length} 字符）`,
                                result: {
                                    exitCode: result.exitCode,
                                    output: snapshot.content,
                                    truncation: snapshot.truncation as unknown as JsonValue,
                                    fullOutput: (snapshot.fullOutput ?? null) as unknown as JsonValue,
                                },
                                message: [
                                    `后台 bash 命令完成：\`${input.command}\``,
                                    "```",
                                    formatted.length > 6000 ? `${formatted.slice(0, 6000)}\n…（截断${formatFullOutput(snapshot.fullOutput)}）` : formatted,
                                    "```",
                                ].join("\n"),
                            };
                        } finally {
                            try {
                                output.finish();
                            } finally {
                                await output.closeOutput();
                            }
                        }
                    },
                });
                return {
                    content: [{type: "text", text: `后台命令已启动：${job.jobId}。输出将以后续消息回流；正常收尾本回合，不要轮询等待。`}],
                    details: normalizeToolResultDetails({
                        jobId: job.jobId,
                        jobEventCursor,
                        command: input.command,
                        status: "started",
                        background: true,
                    }),
                };
            }
            const output = new OutputAccumulator(await (await bashOutputStore(context)).reserve());
            try {
                const result = await runBash({
                    bash,
                    command: input.command,
                    cwd: authorizedScope.root,
                    env: createBashEnvironment(context),
                    timeout: input.timeout,
                    signal,
                    onData(data) {
                        output.append(data);
                        const snapshot = output.snapshot(true);
                        onUpdate?.({
                            content: [{type: "text", text: snapshot.content}],
                            details: snapshot.truncation.truncated ? normalizeToolResultDetails({
                                truncation: snapshot.truncation,
                                fullOutput: snapshot.fullOutput,
                            }) : undefined,
                        });
                    },
                });
                const snapshot = output.snapshot(true);
                const formatted = formatBashOutput(snapshot, result.exitCode);
                if (result.exitCode !== 0) {
                    throw new Error(formatted);
                }
                return {
                    content: [{type: "text", text: formatted}],
                    details: snapshot.truncation.truncated ? normalizeToolResultDetails({
                        truncation: snapshot.truncation,
                        fullOutput: snapshot.fullOutput,
                    }) : undefined,
                };
            } finally {
                try {
                    output.finish();
                } finally {
                    await output.closeOutput();
                }
            }
        },
        async execute() {
            throw new Error("bash 必须在 agent session workspace 内执行。");
        },
    };
}

type ExactEditMatch = {
    index: number;
    start: number;
    end: number;
    startLine: number;
    endLine: number;
    newText: string;
};

type ExactEditFailure = {
    index: number;
    reason: string;
};

function applyExactEdits(content: string, edits: EditInput["edits"], filePath: string): string {
    const matches = preflightExactEdits(content, edits, filePath);

    let updated = content;
    for (const match of [...matches].reverse()) {
        updated = updated.slice(0, match.start) + match.newText + updated.slice(match.end);
    }
    if (updated === content) {
        throw new Error(`No changes made to ${filePath}.`);
    }
    return updated;
}

function preflightExactEdits(content: string, edits: EditInput["edits"], filePath: string): ExactEditMatch[] {
    const failures: ExactEditFailure[] = [];
    const matches = edits.flatMap((edit, index): ExactEditMatch[] => {
        if (!edit.oldText) {
            failures.push({index, reason: "oldText must not be empty."});
            return [];
        }
        const occurrences = findOccurrences(content, edit.oldText);
        if (occurrences.length === 0) {
            failures.push({index, reason: "oldText was not found. It must match exactly."});
            return [];
        }
        if (occurrences.length > 1) {
            failures.push({
                index,
                reason: `oldText matched ${occurrences.length} locations at lines ${occurrences.map((start) => lineNumberAt(content, start)).join(", ")}. It must be unique.`,
            });
            return [];
        }
        const first = occurrences[0]!;
        return [{
            index,
            start: first,
            end: first + edit.oldText.length,
            startLine: lineNumberAt(content, first),
            endLine: lineNumberAt(content, first + edit.oldText.length),
            newText: edit.newText,
        }];
    }).sort((left, right) => left.start - right.start);

    for (let index = 1; index < matches.length; index++) {
        const previous = matches[index - 1];
        const current = matches[index];
        if (!previous || !current) {
            continue;
        }
        if (previous.end > current.start) {
            failures.push({
                index: current.index,
                reason: `overlaps edits[${previous.index}] at lines ${previous.startLine}-${previous.endLine}.`,
            });
        }
    }

    if (failures.length) {
        throw new Error(formatEditPreflightError(filePath, matches, failures));
    }
    return matches;
}

function formatEditPreflightError(filePath: string, matches: ExactEditMatch[], failures: ExactEditFailure[]): string {
    const matchedText = matches.length
        ? matches
            .map((match) => `- edits[${match.index}] matched lines ${match.startLine}-${match.endLine}.`)
            .join("\n")
        : "- none";
    const failedText = failures
        .sort((left, right) => left.index - right.index)
        .map((failure) => `- edits[${failure.index}] failed: ${failure.reason}`)
        .join("\n");
    return [
        `Edit preflight failed for ${filePath}. No changes were written.`,
        "Matched edits:",
        matchedText,
        "Failed edits:",
        failedText,
    ].join("\n");
}

function findOccurrences(content: string, needle: string): number[] {
    const occurrences: number[] = [];
    let start = 0;
    while (start <= content.length) {
        const found = content.indexOf(needle, start);
        if (found === -1) {
            break;
        }
        occurrences.push(found);
        start = found + Math.max(needle.length, 1);
    }
    return occurrences;
}

function lineNumberAt(content: string, index: number): number {
    return content.slice(0, Math.max(0, index)).split("\n").length;
}

function resolveBashPath(): string {
    const found = resolveBashPathForPlatform({
        platform: process.platform,
        env: process.env,
        pathExists: existsSync,
    });
    if (!found) {
        throw new Error("未找到 bash。请安装 Git Bash 或把 bash 加入 PATH。");
    }
    return found;
}

/**
 * 注入 Agent assets 的 bin 目录。用户覆盖优先于系统内置。
 */
function createBashEnvironment(context: ToolExecutionContext): NodeJS.ProcessEnv {
    const runtimePaths = context.harness.runtimePaths;
    const userNbookRoot = context.harness.runtimePaths?.userNbookRoot
        ?? resolve(context.harness.workspaceRoot, ".nbook");
    const systemNbookRoot = context.harness.runtimePaths
        ? resolveSystemNbookRoot(context.harness.runtimePaths.applicationRoot)
        : resolve(context.harness.workspaceRoot, ".nbook", "agent", "system");
    const userAgentBin = resolve(userNbookRoot, "agent", "bin");
    const systemAgentBin = resolve(systemNbookRoot, "agent", "bin");
    const userRipgrepConfig = resolve(userNbookRoot, "agent", "config", "ripgreprc");
    const systemRipgrepConfig = resolve(systemNbookRoot, "agent", "config", "ripgreprc");
    const ripgrepConfig = existsSync(userRipgrepConfig) ? userRipgrepConfig : systemRipgrepConfig;
    const currentPath = process.env.PATH ?? process.env.Path ?? "";
    return {
        ...process.env,
        ...(runtimePaths ? {
            NEURO_BOOK_APPLICATION_ROOT: runtimePaths.applicationRoot,
            NEURO_BOOK_STATE_ROOT: runtimePaths.stateRoot,
            NEURO_BOOK_CACHE_ROOT: runtimePaths.cacheRoot,
        } : {}),
        NEURO_BOOK_AGENT_BIN: userAgentBin,
        NEURO_BOOK_SYSTEM_AGENT_BIN: systemAgentBin,
        NEURO_BOOK_RIPGREP_CONFIG: ripgrepConfig,
        RIPGREP_CONFIG_PATH: ripgrepConfig,
        PATH: currentPath,
        Path: currentPath,
    };
}

/**
 * 按平台解析 bash 路径。Windows 优先使用真实存在的 Git Bash 路径，再查 PATH。
 */
export function resolveBashPathForPlatform(input: {
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    pathExists(path: string): boolean;
}): string | undefined {
    return input.platform === "win32"
        ? firstExistingPath(windowsBashCandidates(input.env), input.pathExists) ?? firstCommandOnPath(["bash.exe", "bash"], input.env.PATH, input.platform, input.pathExists)
        : firstExistingPath([input.env.BASH, "/bin/bash", "/usr/bin/bash"], input.pathExists) ?? firstCommandOnPath(["bash"], input.env.PATH, input.platform, input.pathExists);
}

function windowsBashCandidates(env: NodeJS.ProcessEnv): Array<string | undefined> {
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const localAppData = env.LOCALAPPDATA;
    const userProfile = env.USERPROFILE;
    const programData = env.ProgramData ?? "C:\\ProgramData";
    const chocolateyInstall = env.ChocolateyInstall;

    return [
        env.GIT_BASH,
        win32.join(programFiles, "Git", "bin", "bash.exe"),
        win32.join(programFiles, "Git", "usr", "bin", "bash.exe"),
        win32.join(programFilesX86, "Git", "bin", "bash.exe"),
        win32.join(programFilesX86, "Git", "usr", "bin", "bash.exe"),
        localAppData ? win32.join(localAppData, "Programs", "Git", "bin", "bash.exe") : undefined,
        localAppData ? win32.join(localAppData, "Programs", "Git", "usr", "bin", "bash.exe") : undefined,
        userProfile ? win32.join(userProfile, "scoop", "apps", "git", "current", "bin", "bash.exe") : undefined,
        userProfile ? win32.join(userProfile, "scoop", "apps", "git", "current", "usr", "bin", "bash.exe") : undefined,
        win32.join(programData, "scoop", "apps", "git", "current", "bin", "bash.exe"),
        win32.join(programData, "scoop", "apps", "git", "current", "usr", "bin", "bash.exe"),
        chocolateyInstall ? win32.join(chocolateyInstall, "lib", "git.install", "tools", "bin", "bash.exe") : undefined,
        chocolateyInstall ? win32.join(chocolateyInstall, "lib", "git.install", "tools", "usr", "bin", "bash.exe") : undefined,
    ];
}

/**
 * 返回第一个真实存在的绝对路径候选。
 */
function firstExistingPath(candidates: Array<string | undefined>, pathExists: (path: string) => boolean): string | undefined {
    return candidates.find((candidate) => Boolean(candidate && pathExists(candidate)));
}

/**
 * 在 PATH 中查找可执行命令名，返回模型工具实际传给 spawn 的命令名。
 */
function firstCommandOnPath(commands: string[], pathValue: string | undefined, platform: NodeJS.Platform, pathExists: (path: string) => boolean): string | undefined {
    const pathEntries = (pathValue ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
    return commands.find((command) => {
        return pathEntries.some((entry) => pathExists(platform === "win32" ? win32.join(entry, command) : join(entry, command)));
    });
}

export async function runBash(input: {
    bash: string;
    command: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout?: number;
    signal?: AbortSignal;
    onData(data: Buffer): void;
}): Promise<{exitCode: number | null}> {
    if (!existsSync(input.cwd)) {
        throw new Error(`Working directory does not exist: ${input.cwd}`);
    }
    const command = withAgentPathPrefix(input.command);
    const lease = spawnOwnedProcess({
        command: input.bash,
        args: ["-lc", command],
        cwd: input.cwd,
        env: input.env,
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
        graceMs: 250,
        hardKillWaitMs: 3_000,
    });
    let timeoutHandle: NodeJS.Timeout | undefined;
    let acceptsOutput = true;
    const onAbort = () => {
        acceptsOutput = false;
        void lease.terminate("abort").catch(() => undefined);
    };
    if (input.timeout !== undefined && input.timeout > 0) {
        timeoutHandle = setTimeout(() => {
            acceptsOutput = false;
            void lease.terminate("timeout").catch(() => undefined);
        }, input.timeout * 1000);
    }
    if (input.signal?.aborted) {
        onAbort();
    } else {
        input.signal?.addEventListener("abort", onAbort, {once: true});
    }
    const onData = (data: Buffer) => {
        if (acceptsOutput) input.onData(data);
    };
    lease.stdout?.on("data", onData);
    lease.stderr?.on("data", onData);
    try {
        const completion = await lease.completion;
        if (completion.terminationReason === "timeout") {
            throw new Error(`Command timed out after ${input.timeout} seconds`);
        }
        if (completion.terminationReason === "abort"
            || completion.terminationReason === "cancel"
            || completion.terminationReason === "shutdown") {
            throw new Error("Command aborted");
        }
        if (completion.terminationReason) {
            throw new Error(`Command terminated: ${completion.terminationReason}`);
        }
        return {exitCode: completion.exitCode};
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        input.signal?.removeEventListener("abort", onAbort);
    }
}

/**
 * Git Bash 会在启动时重排 Windows PATH。这里在 shell 内重新前置 Agent bin，
 * 确保 user-assets 覆盖目录比系统目录和宿主 PATH 更早命中。
 */
function withAgentPathPrefix(command: string): string {
    return [
        "NEURO_BOOK_AGENT_BIN_POSIX=\"$NEURO_BOOK_AGENT_BIN\"",
        "NEURO_BOOK_SYSTEM_AGENT_BIN_POSIX=\"$NEURO_BOOK_SYSTEM_AGENT_BIN\"",
        "NEURO_BOOK_RIPGREP_CONFIG_POSIX=\"$NEURO_BOOK_RIPGREP_CONFIG\"",
        "if command -v cygpath >/dev/null 2>&1; then",
        "  NEURO_BOOK_AGENT_BIN_POSIX=$(cygpath -u \"$NEURO_BOOK_AGENT_BIN\" 2>/dev/null || printf '%s' \"$NEURO_BOOK_AGENT_BIN\")",
        "  NEURO_BOOK_SYSTEM_AGENT_BIN_POSIX=$(cygpath -u \"$NEURO_BOOK_SYSTEM_AGENT_BIN\" 2>/dev/null || printf '%s' \"$NEURO_BOOK_SYSTEM_AGENT_BIN\")",
        "  NEURO_BOOK_RIPGREP_CONFIG_POSIX=$(cygpath -u \"$NEURO_BOOK_RIPGREP_CONFIG\" 2>/dev/null || printf '%s' \"$NEURO_BOOK_RIPGREP_CONFIG\")",
        "fi",
        "export PATH=\"$NEURO_BOOK_AGENT_BIN_POSIX:$NEURO_BOOK_SYSTEM_AGENT_BIN_POSIX:$PATH\"",
        "export RIPGREP_CONFIG_PATH=\"$NEURO_BOOK_RIPGREP_CONFIG_POSIX\"",
        command,
    ].join("\n");
}

function formatBashOutput(snapshot: ReturnType<OutputAccumulator["snapshot"]>, exitCode: number | null): string {
    let text = snapshot.content || "(no output)";
    if (snapshot.truncation.truncated) {
        const startLine = snapshot.truncation.totalLines - snapshot.truncation.outputLines + 1;
        const endLine = snapshot.truncation.totalLines;
        text += `\n\n[Showing lines ${startLine}-${endLine} of ${snapshot.truncation.totalLines}. ${formatFullOutput(snapshot.fullOutput)}]`;
    }
    if (exitCode !== 0) {
        text += `\n\nCommand exited with code ${exitCode}`;
    }
    return text;
}

/** Cache Root由生产RuntimePaths注入；纯Repository测试不允许隐式回退到Workspace。 */
async function bashOutputStore(context: ToolExecutionContext): Promise<BashOutputStore> {
    const root = context.harness.runtimePaths?.bashOutputRoot;
    if (!root) {
        throw new Error("Bash完整输出需要显式RuntimePaths Cache Root");
    }
    let store = bashOutputStores.get(root);
    if (!store) {
        store = (async () => {
            const created = new BashOutputStore(root);
            await created.collect();
            return created;
        })();
        bashOutputStores.set(root, store);
    }
    return store;
}

function formatFullOutput(reference: BashOutputReference | undefined): string {
    if (!reference || reference.state === "reclaimed") return "Full output reclaimed";
    return reference.state === "partial"
        ? `Full output capped at cache limit: ${reference.locator}`
        : `Full output: ${reference.locator}`;
}

/** 普通文件与Bash逻辑locator共用同一分页、字节截断和details合同。 */
function formatTextRead(buffer: Buffer, input: ReadInput, reportedPath: string): NeuroToolResult {
    const lines = buffer.toString("utf-8").split("\n");
    const startLine = input.offset ? Math.max(0, input.offset - 1) : 0;
    if (startLine >= lines.length) {
        throw new Error(`Offset ${input.offset} is beyond end of file (${lines.length} lines total)`);
    }
    const selected = input.limit !== undefined
        ? lines.slice(startLine, startLine + input.limit).join("\n")
        : lines.slice(startLine).join("\n");
    const truncation = truncateHead(selected);
    const shouldShowLineNumbers = input.lineNumbers ?? (input.offset !== undefined || input.limit !== undefined || truncation.truncated);
    const endLine = startLine + truncation.outputLines;
    const nextOffset = truncation.truncated
        ? endLine + 1
        : input.limit !== undefined && startLine + input.limit < lines.length ? startLine + input.limit + 1 : undefined;
    let outputText = shouldShowLineNumbers ? addLineNumbers(truncation.content, startLine + 1) : truncation.content;
    if (truncation.firstLineExceedsLimit) {
        const firstLineSize = formatSize(Buffer.byteLength(lines[startLine] ?? "", "utf-8"));
        outputText = `[Line ${startLine + 1} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use read with offset/limit to inspect retained output.]`;
    } else if (truncation.truncated) {
        outputText += `\n\n[Showing lines ${startLine + 1}-${endLine} of ${lines.length}. Use offset=${endLine + 1} to continue.]`;
    } else if (nextOffset !== undefined) {
        outputText += `\n\n[${lines.length - startLine - input.limit!} more lines in file. Use offset=${nextOffset} to continue.]`;
    }
    return {
        content: [{type: "text", text: outputText}],
        details: normalizeToolResultDetails({
            path: reportedPath,
            startLine: startLine + 1,
            endLine,
            totalLines: lines.length,
            nextOffset,
            truncation: truncation.truncated ? truncation : undefined,
        }),
    };
}
