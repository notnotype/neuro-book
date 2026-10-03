import {randomUUID} from "node:crypto";
import {cp, mkdir, rm, writeFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {dirname, relative, resolve, sep} from "node:path";
import {createError} from "h3";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {
    compileProfileArtifacts,
    createProfileArtifactPathContextResolver,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {resolveAgentInstallRoot} from "nbook/server/workspace-files/system-workspace-assets";

export type ProfileSourceCheckRoots = {
    profileRoot?: string;
    runtimePaths?: RuntimePaths;
};

/**
 * 在临时用户 profile root 中覆盖指定源码，并用真实 catalog loader 执行校验。
 */
export async function withProfileSourceOverride<T>(
    input: {
        fileName: string;
        source: string;
        roots?: ProfileSourceCheckRoots;
    },
    callback: (catalog: AgentProfileCatalog, profileRoot: string) => Promise<T>,
): Promise<T> {
    const sourceRoot = input.roots?.profileRoot
        ?? (input.roots?.runtimePaths ? resolve(resolveAgentInstallRoot(input.roots.runtimePaths), "profiles") : null);
    if (!sourceRoot) {
        throw new Error("Profile source check 需要显式 Profile Root 或 RuntimePaths。");
    }
    const temporaryRoot = resolve(dirname(sourceRoot), ".staging", "profile-source-check", randomUUID());
    try {
        if (existsSync(sourceRoot)) {
            await cp(sourceRoot, temporaryRoot, {recursive: true, force: true});
        }
        const targetPath = resolveProfileFilePath(input.fileName, temporaryRoot);
        await mkdir(dirname(targetPath), {recursive: true});
        await writeFile(targetPath, input.source, "utf8");
        const compilerRoot = input.roots?.runtimePaths?.applicationRoot;
        if (!compilerRoot) {
            throw new Error("Profile source check 需要显式 RuntimePaths 才能建立 artifact path context。");
        }
        const resolver = createProfileArtifactPathContextResolver(compilerRoot);
        const artifactPathContext = await resolver(temporaryRoot, "temporary-profile-source-check");
        await compileProfileArtifacts({
            profileRoot: temporaryRoot,
            fileName: input.fileName,
            artifactPathContext,
        });
        return await callback(new AgentProfileCatalog(
            temporaryRoot,
            undefined,
            undefined,
            undefined,
            resolver,
            {install: "temporary-profile-source-check"},
        ), temporaryRoot);
    } finally {
        await rm(temporaryRoot, {recursive: true, force: true});
    }
}

/**
 * 将受控 fileName 解析到指定 profile root 内。
 */
function resolveProfileFilePath(fileName: string, root: string): string {
    const normalized = fileName.split(/[\\/]+/).filter(Boolean).join(sep);
    if (!/\.profile\.(tsx|ts|mjs|js)$/.test(normalized) || /^[A-Za-z]:/.test(fileName) || fileName.startsWith("/") || fileName.startsWith("\\")) {
        throw createError({
            statusCode: 400,
            statusMessage: "invalid_fileName",
            message: "profile fileName 必须是用户 profile root 下的相对路径。",
        });
    }
    const resolved = resolve(root, normalized);
    const relativePath = relative(root, resolved);
    if (!normalized || relativePath.startsWith("..") || /^[A-Za-z]:/.test(relativePath)) {
        throw createError({
            statusCode: 400,
            statusMessage: "invalid_fileName",
            message: "profile fileName 必须是用户 profile root 下的相对路径。",
        });
    }
    return resolved;
}
