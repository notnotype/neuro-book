import fs from "node:fs/promises";
import path from "node:path";
import {createError} from "h3";
import * as yaml from "yaml";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {normalizeProjectCoverPath} from "nbook/shared/project-cover";
import {
    resolveProjectWorkspaceRoot,
    type ProjectWorkspaceRef,
} from "nbook/server/workspace-files/project-identity";

/**
 * Project manifest（project.yaml）的读取与类型。
 *
 * 单独成模块的原因：writer 等 profile 需要在 artifact 里读 manifest 校验路径，
 * 而 `project-workspace.ts` 顶层值导入 @libsql/client（DB 驱动），不允许进
 * profile artifact 依赖图。这里只允许 fs/yaml/h3 与纯路径模块。
 * `project-workspace.ts` re-export 本模块，宿主侧消费方不受影响。
 */

export const PROJECT_MANIFEST_FILE = "project.yaml";

export type ProjectManifest = {
    kind: "novel";
    title: string;
    summary: string;
    /** 未设置或非法时为空；封面问题不能让 Project 身份失效。 */
    cover?: string;
};

/**
 * 读取 Project manifest。
 */
export async function readProjectManifest(
    workspaceRoot: AbsoluteFsPath,
    ref: ProjectWorkspaceRef,
): Promise<ProjectManifest> {
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, ref);
    const manifestPath = path.join(projectRoot, PROJECT_MANIFEST_FILE);
    const parsed = yaml.parse(await fs.readFile(manifestPath, "utf-8")) as Partial<ProjectManifest> | null;
    if (!parsed || parsed.kind !== "novel" || typeof parsed.title !== "string") {
        throw createError({statusCode: 400, message: `${ref.projectRoot}/${PROJECT_MANIFEST_FILE} 不是有效 Project manifest`});
    }
    const cover = normalizeProjectCoverPath(parsed.cover);
    return {
        kind: "novel",
        title: parsed.title,
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
        ...(cover === undefined ? {} : {cover}),
    };
}

/**
 * 安全读取 Project manifest。解析失败时返回错误文本，避免拖垮文件树和保存链路。
 */
export async function readProjectManifestIssue(
    workspaceRoot: AbsoluteFsPath,
    ref: ProjectWorkspaceRef,
): Promise<string | null> {
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, ref);
    return readProjectManifestIssueFromRoot(projectRoot);
}

/**
 * 从 Project Workspace 根目录安全读取 manifest issue。root 已经由调用方完成定位。
 */
export async function readProjectManifestIssueFromRoot(projectRoot: string): Promise<string | null> {
    try {
        const manifestPath = path.join(projectRoot, PROJECT_MANIFEST_FILE);
        const parsed = yaml.parse(await fs.readFile(manifestPath, "utf-8")) as Partial<ProjectManifest> | null;
        if (!parsed || parsed.kind !== "novel" || typeof parsed.title !== "string") {
            return `${PROJECT_MANIFEST_FILE} 不是有效 Project manifest`;
        }
        return null;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return "Project Workspace 缺少 project.yaml";
        }
        return error instanceof Error ? error.message : "project.yaml 解析失败";
    }
}
