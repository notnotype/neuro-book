import {join} from "node:path";
import {PROFILE_COMPILED_DIR_NAME, type ProfileArtifactManifestItem} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {normalizeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import type {AgentProfile, AgentProfileDefinition, AgentProfileIssueCode} from "nbook/server/agent/profiles/types";
import {importRuntimeArtifact} from "nbook/server/utils/runtime-artifact-import";

/**
 * 按内容寻址 sha 加载 compiled profile artifact。该组件只负责 artifact import，
 * 不读源码、不判 freshness、不写 manifest。
 *
 * published artifact 的落盘名已经是 `artifacts/<输出字节 sha256>.mjs`，路径随内容变化，
 * 因此不需要额外的 Runtime Import Cache 物理副本——那层副本只服务于「源路径固定、
 * 靠换路径绕开 Bun 按 pathname 去重的 ESM module cache」的调用方。
 */
export class ProfileArtifactStore {
    /**
     * 从指定 profile root 的 `.compiled/artifacts/<sha>.mjs` 加载 profile。
     *
     * 调用方必须先通过 freshness gate（`ProfileFreshnessChecker.validate`）；
     * 那一步已对 artifact 做完整 sha256 + 字节数比对，本方法不重复 hash。
     */
    async importProfile(profileRoot: string, item: ProfileArtifactManifestItem): Promise<AgentProfile> {
        const artifactPath = join(profileRoot, PROFILE_COMPILED_DIR_NAME, item.artifactFileName);
        const mod = await importRuntimeArtifact<{
            default?: unknown;
        }>(artifactPath);
        const profile = mod.default;
        if (!this.isProfileDefinition(profile)) {
            throw new ProfileArtifactStoreError("invalid_export", `compiled profile 没有默认导出有效的 defineAgentProfile 结果：${artifactPath}`);
        }
        return normalizeAgentProfile(profile);
    }

    /** 只验证 authoring artifact 的最小声明形状；完整合同由宿主 normalizer 校验。 */
    private isProfileDefinition(value: unknown): value is AgentProfileDefinition {
        return Boolean(
            value
            && typeof value === "object"
            && "manifest" in value
            && "initialSchema" in value
            && "tools" in value
        );
    }
}

/**
 * artifact import 阶段的可分类错误，供 catalog 转成稳定 issue code。
 */
export class ProfileArtifactStoreError extends Error {
    constructor(readonly code: AgentProfileIssueCode, message: string) {
        super(message);
    }
}
