import {provide as provideService, type PluginDefinition} from "nbook/runtime/plugins/plugins";
import {defineServiceKey} from "nbook/runtime/services/services";
import {FILES_BROWSER_ENTRY, WORKBENCH_COMMAND_POINT, WORKBENCH_VIEW_POINT} from "nbook/shared/browser-bootstrap";
import {WORKBENCH_BROWSER_SERVICE, type BrowserViewImplementation} from "nbook/app/features/workbench/browser-plugin";
import {SHELL_FILES_VIEW} from "nbook/app/utils/workbench/product-catalog";
import {SHELL_FILES_REFRESH_COMMAND} from "nbook/app/utils/workbench/workbench-shell-commands";
import {resolveWorkbenchViewFactory} from "nbook/app/utils/workbench/view-factories";
import {FilesClient, createHttpFilesTransport, type FilesBinding} from "./files-client";
import type {WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";

export interface FilesBrowserService {
    subscribe(binding: FilesBinding, onEvent: (event: WorkspaceFileStreamEventDto) => void, signal?: AbortSignal): Promise<void>;
}
export const FILES_BROWSER_SERVICE = defineServiceKey<FilesBrowserService>("nbook.files/browser");
export function filesBrowserPlugin(): PluginDefinition {
    return {
        id: FILES_BROWSER_ENTRY.plugin,
        entries: [{
            id: FILES_BROWSER_ENTRY.entry,
            location: "browser",
            dependencies: [{key: WORKBENCH_BROWSER_SERVICE}],
            provides: [FILES_BROWSER_SERVICE],
            contributions: [
                {capability: WORKBENCH_VIEW_POINT, id: SHELL_FILES_VIEW.id, declaration: SHELL_FILES_VIEW},
                {capability: WORKBENCH_COMMAND_POINT, id: SHELL_FILES_REFRESH_COMMAND.command.id, declaration: SHELL_FILES_REFRESH_COMMAND},
            ],
            activate({services, signal}) {
                const workbench = services.require(WORKBENCH_BROWSER_SERVICE);
                const factory = resolveWorkbenchViewFactory(SHELL_FILES_VIEW.factoryKey);
                if (!factory.ok) throw new Error(factory.reason);
                const view: BrowserViewImplementation = {descriptor: SHELL_FILES_VIEW, component: factory.value};
                const transport = createHttpFilesTransport();
                const files: FilesBrowserService = {
                    async subscribe(binding, onEvent, callerSignal) {
                        if (signal.aborted || callerSignal?.aborted) throw new Error("浏览器 Files runtime 已停止");
                        return new FilesClient(binding, transport).events(onEvent,
                            callerSignal === undefined ? signal : AbortSignal.any([signal, callerSignal]));
                    },
                };
                return {services: [provideService(FILES_BROWSER_SERVICE, files)], contributions: {
                    [WORKBENCH_VIEW_POINT]: {[SHELL_FILES_VIEW.id]: view},
                    [WORKBENCH_COMMAND_POINT]: {[SHELL_FILES_REFRESH_COMMAND.command.id]: workbench.viewCommands},
                }};
            },
        }],
    };
}
