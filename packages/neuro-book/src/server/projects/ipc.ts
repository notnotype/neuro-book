/**
 * 服务端与项目子进程之间的进程间通信（Bun IPC，`serialization: "json"`），父子两侧共用。
 *
 * 一条通道上走两类消息：远程服务的帧（`frame`，内容是内核 JSON 编码后的文本，IPC 只搬运字符串，三种链路的
 * 编码语义因此一致），以及宿主之间的控制消息（`started`、`stop`），后者不进入链路。
 * 行为合同见 docs/specs/runtime/plugin-channel.md 的“进程间链路”。
 */

import {createSocketLink} from "nbook/shared/rpc-socket";
import type {SocketLink} from "nbook/shared/rpc-socket";

export type ProjectEnvelope =
    | {readonly t: "frame"; readonly d: string}
    /** 项目宿主的启动结果：运行实例可用之后才报 `available`，不报半就绪。 */
    | {readonly t: "started"; readonly status: "available"}
    | {readonly t: "started"; readonly status: "failed"; readonly detail: string}
    /** 服务端请求项目宿主按停止序列停止。 */
    | {readonly t: "stop"};

/** 收到的消息不是约定的信封时为 null；调用方记诊断后丢弃。 */
export function parseEnvelope(value: unknown): ProjectEnvelope | null {
    if (typeof value !== "object" || value === null) return null;
    const envelope = value as {readonly t?: unknown; readonly d?: unknown; readonly status?: unknown; readonly detail?: unknown};
    switch (envelope.t) {
        case "frame":
            return typeof envelope.d === "string" ? {t: "frame", d: envelope.d} : null;
        case "started":
            if (envelope.status === "available") return {t: "started", status: "available"};
            return envelope.status === "failed" && typeof envelope.detail === "string" ? {t: "started", status: "failed", detail: envelope.detail} : null;
        case "stop":
            return {t: "stop"};
        default:
            return null;
    }
}

/** 一侧的 IPC 通道：发一条信封、断开通道。 */
export interface EnvelopeChannel {
    /** 通道已断开时抛错（Bun 的行为）；链路把它当作链路已关闭。 */
    send(envelope: ProjectEnvelope): void;
    disconnect(): void;
}

/**
 * 把 IPC 通道包成远程服务的链路。收到的 `frame` 信封由宿主经 `receive` 转入，通道断开时宿主调用 `closed`。
 * 关闭链路即断开通道：对子进程来说父进程已不在，它按停止序列退出。
 */
export function createEnvelopeLink(channel: EnvelopeChannel, onSendFailed: (error: unknown) => void): SocketLink {
    const link: SocketLink = createSocketLink({
        send: (text) => {
            try {
                channel.send({t: "frame", d: text});
            } catch (error) {
                // 通道在断开事件到达之前已断：这一帧发不出去，按链路已关闭处理，在途请求随之按断开结算。
                onSendFailed(error);
                link.closed();
            }
        },
        close: () => channel.disconnect(),
    });
    return link;
}
