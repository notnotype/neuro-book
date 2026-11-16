/**
 * 桌面锁与开窗转交（docs/specs/runtime/desktop-shell.md 输出 1 到 3）。锁就是状态根上的另一种认领（nb-host 的状态根认领，
 * 套接字名 `desktop`，Windows 命名管道前缀 `nbook-desktop`），与服务端的认领互不相干。锁上除了 `hello` 只收 `open-window`：
 * 处理器同步决定并同步开窗，应答说的就是已经发生的事。
 */

import {claimStateRoot, defineClaimProfile, queryInstance, sendRequest} from "@notnotype/nb-host/server";
import type {ClaimProfile, ClaimResult} from "@notnotype/nb-host/server";

import {PRODUCT_VERSION} from "../shared/product";

/** 锁上一条消息的上限（输出 2）。 */
const DESKTOP_MESSAGE_LIMIT = 64 * 1024;

function desktopProfile(version: string): ClaimProfile<Record<string, never>> {
    return defineClaimProfile({socketPrefix: "nbook-desktop", socketName: "desktop", messageLimit: DESKTOP_MESSAGE_LIMIT, version, fields: {}});
}

const DESKTOP_CLAIM = desktopProfile(PRODUCT_VERSION);

/** `open-window` 的应答（输出 2）。 */
export type OpenWindowReply = {readonly ok: true} | {readonly ok: false; readonly code: "closing" | "stopping"};

export interface DesktopLockOptions {
    readonly stateRoot: string;
    /** 收到 `open-window` 时同步调用：在里面开窗（或说明为什么不开），交回应答。 */
    readonly onOpenWindow: () => OpenWindowReply;
    readonly report: (event: string, error: unknown) => void;
    /** 缺省是本产品的版本；只有测试给别的值（模拟版本不同的壳）。 */
    readonly version?: string;
}

export function acquireDesktopLock(options: DesktopLockOptions): Promise<ClaimResult<Record<string, never>>> {
    return claimStateRoot({
        stateRoot: options.stateRoot,
        kind: "product",
        profile: options.version === undefined ? DESKTOP_CLAIM : desktopProfile(options.version),
        report: options.report,
        requests: {"open-window": () => options.onOpenWindow()},
        unknownReply: {ok: false, code: "unknown-request"},
    });
}

/** 锁被别的壳持有时，问它一次、交回下一步（输出 3）。循环与截止由调用方定。 */
export type RunningShellAnswer =
    /** 锁已经放下（那边退出了）：回去取锁。 */
    | {readonly kind: "lock-free"}
    /** 那边开了窗：自己退出。 */
    | {readonly kind: "handed-off"}
    /** 那边在确认最后一次关闭：每秒再问。 */
    | {readonly kind: "closing"}
    /** 那边在停止：等它放下锁。 */
    | {readonly kind: "stopping"}
    | {readonly kind: "version-mismatch"; readonly running: string}
    | {readonly kind: "unresponsive"; readonly detail: string};

export async function askRunningShell(stateRoot: string, version: string = PRODUCT_VERSION): Promise<RunningShellAnswer> {
    const found = await queryInstance(stateRoot, DESKTOP_CLAIM);
    if (found.state === "none") return {kind: "lock-free"};
    if (found.state === "unresponsive") return {kind: "unresponsive", detail: found.detail};
    if (found.instance.version !== version) return {kind: "version-mismatch", running: found.instance.version};
    if (found.instance.status === "stopping") return {kind: "stopping"};
    const sent = await sendRequest(stateRoot, DESKTOP_CLAIM, {type: "open-window"});
    if (sent.state === "none") return {kind: "lock-free"};
    if (sent.state === "unresponsive") return {kind: "unresponsive", detail: sent.detail};
    const reply = sent.reply;
    if (typeof reply === "object" && reply !== null && "ok" in reply) {
        if (reply.ok === true) return {kind: "handed-off"};
        if ("code" in reply && reply.code === "closing") return {kind: "closing"};
        if ("code" in reply && reply.code === "stopping") return {kind: "stopping"};
    }
    return {kind: "unresponsive", detail: `open-window 的应答无法识别：${JSON.stringify(reply)}`};
}
