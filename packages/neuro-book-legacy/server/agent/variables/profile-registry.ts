import {resolve} from "node:path";
import type {AgentProfile} from "nbook/server/agent/profiles/types";
import {VariableRegistry, builtinVariableDefinitions} from "nbook/server/agent/variables/registry";
import {loadCompiledVariableDefinitions, resolveVariableDefinitionArtifactPathContext, type VariableDefinitionArtifactPathContext} from "nbook/server/agent/variables/definition-artifact";
import type {VariableAccessorIssue} from "nbook/server/agent/variables/types";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

export type VariableDefinitionArtifactPathContextProvider = (
    definitionRoot: string,
    rootLabel: string,
) => VariableDefinitionArtifactPathContext | Promise<VariableDefinitionArtifactPathContext>;

function contextForRoot(
    input: {
        definitionArtifactPathContextProvider?: VariableDefinitionArtifactPathContextProvider;
        runtimePaths?: RuntimePaths;
    },
    root: string,
    label: string,
): Promise<VariableDefinitionArtifactPathContext> {
    if (input.definitionArtifactPathContextProvider) {
        return Promise.resolve(input.definitionArtifactPathContextProvider(root, label));
    }
    if (input.runtimePaths) {
        return resolveVariableDefinitionArtifactPathContext(root, label, input.runtimePaths.applicationRoot);
    }
    throw new Error(`Variable registry 缺少显式 artifact path context：${label} (${root})`);
}
/**
 * 创建 profile 运行时变量 registry。内建变量由 VariableRegistry 自带，
 * profile 第一版只能额外注册 session.* 变量。
 */
export function createVariableRegistryForProfile(profile: AgentProfile): VariableRegistry {
    const registry = new VariableRegistry();
    for (const definition of profile.variableDefinitions ?? []) {
        if (definition.namespace !== "session") {
            throw new Error(`profile ${profile.manifest.key} 只能注册 session.* 变量定义：${definition.namespace}.${definition.key}`);
        }
        registry.register(definition);
    }
    return registry;
}

/**
 * 创建真实 session 运行时变量 registry，包含 Workspace Root / Project Workspace 编译后的变量定义。
 */
export async function createVariableRegistryForSession(input: {
    profile: AgentProfile;
    globalWorkspaceRoot: AbsoluteFsPath;
    currentProject: ReadyProjectSessionRef | null;
    runtimePaths?: RuntimePaths;
    definitionArtifactPathContextProvider?: VariableDefinitionArtifactPathContextProvider;
    globalDefinitionRootLabel?: string;
    projectDefinitionRootLabel?: string;
}): Promise<VariableRegistry> {
    const definitions = [...builtinVariableDefinitions()];
    const issues: VariableAccessorIssue[] = [];
    const globalDefinitionRoot = resolve(input.globalWorkspaceRoot, ".nbook", "agent", "variables");
    const globalLoaded = await loadCompiledVariableDefinitions({
        definitionRoot: globalDefinitionRoot,
        artifactPathContext: await contextForRoot(
            input,
            globalDefinitionRoot,
            input.globalDefinitionRootLabel ?? "workspace/.nbook/agent/variables",
        ),
        namespace: "global",
    });
    definitions.push(...globalLoaded.definitions);
    issues.push(...globalLoaded.issues);
    if (input.currentProject) {
        const projectDefinitionRoot = resolve(input.currentProject.workspace.root, ".nbook", "agent", "variables");
        const projectLoaded = await loadCompiledVariableDefinitions({
            definitionRoot: projectDefinitionRoot,
            artifactPathContext: await contextForRoot(
                input,
                projectDefinitionRoot,
                input.projectDefinitionRootLabel ?? "workspace/project/.nbook/agent/variables",
            ),
            namespace: "project",
        });
        definitions.push(...projectLoaded.definitions);
        issues.push(...projectLoaded.issues);
    }
    const registry = new VariableRegistry(definitions, issues);
    for (const definition of input.profile.variableDefinitions ?? []) {
        if (definition.namespace !== "session") {
            throw new Error(`profile ${input.profile.manifest.key} 只能注册 session.* 变量定义：${definition.namespace}.${definition.key}`);
        }
        registry.register(definition);
    }
    return registry;
}
