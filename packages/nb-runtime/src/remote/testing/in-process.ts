/**
 * 进程内链路对：两端在同一进程里互发帧。投递经与 WebSocket 链路相同的 JSON 编解码，并放到微任务里，
 * 使测试与组合验证观察到的行为和真实传输一致：不共享对象引用、不同步回调；JSON 不能如实表示的值在发送时抛错。
 * 真实断线与刷新的时序由真实传输（WebSocket、进程间通信）验证，这里只模拟“关闭”。
 */

import {decodeJsonFrame, encodeJsonFrame} from "../json-codec";
import type {Frame} from "../protocol";
import type {RemoteLink} from "../transport";

export interface LinkPair {
    readonly left: RemoteLink;
    readonly right: RemoteLink;
}

export function createLinkPair(): LinkPair {
    let closed = false;
    const frameListeners: [Set<(value: unknown) => void>, Set<(value: unknown) => void>] = [new Set(), new Set()];
    const closeListeners: [Set<() => void>, Set<() => void>] = [new Set(), new Set()];
    const close = (): void => {
        if (closed) {
            return;
        }
        closed = true;
        queueMicrotask(() => {
            for (const listeners of closeListeners) {
                for (const listener of [...listeners]) {
                    listener();
                }
                listeners.clear();
            }
        });
    };
    const end = (side: 0 | 1): RemoteLink => ({
        send(frame: Frame): void {
            if (closed) {
                return;
            }
            const text = encodeJsonFrame(frame);
            // 关闭前发出的帧照常送达、先于关闭通知（关闭的通知排在它之后的微任务里），与 WebSocket 先送完
            // 消息再关闭一致：路由回完拒绝帧立即关闭链路时，对端仍要读到拒绝原因。
            queueMicrotask(() => {
                for (const listener of [...frameListeners[side === 0 ? 1 : 0]]) {
                    listener(decodeJsonFrame(text));
                }
            });
        },
        onFrame(listener) {
            frameListeners[side].add(listener);
            return () => frameListeners[side].delete(listener);
        },
        onClose(listener) {
            if (closed) {
                queueMicrotask(listener);
                return () => undefined;
            }
            closeListeners[side].add(listener);
            return () => closeListeners[side].delete(listener);
        },
        close,
    });
    return {left: end(0), right: end(1)};
}
