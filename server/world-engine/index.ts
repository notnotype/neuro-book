import {WorldEngineFacade} from "nbook/server/world-engine/world-engine.facade";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

const facades = new Map<AbsoluteFsPath, WorldEngineFacade>();

/**
 * 返回绑定到明确 Workspace Root 的 World Engine 门面。
 *
 * 核心运行链必须显式传入当前 RuntimePaths 的 Workspace Root；Module 仅按该物理根
 * 复用 loader，不读取 cwd 或环境，也不会把一个 State Root 的实例复用于另一个实例。
 */
export function worldEngineFacadeForWorkspaceRoot(workspaceRoot: AbsoluteFsPath): WorldEngineFacade {
    const normalizedRoot = absoluteFsPath(workspaceRoot);
    const existing = facades.get(normalizedRoot);
    if (existing) {
        return existing;
    }
    const facade = new WorldEngineFacade(normalizedRoot);
    facades.set(normalizedRoot, facade);
    return facade;
}

/**
 * 释放指定 Workspace Root 的 World Engine runtime 引用。
 *
 * World Engine 当前不持有常驻数据库连接；这个 Interface 仍用于与 Plot runtime 的
 * 生命周期同步，并保证测试或进程关闭后不会继续复用旧 State Root 对应的 loader。
 */
export function disposeWorldEngineFacade(workspaceRoot: AbsoluteFsPath): void {
    facades.delete(absoluteFsPath(workspaceRoot));
}

/** 清空进程内全部 World Engine runtime；只供统一进程关闭与测试隔离使用。 */
export function disposeWorldEngineFacades(): void {
    facades.clear();
}

export {WorldEngineFacade};
export type {
    Instant,
    JsonValue,
    CreateWorldSubjectResult,
    DeleteSliceResult,
    PatchInput,
    QueryStateResult,
    SliceInput,
    SliceListItem,
    SliceWriteResult,
    SubjectState,
    WorldIssue,
    WorldIssueCode,
    WorldIssueExplanation,
    WorldIssueLabel,
    WorldIssueSeverity,
    WorldEngineWorldKey,
    WorldPatchOp,
    WorldSchemaProjection,
    WorldSliceSubjectFilterMode,
    WorldState,
    WorldSubjectListItem,
} from "nbook/server/world-engine/types";
export {normalizeWorldKey, WORLD_ENGINE_WORLD_KEYS} from "nbook/server/world-engine/types";
