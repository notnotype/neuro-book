import {join} from "node:path";
import {createProfileArtifactPathContextResolver} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {resolveAgentInstallRoot, resolveSystemNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import type {WorkbenchRoots} from "nbook/server/agent/profiles/workbench-service";

/**
 * HTTP/CLI Adapter：Profile 运行根来自显式 RuntimePaths 的 State Root Install；
 * 模板是非 runtime authoring 资产，当前仍从显式 Application Seed 读取。
 */
export function profileWorkbenchRootsFromRuntime(runtimePaths: RuntimePaths = runtimePathsFromEnv()): WorkbenchRoots {
    const installRoot = resolveAgentInstallRoot(runtimePaths);
    const seedRoot = resolveSystemNbookRoot(runtimePaths.applicationRoot);
    return {
        profileRoot: join(installRoot, "profiles"),
        templateRoot: join(seedRoot, "agent", "profile-templates"),
        artifactPathContextResolver: createProfileArtifactPathContextResolver(runtimePaths.applicationRoot),
    };
}
