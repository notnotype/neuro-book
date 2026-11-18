/**
 * 拿到桌面锁之后，状态根上的服务端实例怎么办（docs/specs/runtime/desktop-shell.md 输出 4）。判定与 `nbook start` 相同
 * （docs/specs/runtime/cli.md 的“状态与转换”）：没有就自己拉起；同版本的产品实例就绪了就连它；在启动或停止就等；
 * 其余都不碰它、说明原因。
 */

import type {InstanceInfo, InstanceQuery} from "../server/instance";

export type ConnectDecision =
    | {readonly kind: "spawn"}
    | {readonly kind: "connect"; readonly url: string; readonly instance: InstanceInfo}
    | {readonly kind: "wait"; readonly status: "starting" | "stopping"; readonly instance: InstanceInfo}
    | {readonly kind: "refuse"; readonly reason: "version-mismatch"; readonly running: string; readonly installed: string; readonly instance: InstanceInfo}
    | {readonly kind: "refuse"; readonly reason: "not-product"; readonly instance: InstanceInfo}
    | {readonly kind: "refuse"; readonly reason: "unresponsive"; readonly detail: string};

export function decideConnection(found: InstanceQuery, version: string): ConnectDecision {
    if (found.state === "none") return {kind: "spawn"};
    if (found.state === "unresponsive") return {kind: "refuse", reason: "unresponsive", detail: found.detail};
    const instance = found.instance;
    if (instance.kind !== "product") return {kind: "refuse", reason: "not-product", instance};
    if (instance.version !== version) return {kind: "refuse", reason: "version-mismatch", running: instance.version, installed: version, instance};
    if (instance.status === "ready" && instance.url !== null) return {kind: "connect", url: instance.url, instance};
    // 就绪了却没有页面地址只会是开发会话的后端，上面已按种类拒绝；这里剩下启动中与停止中。
    return {kind: "wait", status: instance.status === "stopping" ? "stopping" : "starting", instance};
}
