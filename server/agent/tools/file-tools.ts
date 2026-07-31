import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdir, readFile, stat, writeFile} from "node:fs/promises";
import {basename, dirname, isAbsolute, join, resolve, win32} from "node:path";
import {createPatch} from "diff";
import {Type} from "typebox";
import type {Static} from "typebox";
import {recordContextAccess} from "nbook/server/agent/context-access/profile-context-access";
import {detectImageMimeType, firstChangedLine} from "nbook/server/agent/tools/file-tool-utils";
import {formatSize, DEFAULT_MAX_BYTES, truncateHead, type TruncationResult} from "nbook/server/agent/tools/truncate";
import {OutputAccumulator} from "nbook/server/agent/tools/output-accumulator";
import type {NeuroAgentTool, NeuroToolUpdateCallback, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {applyCodexPatch} from "nbook/server/agent/tools/apply-patch";
import {recordAgentWorkspaceWrite} from "nbook/server/workspace-history/agent-file-recorder";
import {resolveSystemNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import {resolveSessionFileScope} from "nbook/server/agent/workspace/session-file-scope";
import {authorizeFileOperation, authorizeProcessCwd} from "nbook/server/workspace-files/authorized-file-operation";
import type {ResolvedFileAddress} from "nbook/server/workspace-files/file-scope";
import {imageMimeType} from "nbook/server/agent/attachments/agent-attachment-codec";
import {AttachmentError} from "nbook/server/agent/attachments/types";
import {AGENT_IMAGE_POLICY} from "nbook/server/agent/attachments/agent-attachment-policy";
import {normalizeProjectPath, projectSlug, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertRpFormalFileWrite} from "nbook/server/rp/intake-guard";

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
    fullOutputPath?: string;
};

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

/** 使用统一 File Scope / File Address Module解析工具路径，并保留领域归属。 */
async function resolveToolFile(
    context: ToolExecutionContext,
    inputPath: string,
    operation: "read" | "write" | "edit",
): Promise<ResolvedFileAddress> {
    const authorized = await authorizeFileOperation(resolveSessionFileScope(context), inputPath, operation);
    return authorized.address;
}

function createReadTool(): NeuroAgentTool {
    return {
        key: "read",
        name: "read",
        label: "read",
        executionMode: "parallel",
        description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to 2000 lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete. Text output includes line numbers automatically when offset/limit is used or output is truncated; pass lineNumbers=true to force them for short full-file reads. In a Project-bound session, cwd is the current Project Workspace, so use lorebook/..., manuscript/... or other Project-relative paths. Use workspace/<project>/... only as an explicit cross-project address. Use read to examine files instead of cat/head/tail/sed.`,
        parameters: ReadSchema,
        async executeWithContext(context: ToolExecutionContext, _toolCallId: string, params: unknown, _userInput?: unknown, signal?: AbortSignal) {
            const input = params as ReadInput;
            const address = await resolveToolFile(context, input.path, "read");
            const absolutePath = address.absolutePath;
            const imageCandidate = detectImageMimeType(absolutePath) !== null;
            if (imageCandidate && (await stat(absolutePath)).size > AGENT_IMAGE_POLICY.maxImageBytes) {
                throw new AttachmentError("limit_exceeded", "图片超过 read 工具允许大小。");
            }
            const buffer = await readFile(absolutePath);
            if (imageCandidate) {
                if (buffer.byteLength > AGENT_IMAGE_POLICY.maxImageBytes) {
                    throw new AttachmentError("limit_exceeded", "图片超过 read 工具允许大小。");
                }
                const mimeType = imageMimeType(buffer);
                if (!mimeType) {
                    throw new AttachmentError("invalid_input", "图片扩展名对应的文件内容不是受支持图片。");
                }
                if (!context.attachments) {
                    throw new Error("图片工具缺少 AttachmentStore。");
                }
                const attachment = await context.attachments.save({
                    bytes: buffer,
                    mimeType,
                });
                await recordReadContextAccess(context, address);
                return {
                    content: [
                        {type: "text", text: `Read image file [${mimeType}]`},
                        {type: "attachment", attachment, name: absolutePath.split(/[\\/]/).pop()},
                    ],
                    details: normalizeToolResultDetails({path: absolutePath}),
                };
            }

            await recordReadContextAccess(context, address);
            const text = buffer.toString("utf-8");
            const lines = text.split("\n");
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
                outputText = `[Line ${startLine + 1} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLine + 1}p' ${input.path} | head -c ${DEFAULT_MAX_BYTES}]`;
            } else if (truncation.truncated) {
                outputText += `\n\n[Showing lines ${startLine + 1}-${endLine} of ${lines.length}. Use offset=${endLine + 1} to continue.]`;
            } else if (nextOffset !== undefined) {
                outputText += `\n\n[${lines.length - startLine - input.limit!} more lines in file. Use offset=${nextOffset} to continue.]`;
            }
            return {
                content: [{type: "text", text: outputText}],
                details: normalizeToolResultDetails({
                    path: absolutePath,
                    startLine: startLine + 1,
                    endLine,
                    totalLines: lines.length,
                    nextOffset,
                    truncation: truncation.truncated ? truncation : undefined,
                }),
            };
        },
        async execute() {
            throw new Error("read 必须在 agent session workspace 内执行。");
        },
    };
}

async function recordReadContextAccess(context: ToolExecutionContext, address: ResolvedFileAddress): Promise<void> {
    const project = resolveContextAccessProject(context, address);
    if (!project) {
        return;
    }
    try {
        await recordContextAccess({
            projectRoot: project.root,
            projectSlug: project.slug,
            profileKey: context.profileKey,
            sessionId: String(context.sessionId),
            filePath: project.filePath,
        });
    } catch {
        // 访问推荐是辅助状态，不能影响 read 主流程。
    }
}

function addLineNumbers(content: string, firstLine: number): string {
    const lines = content.split("\n");
    return lines.map((line, index) => `${firstLine + index} | ${line}`).join("\n");
}

function resolveContextAccessProject(context: ToolExecutionContext, address: ResolvedFileAddress): {root: string; slug: string; filePath: string} | null {
    if (!address.projectPath) {
        return null;
    }
    const filePath = address.relativePath;
    if (!filePath.startsWith("lorebook/") && !filePath.startsWith("manuscript/")) {
        return null;
    }
    if (isAbsolute(address.projectPath)) {
        return {root: address.projectPath, slug: basename(address.projectPath), filePath};
    }
    const targetProjectPath = normalizeProjectPath(address.projectPath);
    return {
        root: resolveProjectWorkspaceRoot(context.workspaceFsRoot, targetProjectPath),
        slug: projectSlug(targetProjectPath),
        filePath,
    };
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
            const address = await resolveToolFile(context, input.path, "write");
            await assertRpFormalFileWrite(context, address);
            const absolutePath = address.absolutePath;
            // 记账 before：覆盖写前补读一次旧内容（不存在 = null，file.create 语义）
            const before = await readFile(absolutePath).catch(() => null);
            await mkdir(dirname(absolutePath), {recursive: true});
            await writeFile(absolutePath, input.content, "utf-8");
            await recordAgentWorkspaceWrite({
                sessionId: context.sessionId,
                workspaceRoot: context.workspaceFsRoot,
                address,
                before,
                after: input.content,
            });
            return {
                content: [{type: "text", text: `Successfully wrote ${Buffer.byteLength(input.content, "utf-8")} bytes to ${input.path}`}],
                details: undefined,
            };
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
            const address = await resolveToolFile(context, input.path, "edit");
            await assertRpFormalFileWrite(context, address);
            const absolutePath = address.absolutePath;
            const original = await readFile(absolutePath, "utf-8");
            const updated = applyExactEdits(original, input.edits, input.path);
            await writeFile(absolutePath, updated, "utf-8");
            await recordAgentWorkspaceWrite({
                sessionId: context.sessionId,
                workspaceRoot: context.workspaceFsRoot,
                address,
                before: original,
                after: updated,
            });
            const diff = createPatch(input.path, original, updated, undefined, undefined, {context: 4});
            return {
                content: [{type: "text", text: `Successfully replaced ${input.edits.length} block(s) in ${input.path}.`}],
                details: normalizeToolResultDetails({
                    diff,
                    firstChangedLine: firstChangedLine(diff),
                }),
            };
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
            const result = await applyCodexPatch({
                fileScope: resolveSessionFileScope(context),
                patchText: input.patch,
                authorizeWrite: (address) => assertRpFormalFileWrite(context, address),
            });
            // 逐 change 归因记账。moveTo 形态在 planned changes 中已拆成源 delete + 目标 add/update，
            // 按拆分结果各记一条（改名+改内容不满足 rename 的「内容不变」语义，不聚合，v1 接受时间线在此断链）。
            for (const change of result.changes) {
                await recordAgentWorkspaceWrite({
                    sessionId: context.sessionId,
                    workspaceRoot: context.workspaceFsRoot,
                    address: change.address,
                    before: change.originalExists ? change.original : null,
                    after: change.updated,
                });
            }
            return {
                content: [{type: "text", text: `Patch applied to ${result.files.map((file) => file.path).join(", ")}.`}],
                details: normalizeToolResultDetails({
                    files: result.files,
                    diff: result.diff,
                    firstChangedLine: result.firstChangedLine,
                }),
            };
        },
        async execute() {
            throw new Error("apply_patch 必须在 agent session workspace 内执行。");
        },
    };
}

function createBashTool(): NeuroAgentTool {
    return {
        key: "bash",
        name: "bash",
        label: "bash",
        executionMode: "sequential",
        description: "Execute a bash command in the current File Scope. Project-bound sessions use the current Project Workspace; Workspace and user-assets sessions use their own roots. The agent bin directories are prepended to PATH, with user assets before system assets, so use workspace node ... for content-node CLI tasks. Prefer / path separators in bash commands; quote Windows backslash paths if you must use them. Returns stdout and stderr merged. Output is truncated to the last 2000 lines or 50KB (whichever is hit first). If truncated, the full output is saved to a temp file and the result includes its path. Use bash for rg/find/ls/git/tests/build/workspace CLI, not for file reading or editing when a dedicated tool exists.",
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
            const fileScope = resolveSessionFileScope(context);
            const authorizedScope = await authorizeProcessCwd(fileScope);
            const output = new OutputAccumulator();
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
                            fullOutputPath: snapshot.fullOutputPath,
                        }) : undefined,
                    });
                },
            }).finally(async () => {
                output.finish();
            });
            const snapshot = output.snapshot(true);
            await output.closeTempFile();
            const formatted = formatBashOutput(snapshot, result.exitCode);
            if (result.exitCode !== 0) {
                throw new Error(formatted);
            }
            return {
                content: [{type: "text", text: formatted}],
                details: snapshot.truncation.truncated ? normalizeToolResultDetails({
                    truncation: snapshot.truncation,
                    fullOutputPath: snapshot.fullOutputPath,
                }) : undefined,
            };
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

async function runBash(input: {
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
    return new Promise((resolve, reject) => {
        const child = spawn(input.bash, ["-lc", command], {
            cwd: input.cwd,
            env: input.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let timeoutHandle: NodeJS.Timeout | undefined;
        let timedOut = false;
        if (input.timeout !== undefined && input.timeout > 0) {
            timeoutHandle = setTimeout(() => {
                timedOut = true;
                child.kill("SIGTERM");
            }, input.timeout * 1000);
        }
        const onAbort = () => {
            child.kill("SIGTERM");
        };
        input.signal?.addEventListener("abort", onAbort, {once: true});
        child.stdout?.on("data", input.onData);
        child.stderr?.on("data", input.onData);
        child.once("error", reject);
        child.once("close", (exitCode) => {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
            input.signal?.removeEventListener("abort", onAbort);
            if (input.signal?.aborted) {
                reject(new Error("Command aborted"));
                return;
            }
            if (timedOut) {
                reject(new Error(`Command timed out after ${input.timeout} seconds`));
                return;
            }
            resolve({exitCode});
        });
    });
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
        text += `\n\n[Showing lines ${startLine}-${endLine} of ${snapshot.truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
    }
    if (exitCode !== 0) {
        text += `\n\nCommand exited with code ${exitCode}`;
    }
    return text;
}
