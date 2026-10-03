import {join, resolve} from "node:path";
import {beforeEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    compileProfileArtifacts: vi.fn(async () => ({
        manifest: {
            compilerVersion: 8,
            generatedAt: new Date(0).toISOString(),
            profilesRoot: "assets/workspace/.nbook/agent/profiles",
            entries: [],
            profiles: [],
        },
        compiledDir: "",
        manifestPath: "",
        compiled: [],
    })),
    compileVariableDefinitions: vi.fn(async () => ({
        compilerVersion: 1,
        generatedAt: new Date(0).toISOString(),
        definitionsRoot: "assets/workspace/.nbook/agent/variables",
        definitions: [],
    })),
    resolveProfileArtifactPathContext: vi.fn(async (_profileRoot: string, rootLabel: string, _compilerRoot: string) => ({
        compilerContext: {productRuntime: false},
        mappings: [],
        rootLabel,
    })),
    resolveVariableDefinitionArtifactPathContext: vi.fn(async (_definitionRoot: string, rootLabel: string, _compilerRoot: string) => ({
        compilerContext: {productRuntime: false},
        mappings: [],
        rootLabel,
    })),
    syncSystemAssetsToUserAssets: vi.fn(async () => ({copied: 0, skipped: 0, updatedProfiles: 0, profileWarnings: [], updatedAssets: 0, assetWarnings: []})),
    projectLlmlintSkill: vi.fn(async () => ({sourceFiles: 0, copied: 0, unchanged: 0, removed: 0, bytes: 0, manifestSha256: "test"})),
    resolveSystemSeedNbookRoot: vi.fn(() => "C:/nbook-source/assets/workspace/.nbook"),
    resolveAgentInstallRoot: vi.fn(() => "C:/nbook-state/workspace/.nbook/agent"),
    isRuntimeAgentAssetInstallMode: vi.fn(() => false),
    runtimePathsFromEnv: vi.fn(() => ({
        applicationRoot: "C:/nbook-app",
        stateRoot: "C:/nbook-state",
        userNbookRoot: "C:/nbook-state/workspace/.nbook",
    })),
}));

vi.mock("nbook/server/agent/profiles/profile-artifact-compiler", () => ({
    compileProfileArtifacts: mocks.compileProfileArtifacts,
    resolveProfileArtifactPathContext: mocks.resolveProfileArtifactPathContext,
    SYSTEM_PROFILE_ARTIFACT_ROOT_LABEL: "assets/workspace/.nbook/agent/profiles",
}));
vi.mock("nbook/server/agent/variables/definition-artifact", () => ({
    compileVariableDefinitions: mocks.compileVariableDefinitions,
    resolveVariableDefinitionArtifactPathContext: mocks.resolveVariableDefinitionArtifactPathContext,
    SYSTEM_VARIABLE_DEFINITION_ROOT_LABEL: "assets/workspace/.nbook/agent/variables",
}));
vi.mock("nbook/server/workspace-files/llmlint-skill-projection", () => ({
    projectLlmlintSkill: mocks.projectLlmlintSkill,
}));
vi.mock("nbook/server/workspace-files/novel-workspace", () => ({
    syncSystemAssetsToUserAssets: mocks.syncSystemAssetsToUserAssets,
}));
vi.mock("nbook/server/workspace-files/system-workspace-assets", () => ({
    resolveSystemSeedNbookRoot: mocks.resolveSystemSeedNbookRoot,
    resolveAgentInstallRoot: mocks.resolveAgentInstallRoot,
    isRuntimeAgentAssetInstallMode: mocks.isRuntimeAgentAssetInstallMode,
}));
vi.mock("nbook/server/runtime/paths/runtime-paths", () => ({
    runtimePathsFromEnv: mocks.runtimePathsFromEnv,
}));

import {prepareSystemAssets} from "nbook/server/workspace-files/system-assets-preflight";

describe("System assets preflight lifecycle policy", () => {
    beforeEach(() => {
        mocks.compileProfileArtifacts.mockClear();
        mocks.compileVariableDefinitions.mockClear();
        mocks.syncSystemAssetsToUserAssets.mockClear();
        mocks.projectLlmlintSkill.mockClear();
        mocks.isRuntimeAgentAssetInstallMode.mockReturnValue(false);
        mocks.resolveProfileArtifactPathContext.mockImplementation(async (_profileRoot: string, rootLabel: string, _compilerRoot: string) => ({
            compilerContext: {productRuntime: false},
            mappings: [],
            rootLabel,
        }));
        mocks.resolveVariableDefinitionArtifactPathContext.mockImplementation(async (_definitionRoot: string, rootLabel: string, _compilerRoot: string) => ({
            compilerContext: {productRuntime: false},
            mappings: [],
            rootLabel,
        }));
    });

    it("内置 Source Profile 固定使用 builtin_source orphan 预算", async () => {
        await prepareSystemAssets();

        expect(mocks.compileProfileArtifacts).toHaveBeenCalledWith(expect.objectContaining({
            profileRoot: join(resolve("C:/nbook-source/assets/workspace/.nbook"), "agent", "profiles"),
            artifactPathContext: expect.objectContaining({rootLabel: "assets/workspace/.nbook/agent/profiles"}),
            skipFresh: true,
            writePolicy: "allow",
            orphanBudgetPolicy: "builtin_source",
            publish: undefined,
        }));
    });

    it("Product Runtime 首次安装使用已验证 Authoring Kit 写入 State Install Root", async () => {
        mocks.isRuntimeAgentAssetInstallMode.mockReturnValue(true);
        mocks.resolveProfileArtifactPathContext.mockImplementation(async (_profileRoot: string, rootLabel: string, _compilerRoot: string) => ({
            compilerContext: {productRuntime: true},
            mappings: [],
            rootLabel,
        }));
        mocks.resolveVariableDefinitionArtifactPathContext.mockImplementation(async (_definitionRoot: string, rootLabel: string, _compilerRoot: string) => ({
            compilerContext: {productRuntime: true},
            mappings: [],
            rootLabel,
        }));
        await prepareSystemAssets();
        expect(mocks.compileProfileArtifacts).toHaveBeenCalledWith(expect.objectContaining({
            profileRoot: join(resolve("C:/nbook-state/workspace/.nbook/agent"), "profiles"),
            writePolicy: "allow",
        }));
        expect(mocks.compileVariableDefinitions).toHaveBeenCalledWith(expect.objectContaining({
            definitionRoot: join(resolve("C:/nbook-state/workspace/.nbook"), "agent", "variables"),
            writePolicy: "allow",
        }));
        expect(mocks.syncSystemAssetsToUserAssets).toHaveBeenCalledWith(expect.objectContaining({
            syncProfiles: false,
            syncVariableCompiledArtifacts: false,
            excludeAgentPackages: true,
        }));
    });
});
