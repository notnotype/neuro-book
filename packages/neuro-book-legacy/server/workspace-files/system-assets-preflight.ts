import path from "node:path";
import {compileProfileArtifacts, resolveProfileArtifactPathContext, SYSTEM_PROFILE_ARTIFACT_ROOT_LABEL, type CompileProfileArtifactsResult, type ProfileReleasePublishOptions} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {compileVariableDefinitions, resolveVariableDefinitionArtifactPathContext, SYSTEM_VARIABLE_DEFINITION_ROOT_LABEL, type VariableDefinitionManifest} from "nbook/server/agent/variables/definition-artifact";
import {syncSystemAssetsToUserAssets, type UserAssetsSyncResult} from "nbook/server/workspace-files/novel-workspace";
import {projectLlmlintSkill, type LlmlintSkillProjectionResult} from "nbook/server/workspace-files/llmlint-skill-projection";
import {isRuntimeAgentAssetInstallMode, resolveAgentInstallRoot, resolveSystemSeedNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
export type SystemAssetsPreflightResult = {
    variableManifest: VariableDefinitionManifest;
    profileResult: CompileProfileArtifactsResult;
    llmlintSkill?: LlmlintSkillProjectionResult;
    userAssetsSync?: UserAssetsSyncResult;
};

/**
 * 准备系统 assets runtime artifact，并按需同步 legacy projection。
 *
 * Product build 只写镜像 Seed；Product Runtime 先把 Seed 中的 legacy
 * variables/templates/bin/config 投影到 State Root，再用自包含 Authoring Kit
 * 编译 State Install Root 中的 Profile/Variable artifact。Seeder 不负责 `.compiled`。
 */
export async function prepareSystemAssets(options: {
    syncUserAssets?: boolean;
    force?: boolean;
    forceSyncUserAssets?: boolean;
    /** 仅 Product 组装阶段允许写入镜像 Seed。 */
    productBuild?: boolean;
    profileRelease?: ProfileReleasePublishOptions;
} = {}): Promise<SystemAssetsPreflightResult> {
    const runtimePaths = runtimePathsFromEnv();
    const runtimeInstall = isRuntimeAgentAssetInstallMode();
    const seedNbookRoot = path.resolve(resolveSystemSeedNbookRoot(runtimePaths.applicationRoot));
    const installRoot = path.resolve(resolveAgentInstallRoot(runtimePaths));
    const legacySourceRoot = seedNbookRoot;
    const legacyTargetRoot = path.resolve(runtimePaths.userNbookRoot);
    let userAssetsSync: UserAssetsSyncResult | undefined;

    if (runtimeInstall) {
        userAssetsSync = await syncSystemAssetsToUserAssets({
            force: options.forceSyncUserAssets,
            profileRelease: options.profileRelease,
            sourceNbookRoot: legacySourceRoot,
            targetNbookRoot: legacyTargetRoot,
            syncManagedAssets: true,
            excludeAgentPackages: true,
            syncProfiles: false,
            syncVariableDefinitions: true,
            syncVariableCompiledArtifacts: false,
        });
    }

    const profileRoot = runtimeInstall
        ? path.join(installRoot, "profiles")
        : path.join(seedNbookRoot, "agent", "profiles");
    const variableDefinitionRoot = runtimeInstall
        ? path.join(legacyTargetRoot, "agent", "variables")
        : path.join(seedNbookRoot, "agent", "variables");
    const variableArtifactPathContext = await resolveVariableDefinitionArtifactPathContext(
        variableDefinitionRoot,
        runtimeInstall ? "workspace/.nbook/agent/variables" : SYSTEM_VARIABLE_DEFINITION_ROOT_LABEL,
        runtimePaths.applicationRoot,
    );
    const artifactPathContext = await resolveProfileArtifactPathContext(
        profileRoot,
        runtimeInstall ? "workspace/.nbook/agent/profiles" : SYSTEM_PROFILE_ARTIFACT_ROOT_LABEL,
        runtimePaths.applicationRoot,
    );
    const productRuntime = artifactPathContext.compilerContext.productRuntime
        || variableArtifactPathContext.compilerContext.productRuntime;
    // Product image 自身保持只读；Runtime install root 使用已验证的自包含 Authoring Kit 编译产物。
    const writePolicy = runtimeInstall && !options.productBuild
        ? "allow" as const
        : productRuntime && !options.productBuild
            ? "forbid" as const
            : "allow" as const;
    const variableWritePolicy = writePolicy;
    const llmlintSkill = writePolicy === "allow" && !runtimeInstall
        ? await projectLlmlintSkill({
            sourceRoot: path.resolve(runtimePaths.applicationRoot, "..", "llmlint", "skill"),
            targetRoot: path.join(seedNbookRoot, "agent", "skills", "llmlint"),
        })
        : undefined;
    const variableManifest = await compileVariableDefinitions({
        definitionRoot: variableDefinitionRoot,
        artifactPathContext: variableArtifactPathContext,
        skipFresh: !options.force,
        writePolicy: variableWritePolicy,
    });
    const profileResult = await compileProfileArtifacts({
        profileRoot,
        artifactPathContext,
        skipFresh: !options.force,
        writePolicy,
        orphanBudgetPolicy: runtimeInstall ? "user" : "builtin_source",
        publish: options.profileRelease,
    });
    if (options.syncUserAssets && !runtimeInstall) {
        userAssetsSync = await syncSystemAssetsToUserAssets({
            force: options.forceSyncUserAssets,
            profileRelease: options.profileRelease,
            syncManagedAssets: true,
            syncProfiles: true,
            syncVariableDefinitions: true,
        });
    }
    return {variableManifest, profileResult, llmlintSkill, userAssetsSync};
}
