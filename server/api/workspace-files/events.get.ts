import {createEventStream} from "h3";
import type {H3Event} from "h3";
import type {WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";
import {resolveWorkspaceFileTarget} from "nbook/server/workspace-files/novel-workspace";
import {
    subscribeWorkspaceTreeIndex,
    workspaceTreeIndexOptionsForTarget,
} from "nbook/server/workspace-files/project-workspace-index";
import {
    startProjectTargetOperation,
} from "nbook/server/workspace-files/project-open-guard";
import {isClosingEventStreamError} from "nbook/server/utils/event-stream";
import {runtimePathsFromEnv, type RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";

type WorkspaceFileEventsDependencies = {
    createEventStream: typeof createEventStream;
    runtimePaths: () => RuntimePaths;
    resolveWorkspaceFileTarget: typeof resolveWorkspaceFileTarget;
    subscribeWorkspaceTreeIndex: typeof subscribeWorkspaceTreeIndex;
    startProjectTargetOperation?: typeof startProjectTargetOperation;
    workspaceTreeIndexOptionsForTarget?: typeof workspaceTreeIndexOptionsForTarget;
};

type WorkspaceFileEventsContext = {
    productShutdownSignal?: AbortSignal;
};

/**
 * 创建 workspace 文件事件 SSE handler，便于测试注入可控依赖。
 */
export function createWorkspaceFileEventsHandler(dependencies: WorkspaceFileEventsDependencies = {
    createEventStream,
    runtimePaths: runtimePathsFromEnv,
    resolveWorkspaceFileTarget,
    subscribeWorkspaceTreeIndex,
    startProjectTargetOperation,
    workspaceTreeIndexOptionsForTarget,
}) {
    return async (event: H3Event) => {
        const query = getQuery(event);
        const projectRoot = typeof query.projectRoot === "string" ? query.projectRoot : undefined;
        const workspaceKind = query.workspaceKind === "user-assets" ? query.workspaceKind : undefined;
        const target = await dependencies.resolveWorkspaceFileTarget(
            dependencies.runtimePaths(),
            {projectRoot, workspaceKind},
        );
        const requestShutdownSignal = (event.context as WorkspaceFileEventsContext | undefined)?.productShutdownSignal;
        const startOperation = dependencies.startProjectTargetOperation ?? ((_, start) => (
            start(undefined, new AbortController().signal).result
        ));
        return startOperation(target, (projectHandles, signal) => {
            const eventStream = dependencies.createEventStream(event);
            let streamClosed = false;
            let setupSettled = false;
            let closeSettled = false;
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

            const finish = () => {
                if (streamClosed) {
                    return;
                }
                streamClosed = true;
                unsubscribe?.();
                signal.removeEventListener("abort", finish);
                requestShutdownSignal?.removeEventListener("abort", finish);
                void eventStream.close().catch(() => undefined).finally(() => {
                    closeSettled = true;
                    settleIfClosed();
                });
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
            if (signal.aborted) {
                finish();
            } else {
                signal.addEventListener("abort", finish, {once: true});
            }
            if (requestShutdownSignal?.aborted) {
                finish();
            } else {
                requestShutdownSignal?.addEventListener("abort", finish, {once: true});
            }

            const result = (async () => {
                try {
                    if (!streamClosed) {
                        const indexOptions = dependencies.workspaceTreeIndexOptionsForTarget
                            ? dependencies.workspaceTreeIndexOptionsForTarget(target, projectHandles?.fileIndex)
                            : workspaceTreeIndexOptionsForTarget(target, projectHandles?.fileIndex);
                        unsubscribe = await dependencies.subscribeWorkspaceTreeIndex(indexOptions, async (payload) => {
                            await pushWorkspaceEvent(payload);
                        });
                        if (streamClosed) {
                            unsubscribe();
                        }
                    }
                    return await eventStream.send();
                } catch (error) {
                    finish();
                    throw error;
                } finally {
                    setupSettled = true;
                    settleIfClosed();
                }
            })();
            return {result, completion};
        });
    };
}

/**
 * 订阅当前小说 workspace 的文件系统变化。
 */
export default defineEventHandler(createWorkspaceFileEventsHandler());
