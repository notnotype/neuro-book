import {createEventStream} from "h3";
import type {H3Event} from "h3";
import type {WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";
import {resolveWorkspaceFileTarget} from "nbook/server/workspace-files/novel-workspace";
import {
    subscribeWorkspaceTreeIndex,
    workspaceTreeIndexOptionsForTarget,
} from "nbook/server/workspace-files/project-workspace-index";
import {
    parseWorkspaceFileHttpBinding,
    startBoundProjectTargetOperation,
} from "nbook/server/workspace-files/project-open-guard";
import {isClosingEventStreamError} from "nbook/server/utils/event-stream";
import {runtimePathsFromEnv, type RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {withProductWorkspaceFiles} from "nbook/server/runtime/product-startup";
import type {createWorkspaceFilesService} from "nbook/server/features/workspace-files/service";
import {registerHttpEventStream} from "nbook/server/features/http/admission";

type WorkspaceFileEventsDependencies = {
    createEventStream: typeof createEventStream;
    runtimePaths: () => RuntimePaths;
    resolveWorkspaceFileTarget: typeof resolveWorkspaceFileTarget;
    subscribeWorkspaceTreeIndex: typeof subscribeWorkspaceTreeIndex;
    startProjectTargetOperation?: typeof startBoundProjectTargetOperation;
    workspaceTreeIndexOptionsForTarget?: typeof workspaceTreeIndexOptionsForTarget;
    withFiles?: typeof withProductWorkspaceFiles;
};

/**
 * 创建 workspace 文件事件 SSE handler，便于测试注入可控依赖。
 */
export function createWorkspaceFileEventsHandler(dependencies: WorkspaceFileEventsDependencies = {
    createEventStream,
    runtimePaths: runtimePathsFromEnv,
    resolveWorkspaceFileTarget,
    subscribeWorkspaceTreeIndex,
    startProjectTargetOperation: startBoundProjectTargetOperation,
    workspaceTreeIndexOptionsForTarget,
    withFiles: withProductWorkspaceFiles,
}) {
    return async (event: H3Event) => {
        const query = getQuery(event);
        const binding = parseWorkspaceFileHttpBinding(query);
        const target = await dependencies.resolveWorkspaceFileTarget(
            dependencies.runtimePaths(),
            binding,
        );
        const startOperation: typeof startBoundProjectTargetOperation = dependencies.startProjectTargetOperation ?? ((_, _binding, start) => (
            start(undefined, new AbortController().signal).result
        ));
        return startOperation(target, binding, (projectHandles, signal) => {
            const eventStream = dependencies.createEventStream(event);
            let streamClosed = false;
            let setupSettled = false;
            let closeSettled = false;
            // HTTP 排空必须等待关闭结算并保留 close rejection；其他关闭入口仍只触发收口，不等待结果。
            let closeFailed = false;
            let closeFailure: unknown;
            let closePromise: Promise<void> | null = null;
            let unsubscribe: (() => void) | null = null;
            let settleCompletion: () => void = () => undefined;
            const completion = new Promise<void>((resolve) => {
                settleCompletion = resolve;
            });

            const settleIfClosed = () => {
                if (streamClosed && setupSettled && closeSettled) {
                    settleCompletion();
                }
            };

            const finish = (): Promise<void> => {
                if (streamClosed) {
                    return closePromise ?? Promise.resolve();
                }
                streamClosed = true;
                unsubscribe?.();
                signal.removeEventListener("abort", finish);
                closePromise = eventStream.close().catch((error: unknown) => {
                    closeFailed = true;
                    closeFailure = error;
                }).finally(() => {
                    closeSettled = true;
                    settleIfClosed();
                });
                return closePromise;
            };

            const pushWorkspaceEvent = async (payload: WorkspaceFileStreamEventDto): Promise<void> => {
                if (streamClosed) {
                    return;
                }
                try {
                    await eventStream.push({
                        event: payload.type,
                        data: JSON.stringify(payload),
                    });
                } catch (error) {
                    if (isClosingEventStreamError(error)) {
                        finish();
                        return;
                    }
                    throw error;
                }
            };

            eventStream.onClosed(finish);
            registerHttpEventStream(event, async () => {
                await finish();
                await completion;
                if (closeFailed) {
                    throw closeFailure;
                }
            });
            if (signal.aborted) {
                finish();
            } else {
                signal.addEventListener("abort", finish, {once: true});
            }

            const run = async (files?: ReturnType<typeof createWorkspaceFilesService>, runtimeSignal?: AbortSignal) => {
                if (runtimeSignal?.aborted) finish();
                else runtimeSignal?.addEventListener("abort", finish, {once: true});
                try {
                    if (!streamClosed) {
                        const onEvent = async (payload: WorkspaceFileStreamEventDto) => { await pushWorkspaceEvent(payload); };
                        if (files) {
                            unsubscribe = await files.subscribe(onEvent);
                        } else {
                            const indexOptions = (dependencies.workspaceTreeIndexOptionsForTarget ?? workspaceTreeIndexOptionsForTarget)(target, projectHandles?.fileIndex);
                            unsubscribe = await dependencies.subscribeWorkspaceTreeIndex(indexOptions, onEvent);
                        }
                        if (streamClosed) unsubscribe();
                    }
                    const sent = await eventStream.send();
                    setupSettled = true;
                    settleIfClosed();
                    if (files) await completion;
                    return sent;
                } catch (error) {
                    finish();
                    throw error;
                } finally {
                    runtimeSignal?.removeEventListener("abort", finish);
                    setupSettled = true;
                    settleIfClosed();
                }
            };
            const result = (dependencies.withFiles
                ? dependencies.withFiles({target, handles: projectHandles}, run)
                : run()).catch((error) => {
                setupSettled = true;
                finish();
                settleIfClosed();
                throw error;
            });
            return {result, completion};
        });
    };
}

/**
 * 订阅当前小说 workspace 的文件系统变化。
 */
export default defineEventHandler(createWorkspaceFileEventsHandler());
