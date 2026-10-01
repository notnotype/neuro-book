import {provide} from "nbook/runtime/plugins/plugins";
import type {PluginDefinition} from "nbook/runtime/plugins/plugins";
import {defineServiceKey} from "nbook/runtime/services/services";
import {appStateKey} from "nbook/server/features/app-state/plugin";
import {disposeStorageHost} from "nbook/server/storage/host";

export const storageKey = defineServiceKey<{readonly ready: true}>("nbook.storage/ready");

export function createStoragePlugin(): PluginDefinition {
    return {
        id: "nbook.storage",
        entries: [{
            id: "server",
            location: "server",
            dependencies: [{key: appStateKey}],
            provides: [storageKey],
            activate: () => ({services: [provide(storageKey, {ready: true}, disposeStorageHost)]}),
        }],
    };
}
