import {provide} from "nbook/runtime/plugins/plugins";
import type {PluginDefinition} from "nbook/runtime/plugins/plugins";
import {defineServiceKey} from "nbook/runtime/services/services";
import {sessionStoreKey} from "nbook/server/features/session-store/plugin";
import {projectKey} from "nbook/server/features/project/plugin";
import {disposeAgentHarness} from "nbook/server/agent/http";

export const agentKey = defineServiceKey<{readonly ready: true}>("nbook.agent/ready");

export function createAgentPlugin(): PluginDefinition {
    return {
        id: "nbook.agent",
        entries: [{
            id: "server",
            location: "server",
            dependencies: [{key: sessionStoreKey}, {key: projectKey}],
            provides: [agentKey],
            activate: () => ({services: [provide(agentKey, {ready: true}, disposeAgentHarness)]}),
        }],
    };
}
