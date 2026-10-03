import {PUBLIC_CLIENT_VARIABLE_PATCH_BYTES, PUBLIC_CONTROL_REASON_BYTES} from "nbook/server/agent/events/public-event-policy";
import {textPreview} from "nbook/server/agent/events/public-tool-projection";
import type {VariablePatchRequest} from "nbook/server/agent/variables/types";

/**
 * 拒绝无法安全进入公开事件队列的 client variable patch。
 *
 * 该控制请求必须原样送达并获得 ack，不能截断，也不能降级为 snapshot_required。
 */
export function assertPublicClientVariablePatch(request: VariablePatchRequest): void {
    const bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
    if (bytes > PUBLIC_CLIENT_VARIABLE_PATCH_BYTES) {
        throw new Error(`client_variable_patch_too_large: ${String(bytes)} bytes exceeds ${String(PUBLIC_CLIENT_VARIABLE_PATCH_BYTES)} bytes`);
    }
}

/** 把用户可读控制原因投影为有界公开预览；内部 lifecycle 可以继续保留完整原因。 */
export function projectPublicControlReason(reason: string | undefined): string | undefined {
    return reason === undefined ? undefined : textPreview(reason, PUBLIC_CONTROL_REASON_BYTES).preview;
}
