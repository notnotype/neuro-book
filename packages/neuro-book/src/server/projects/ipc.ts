/**
 * 服务端与项目子进程之间的进程间通信（Bun IPC，`serialization: "json"`），父子两侧共用。
 *
 * 一条通道上走两类消息：远程服务的帧（`frame`，内容是内核 JSON 编码后的文本，IPC 只搬运字符串，三种链路的
 * 编码语义因此一致），以及宿主之间的控制消息（`plugins`、`started`、`stop`、`work-query`、`work`），后者不进入链路。
 * 行为合同见 docs/specs/runtime/plugin-channel.md 的“进程间链路”。
 */

import {Type} from "typebox";
import {Value} from "typebox/value";

import {createSocketLink} from "@notnotype/nb-host/socket";
import type {SocketLink} from "@notnotype/nb-host/socket";

import {InstalledPluginSchema} from "nbook/plugin-platform/backend/installed";
import type {InstalledPlugin} from "nbook/plugin-platform/backend/installed";
import {RunningWorkCollectionSchema} from "nbook/server/running-work";
import type {RunningWorkCollection} from "nbook/server/running-work";

export type ProjectEnvelope =
    | {readonly t: "frame"; readonly d: string}
    /**
     * 服务端起子进程后发的第一条消息：服务端本次启动登记的第三方插件（docs/specs/runtime/plugin-install.md），带清单、安装目录
     * 与内容摘要。子进程等到它才装配插件，不自己读登记表，也不自己算摘要；不放环境变量：清单可以很大，单个环境字符串有长度上限。
     */
    | {readonly t: "plugins"; readonly installed: ReadonlyArray<InstalledPlugin>}
    /** 项目宿主的启动结果：运行实例可用之后才报 `available`，不报半就绪。 */
    | {readonly t: "started"; readonly status: "available"}
    | {readonly t: "started"; readonly status: "failed"; readonly detail: string}
    /** 服务端请求项目宿主按停止序列停止。 */
    | {readonly t: "stop"}
    /**
     * 服务端问项目实例此刻在跑的工作（docs/specs/runtime/server-host.md 的“在跑的工作”）；`id` 由服务端给，应答带回同一个，
     * 服务端据此丢掉已经超时的那次的迟到应答。宿主自己的事，不经插件的远程合同。
     */
    | {readonly t: "work-query"; readonly id: number}
    /** 项目宿主对 `work-query` 的应答。 */
    | ({readonly t: "work"; readonly id: number} & RunningWorkCollection);

const InstalledListSchema = Type.Array(InstalledPluginSchema);

function isQueryId(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value);
}

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
        case "plugins": {
            const installed = (value as {readonly installed?: unknown}).installed;
            return Value.Check(InstalledListSchema, installed) ? {t: "plugins", installed} : null;
        }
        case "work-query": {
            const id = (value as {readonly id?: unknown}).id;
            return isQueryId(id) ? {t: "work-query", id} : null;
        }
        case "work": {
            const {id, items, failed} = value as {readonly id?: unknown; readonly items?: unknown; readonly failed?: unknown};
            const collection = {items, failed};
            return isQueryId(id) && Value.Check(RunningWorkCollectionSchema, collection) ? {t: "work", id, ...collection} : null;
        }
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
