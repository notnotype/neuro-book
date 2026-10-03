import type {ResolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";

const SYSTEM_ASSETS_RELATIVE_ROOT = path.join("assets", "workspace", ".nbook");
const MODULE_APPLICATION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const RUNTIME_AGENT_ASSET_MODE = "install" as const;

/** 显式 Runtime 进程已完成 Seed 安装，运行期读取必须走 State Root。 */
export function isRuntimeAgentAssetInstallMode(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.NEURO_BOOK_RUNTIME_ASSET_MODE?.trim() === RUNTIME_AGENT_ASSET_MODE;
}

/** 系统Workspace模板测试覆盖；生产代码不得设置。 */
export type SystemWorkspaceAssetContext = {
    /** 非空时覆盖开发Adapter发现的Application Root。 */
    applicationRoot?: string;
    /** 非空时覆盖随应用发布的系统`.nbook`模板根。 */
    systemNbookRoot?: string;
    /** 非空时覆盖随应用发布的系统 Reference 书架根。 */
    systemReferenceRoot?: string;

};
let systemWorkspaceAssetContext: SystemWorkspaceAssetContext | null = null;

/** 测试专用：覆盖系统Workspace模板的真实磁盘root。 */
export function setSystemWorkspaceAssetContextForTest(context: SystemWorkspaceAssetContext | null): void {
    systemWorkspaceAssetContext = context
        ? {
            applicationRoot: context.applicationRoot ? path.resolve(context.applicationRoot) : undefined,
            systemNbookRoot: context.systemNbookRoot ? path.resolve(context.systemNbookRoot) : undefined,
            systemReferenceRoot: context.systemReferenceRoot ? path.resolve(context.systemReferenceRoot) : undefined,
        }
        : null;
}

/** 测试专用：读取当前系统Workspace模板覆盖值。 */
export function getSystemWorkspaceAssetContextForTest(): SystemWorkspaceAssetContext | null {
    return systemWorkspaceAssetContext ? {...systemWorkspaceAssetContext} : null;
}

/**
 * 开发/脚本Adapter：发现Application Root。
 *
 * Manager/Product设置根环境后直接使用RuntimePaths；仅无显式环境的源码开发和
 * 测试允许向上寻找bundled system assets。
 */
export function resolveApplicationRoot(startPath = process.cwd()): AbsoluteFsPath {
    if (systemWorkspaceAssetContext?.applicationRoot) {
        return absoluteFsPath(systemWorkspaceAssetContext.applicationRoot);
    }
    if (process.env.NEURO_BOOK_APPLICATION_ROOT?.trim() || process.env.NEURO_BOOK_STATE_ROOT?.trim()) {
        return runtimePathsFromEnv(startPath).applicationRoot;
    }
    let currentPath = path.resolve(startPath);
    while (true) {
        if (
            fs.existsSync(path.join(currentPath, SYSTEM_ASSETS_RELATIVE_ROOT))
            && (!isRepositoryOrchestratorRoot(currentPath) || fs.existsSync(path.join(currentPath, "nuxt.config.ts")))
        ) {
            return absoluteFsPath(currentPath);
        }

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
            break;
        }
        currentPath = parentPath;
    }

    if (fs.existsSync(path.join(MODULE_APPLICATION_ROOT, SYSTEM_ASSETS_RELATIVE_ROOT))) {
        return absoluteFsPath(MODULE_APPLICATION_ROOT);
    }
    return absoluteFsPath(path.resolve(startPath));
}

function isRepositoryOrchestratorRoot(root: string): boolean {
    return fs.existsSync(path.join(root, "bun.lock"))
        && fs.existsSync(path.join(root, "packages"))
        && fs.existsSync(path.join(root, "scripts"));
}

/** 解析随 Application Root/Product Image 发布的只读 Agent Seed `.nbook` 根。 */
export function resolveSystemSeedNbookRoot(startPath = process.cwd()): AbsoluteFsPath {
    if (systemWorkspaceAssetContext?.systemNbookRoot) {
        return absoluteFsPath(systemWorkspaceAssetContext.systemNbookRoot);
    }
    const productImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT?.trim();
    if (productImageRoot) {
        return absoluteFsPath(path.resolve(productImageRoot, "server", SYSTEM_ASSETS_RELATIVE_ROOT));
    }
    const applicationRoot = resolveApplicationRoot(startPath);
    const productAssetsRoot = path.join(applicationRoot, ".output", "server", SYSTEM_ASSETS_RELATIVE_ROOT);
    if (!fs.existsSync(path.join(applicationRoot, "node_modules")) && fs.existsSync(productAssetsRoot)) {
        return absoluteFsPath(productAssetsRoot);
    }
    return absoluteFsPath(path.join(applicationRoot, SYSTEM_ASSETS_RELATIVE_ROOT));
}

/** 运行期 `.nbook` 根：安装模式只读 State Root，非安装模式才读取 Seed。 */
export function resolveSystemNbookRoot(startPath = process.cwd()): AbsoluteFsPath {
    if (isRuntimeAgentAssetInstallMode()) {
        return absoluteFsPath(runtimePathsFromEnv(startPath).userNbookRoot);
    }
    if (systemWorkspaceAssetContext?.systemNbookRoot) {
        return absoluteFsPath(systemWorkspaceAssetContext.systemNbookRoot);
    }
    return resolveSystemSeedNbookRoot(startPath);
}

/** 解析随 Application Root/Product Image 发布的只读 Reference Seed。 */
export function resolveSystemSeedReferenceRoot(startPath = process.cwd()): AbsoluteFsPath {
    if (systemWorkspaceAssetContext?.systemReferenceRoot) {
        return absoluteFsPath(systemWorkspaceAssetContext.systemReferenceRoot);
    }
    const productImageRoot = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT?.trim();
    if (productImageRoot) {
        return absoluteFsPath(path.resolve(productImageRoot, "server", "assets", "reference"));
    }
    const applicationRoot = resolveApplicationRoot(startPath);
    const productReferenceRoot = path.join(applicationRoot, ".output", "server", "assets", "reference");
    if (!fs.existsSync(path.join(applicationRoot, "node_modules")) && fs.existsSync(productReferenceRoot)) {
        return absoluteFsPath(productReferenceRoot);
    }
    return absoluteFsPath(path.join(applicationRoot, "assets", "reference"));
}

/** 运行期 Reference 根：安装模式只读 State Root 中经验证的副本。 */
export function resolveSystemReferenceRoot(startPath = process.cwd()): AbsoluteFsPath {
    if (isRuntimeAgentAssetInstallMode()) {
        return absoluteFsPath(path.join(runtimePathsFromEnv(startPath).userNbookRoot, "reference"));
    }
    if (systemWorkspaceAssetContext?.systemReferenceRoot) {
        return absoluteFsPath(systemWorkspaceAssetContext.systemReferenceRoot);
    }
    return resolveSystemSeedReferenceRoot(startPath);
}

/**
 * 运行期 Agent Install Root。Catalog、Harness 和 Profile worker 只能从这里读取
 * bundled Agent 包；Application Seed 仅由安装器消费。
 */
export function resolveAgentInstallRoot(runtimePaths = runtimePathsFromEnv()): AbsoluteFsPath {
    return absoluteFsPath(path.join(runtimePaths.userNbookRoot, "agent"));
}

/** 当前已通过 Lifecycle containment/ready 校验的 Project Agent Root。 */
export function resolveProjectAgentRoot(project: ResolvedProjectWorkspace): AbsoluteFsPath {
    return absoluteFsPath(path.join(project.root, ".nbook", "agent"));
}
