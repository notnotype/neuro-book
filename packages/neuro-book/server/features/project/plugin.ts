import {createRuntimeInstance} from "nbook/runtime/lifecycle/lifecycle";
import type {Scope} from "nbook/runtime/lifecycle/lifecycle";
import {provide} from "nbook/runtime/plugins/plugins";
import type {PluginDefinition} from "nbook/runtime/plugins/plugins";
import {defineServiceKey} from "nbook/runtime/services/services";
import {sessionStoreKey} from "nbook/server/features/session-store/plugin";
import {storageKey} from "nbook/server/features/storage/plugin";
import {closeAllWorkspaceTreeIndexes} from "nbook/server/workspace-files/project-workspace-index";

export interface ProductProjectGeneration {
    readonly root: Scope;
    readonly scope: Scope;
    owner?: unknown;
}

export interface ProductProjectOwnerSlot {
    current: ProductProjectGeneration | null;
}

export const projectKey = defineServiceKey<ProductProjectGeneration>("nbook.project/owner");

export function createProjectPlugin(slot: ProductProjectOwnerSlot): PluginDefinition {
    return {
        id: "nbook.project",
        entries: [{
            id: "server",
            location: "server",
            dependencies: [{key: sessionStoreKey}, {key: storageKey}],
            provides: [projectKey],
            activate: (context) => {
                // 根作为服务资源持有，不能挂为 entry-work 子作用域：父级级联会早于 Agent 释放。
                const {root} = createRuntimeInstance({location: "server", instanceId: `${context.scope.instanceId}:project#${context.generation}`});
                root.open();
                const generation: ProductProjectGeneration = {root, scope: context.scope};
                slot.current = generation;
                let closeAttempted = false;
                return {services: [provide(projectKey, generation, async () => {
                    const result = await (closeAttempted ? root.recover() : root.close());
                    closeAttempted = true;
                    if (result.status !== "closed") {
                        throw new Error("Project generation尚未完整关闭，Session Store lease必须保留", {cause: result});
                    }
                    await closeAllWorkspaceTreeIndexes();
                })]};
            },
        }],
    };
}
