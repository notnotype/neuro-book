import type {H3Event} from "h3";
import {parseEntityId} from "nbook/server/utils/novel-chapter";

/**
 * 读取 phaseId。
 */
export function requirePhaseId(event: H3Event): number {
    return parseEntityId("phaseId", event.context.params?.phaseId ?? "");
}

/**
 * 读取 threadId。
 */
export function requireStoryThreadId(event: H3Event): number {
    return parseEntityId("threadId", event.context.params?.threadId ?? "");
}

/**
 * 读取 sceneId。
 */
export function requireSceneId(event: H3Event): number {
    return parseEntityId("sceneId", event.context.params?.sceneId ?? "");
}

/**
 * 读取 plotId。
 */
export function requirePlotId(event: H3Event): number {
    return parseEntityId("plotId", event.context.params?.plotId ?? "");
}
