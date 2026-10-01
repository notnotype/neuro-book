import {provide, type PluginDefinition} from "nbook/runtime/plugins/plugins";
import {defineServiceKey} from "nbook/runtime/services/services";
import {createWorkspaceFilesService} from "nbook/server/features/workspace-files/service";

/** 只绑定已授权的请求数据面；Project/Index/History 寿命仍归原 owner。 */
export const workspaceFilesKey = defineServiceKey<{bind: typeof createWorkspaceFilesService}>("nbook.files/workspace");

export function createWorkspaceFilesPlugin(): PluginDefinition {
    return {
        id: "nbook.files",
        entries: [{
            id: "server",
            location: "server",
            provides: [workspaceFilesKey],
            activate: () => ({services: [provide(workspaceFilesKey, {bind: createWorkspaceFilesService})]}),
        }],
    };
}
