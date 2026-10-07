/**
 * 链路：两个节点之间的传输，由宿主提供（客户端与服务端之间是 WebSocket，服务端与项目子进程之间是
 * 进程间通信）。链路只搬运帧，不解释内容；帧的结构由收到它的一端用 `parseFrame` 核对。
 */

import type {Frame} from "./protocol";

export interface RemoteLink {
    /**
     * 发送一帧。帧无法编码（含不能序列化的值）时同步抛错，`Peer` 据此把这一个请求、结果或事件结算为
     * 结构化失败；链路已关闭时丢弃、不抛错，关闭由 `onClose` 通知。
     */
    send(frame: Frame): void;
    /** 收到对端发来的值；返回取消监听的函数。 */
    onFrame(listener: (value: unknown) => void): () => void;
    /** 链路关闭（任一端 close 或传输断开）时调用一次。 */
    onClose(listener: () => void): () => void;
    /** 关闭链路；幂等。 */
    close(): void;
}
