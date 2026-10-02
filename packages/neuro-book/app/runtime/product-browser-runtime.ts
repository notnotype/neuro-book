import type {Component, Ref} from "vue";
import type {Application} from "nbook/runtime/application/application";
import type {FilesBinding} from "nbook/app/features/files/files-client";
import type {FilesBrowserService} from "nbook/app/features/files/browser-plugin";
import type {WorkbenchBrowserService} from "nbook/app/features/workbench/browser-plugin";
import type {DescriptorResult, WorkbenchRegistry} from "nbook/app/utils/workbench/descriptors";
import type {WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";

export interface ProductBrowserRuntime {
    readonly application: Application;
    readonly workbench: WorkbenchBrowserService;
    readonly registry: DescriptorResult<WorkbenchRegistry>;
    readonly available: Readonly<Ref<boolean>>;
    resolveViewFactory(factoryKey: string): DescriptorResult<Component>;
    subscribeFiles(binding: FilesBinding, onEvent: (event: WorkspaceFileStreamEventDto) => void, signal?: AbortSignal): Promise<void>;
}

export function productBrowserServices(application: Application, workbench: WorkbenchBrowserService, files: FilesBrowserService | null, available: Readonly<Ref<boolean>>): ProductBrowserRuntime {
    return {
        application, workbench, available,
        get registry() {return workbench.registry.value;},
        resolveViewFactory: (key) => workbench.resolveViewFactory(key),
        async subscribeFiles(binding, onEvent, signal) {
            if (!files || !available.value || application.root.stopSignal.aborted) throw new Error("浏览器 Files runtime 未就绪或已停止");
            return files.subscribe(binding, onEvent, signal);
        },
    };
}
