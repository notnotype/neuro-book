import {getQuery} from "h3";
import {useAgentHarness} from "nbook/server/agent/http";
import {loadEffectiveConfigFromTarget} from "nbook/server/config/config-service";
import type {RuntimeConfigTarget} from "nbook/server/config/types";
import {resolveAgentVisibleModels} from "nbook/server/agent/harness/agent-visible-models";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {
    requireActiveReadyProject,
    runReadyProjectOperation,
} from "nbook/server/runtime/product-project";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";

/** 正式 workflow 面：catalog 列表 + agent 可见模型清单（前端触发表单用） */
export default defineEventHandler((event) => withProjectHttpError(async () => {
    const query = getQuery(event);
    const projectRoot = typeof query.projectRoot === "string" && query.projectRoot.trim() ? query.projectRoot : undefined;
    const runtimePaths = runtimePathsFromEnv();
    const ready = projectRoot ? requireActiveReadyProject(projectWorkspaceRef(projectRoot)) : null;
    const configTarget: RuntimeConfigTarget = ready
        ? {scope: "project", workspaceRoot: runtimePaths.workspaceRoot, project: ready}
        : {scope: "global", workspaceRoot: runtimePaths.workspaceRoot, project: null};
    const readCatalog = async () => {
        const [items, config] = await Promise.all([
            useAgentHarness().workflows.list(ready?.workspace),
            loadEffectiveConfigFromTarget(configTarget),
        ]);
        return {
            workflows: items.map((item) => ({
                key: item.key,
                title: item.title,
                description: item.description,
                whenToUse: item.whenToUse ?? null,
                argsHint: item.argsHint,
                source: item.source,
            })),
            models: resolveAgentVisibleModels(config),
        };
    };
    return ready
        ? runReadyProjectOperation(ready, async () => readCatalog())
        : readCatalog();
}));
