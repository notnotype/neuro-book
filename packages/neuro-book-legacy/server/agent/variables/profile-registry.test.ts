import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import path from "node:path";
import {Type} from "typebox";
import {afterEach, describe, expect, it, vi} from "vitest";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";

const loadCompiledVariableDefinitions = vi.hoisted(() => vi.fn(async () => ({definitions: [], issues: []})));
const resolveVariableDefinitionArtifactPathContext = vi.hoisted(() => vi.fn(async (_definitionRoot: string, rootLabel: string, _compilerRoot: string) => ({
    compilerContext: {},
    mappings: [],
    rootLabel,
})));

vi.mock("nbook/server/agent/variables/definition-artifact", () => ({
    loadCompiledVariableDefinitions,
    resolveVariableDefinitionArtifactPathContext,
}));

import {createVariableRegistryForSession} from "nbook/server/agent/variables/profile-registry";

const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;

afterEach(() => {
    loadCompiledVariableDefinitions.mockClear();
    resolveVariableDefinitionArtifactPathContext.mockClear();
    if (originalStateRoot === undefined) {
        delete process.env.NEURO_BOOK_STATE_ROOT;
    } else {
        process.env.NEURO_BOOK_STATE_ROOT = originalStateRoot;
    }
});

describe("Session Variable Registry路径", () => {
    it("Global与Current Project定义使用调用方注入的结构化runtime identity", async () => {
        const workspaceRoot = absoluteFsPath(testHostPath("variable-registry-runtime", "workspace"));
        process.env.NEURO_BOOK_STATE_ROOT = testHostPath("unrelated-state-root");
        const applicationRoot = absoluteFsPath(testHostPath("variable-registry-runtime", "application"));
        const runtimePaths = createRuntimePaths({
            applicationRoot,
            stateRoot: absoluteFsPath(testHostPath("variable-registry-runtime", "state")),
        });
        const profile = defineAgentProfile({
            manifest: {key: "test.variable-registry", name: "Variable Registry"},
            initialSchema: Type.Object({}),
            tools: {},
            prepare() {
                return {};
            },
        });
        const ref = projectWorkspaceRef("project-a");

        await createVariableRegistryForSession({
            profile,
            globalWorkspaceRoot: workspaceRoot,
            currentProject: {
                workspace: resolvedProjectWorkspace(
                    ref,
                    absoluteFsPath(path.join(workspaceRoot, "project-a")),
                    createProjectWorkspaceKey(workspaceRoot, ref),
                ),
                generation: 1,
                publicId: "test-ready:1",
            },
            runtimePaths,
            projectDefinitionRootLabel: "workspace/project-a/.nbook/agent/variables",
        });

        expect(loadCompiledVariableDefinitions).toHaveBeenNthCalledWith(1, expect.objectContaining({
            definitionRoot: path.join(workspaceRoot, ".nbook", "agent", "variables"),
            namespace: "global",
            artifactPathContext: expect.objectContaining({rootLabel: "workspace/.nbook/agent/variables"}),
        }));
        expect(loadCompiledVariableDefinitions).toHaveBeenNthCalledWith(2, expect.objectContaining({
            definitionRoot: path.join(workspaceRoot, "project-a", ".nbook", "agent", "variables"),
            namespace: "project",
            artifactPathContext: expect.objectContaining({rootLabel: "workspace/project-a/.nbook/agent/variables"}),
        }));
        expect(resolveVariableDefinitionArtifactPathContext).toHaveBeenNthCalledWith(
            1,
            path.join(workspaceRoot, ".nbook", "agent", "variables"),
            "workspace/.nbook/agent/variables",
            applicationRoot,
        );
        expect(resolveVariableDefinitionArtifactPathContext).toHaveBeenNthCalledWith(
            2,
            path.join(workspaceRoot, "project-a", ".nbook", "agent", "variables"),
            "workspace/project-a/.nbook/agent/variables",
            applicationRoot,
        );
    });
});
