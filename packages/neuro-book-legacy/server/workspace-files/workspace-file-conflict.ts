import {execFile} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import {createTwoFilesPatch} from "diff";
import type {WorkspaceWriteConflictDto} from "nbook/shared/dto/workspace-file-conflict.dto";

const execFileAsync = promisify(execFile);

type GitCommandResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
};

type BuildWorkspaceWriteConflictInput = {
    path: string;
    expectedMtimeMs: number | null;
    actualMtimeMs: number | null;
    baseContent: string;
    localContent: string;
    remoteContent: string;
    remoteExists: boolean;
    node: WorkspaceWriteConflictDto["node"];
};

/**
 * 构造工作区写入冲突 payload。
 */
export async function buildWorkspaceWriteConflict(input: BuildWorkspaceWriteConflictInput): Promise<WorkspaceWriteConflictDto> {
    const gitMerge = await tryBuildGitMerge(input);
    return {
        kind: "workspace_write_conflict",
        path: input.path,
        expectedMtimeMs: input.expectedMtimeMs,
        actualMtimeMs: input.actualMtimeMs,
        remoteExists: input.remoteExists,
        baseContent: input.baseContent,
        localContent: input.localContent,
        remoteContent: input.remoteContent,
        mergedContent: gitMerge?.mergedContent ?? buildFallbackMergedContent(input),
        localDiff: gitMerge?.localDiff ?? createFallbackPatch("base", "web", input.baseContent, input.localContent),
        remoteDiff: gitMerge?.remoteDiff ?? createFallbackPatch("base", "disk", input.baseContent, input.remoteContent),
        node: input.node,
        event: input.remoteExists
            ? {kind: "change", path: input.path}
            : {kind: "unlink", path: input.path},
    };
}

/**
 * 使用 git 生成 no-index diff 和三方 merge 文本。
 */
async function tryBuildGitMerge(input: BuildWorkspaceWriteConflictInput): Promise<{
    mergedContent: string;
    localDiff: string;
    remoteDiff: string;
} | null> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-conflict-"));
    const basePath = path.join(tempRoot, "base.md");
    const localPath = path.join(tempRoot, "web.md");
    const remotePath = path.join(tempRoot, "disk.md");
    try {
        await Promise.all([
            fs.writeFile(basePath, input.baseContent, "utf-8"),
            fs.writeFile(localPath, input.localContent, "utf-8"),
            fs.writeFile(remotePath, input.remoteContent, "utf-8"),
        ]);

        const [localDiff, remoteDiff, mergeResult] = await Promise.all([
            runGit(["diff", "--no-index", "--no-color", "--", basePath, localPath], tempRoot, [0, 1]),
            runGit(["diff", "--no-index", "--no-color", "--", basePath, remotePath], tempRoot, [0, 1]),
            runGit([
                "merge-file",
                "-p",
                "--diff3",
                "-L",
                "网页编辑",
                "-L",
                "共同基线",
                "-L",
                "真实文件",
                localPath,
                basePath,
                remotePath,
            ], tempRoot, [0, 1]),
        ]);

        return {
            localDiff: localDiff.stdout,
            remoteDiff: remoteDiff.stdout,
            mergedContent: mergeResult.stdout,
        };
    } catch {
        return null;
    } finally {
        await fs.rm(tempRoot, {recursive: true, force: true});
    }
}

/**
 * 执行 git 子命令；git diff/merge-file 有语义化非 0 退出码，需要显式允许。
 */
async function runGit(args: string[], cwd: string, allowedExitCodes: number[]): Promise<GitCommandResult> {
    try {
        const result = await execFileAsync("git", args, {
            cwd,
            encoding: "utf-8",
            maxBuffer: 2 * 1024 * 1024,
            windowsHide: true,
        });
        return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: 0,
        };
    } catch (error) {
        const output = error as {
            stdout?: string;
            stderr?: string;
            code?: number;
        };
        const exitCode = typeof output.code === "number" ? output.code : 1;
        if (allowedExitCodes.includes(exitCode)) {
            return {
                stdout: output.stdout ?? "",
                stderr: output.stderr ?? "",
                exitCode,
            };
        }
        throw error;
    }
}

/**
 * git 不可用时生成基础 patch。
 */
function createFallbackPatch(oldName: string, newName: string, oldContent: string, newContent: string): string {
    return createTwoFilesPatch(oldName, newName, oldContent, newContent, "", "", {context: 3});
}

/**
 * git 不可用时的三方冲突文本。
 */
function buildFallbackMergedContent(input: BuildWorkspaceWriteConflictInput): string {
    return [
        "<<<<<<< 网页编辑",
        input.localContent,
        "||||||| 共同基线",
        input.baseContent,
        "=======",
        input.remoteContent,
        ">>>>>>> 真实文件",
    ].join("\n");
}
