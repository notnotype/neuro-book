/**
 * 测试用的链路观察：包住窗口一端的链路，记下窗口发出的请求，并能扣住某个请求的回复、晚些再交付。只推迟真实回复的
 * 交付，不改内容、不伪造回复。用途有两个：证明“某段时间里没有发出某类请求”（同字节保存之类的写入在磁盘字节上看不出
 * 来），以及制造“回复到达之前已经发生了别的事”的时序（列出在途时外部新建、批量在途时刷新）。只由测试使用。
 */

import type {Frame, RemoteLink, RequestFrame} from "@notnotype/nb-runtime/remote";

/** 窗口发出的一次请求。 */
export interface TappedRequest {
    readonly contract: string;
    readonly method: string;
    readonly effect: "read" | "write";
    readonly input: unknown;
}

export interface HeldReply {
    /** 被扣住的回复已经到了窗口这一端。 */
    readonly arrived: Promise<void>;
    /** 交付被扣住的回复（还没到时，到了立即交付）；幂等。 */
    release(): void;
}

export interface LinkTap {
    /** 交给 `filesScene` / `settingsWorld` 的 `wrapLink`。 */
    readonly wrap: (link: RemoteLink) => RemoteLink;
    /** 至今窗口发出的全部请求，按发出顺序。 */
    readonly requests: ReadonlyArray<TappedRequest>;
    /** 扣住此后第一个满足条件的请求的回复（ACK 照常交付）。 */
    hold(match: (request: TappedRequest) => boolean): HeldReply;
    /**
     * 推迟此后第一个满足条件的、窗口要发出的帧（例如订阅）；`arrived` 表示窗口已经要发它，`release` 才真正发出。用来
     * 制造“订阅建立之前已经发生了变化”。
     */
    holdSend(match: (frame: Frame) => boolean): HeldReply;
}

interface Hold {
    readonly match: (request: TappedRequest) => boolean;
    id: string | null;
    released: boolean;
    readonly queued: Array<() => void>;
    readonly arrive: () => void;
}

export function createLinkTap(): LinkTap {
    const requests: TappedRequest[] = [];
    const holds: Hold[] = [];
    const sends: Array<{readonly match: (frame: Frame) => boolean; taken: boolean; released: boolean; readonly queued: Array<() => void>; readonly arrive: () => void}> = [];
    const heldFor = (value: unknown): Hold | null => {
        if (typeof value !== "object" || value === null || (value as Frame).type !== "result") return null;
        const id = (value as Extract<Frame, {type: "result"}>).id;
        return holds.find((hold) => hold.id === id && !hold.released) ?? null;
    };
    return {
        requests,
        wrap: (link) => ({
            send: (frame) => {
                if (frame.type === "request") {
                    const request = toRequest(frame);
                    requests.push(request);
                    const hold = holds.find((candidate) => candidate.id === null && candidate.match(request));
                    if (hold !== undefined) hold.id = frame.id;
                }
                const delayed = sends.find((candidate) => !candidate.taken && candidate.match(frame));
                if (delayed === undefined) {
                    link.send(frame);
                    return;
                }
                delayed.taken = true;
                delayed.queued.push(() => link.send(frame));
                delayed.arrive();
                if (delayed.released) for (const send of delayed.queued.splice(0)) send();
            },
            onFrame: (listener) => link.onFrame((value) => {
                const hold = heldFor(value);
                if (hold === null) {
                    listener(value);
                    return;
                }
                hold.queued.push(() => listener(value));
                hold.arrive();
            }),
            onClose: (listener) => link.onClose(listener),
            close: () => link.close(),
        }),
        hold: (match) => {
            let arrive = (): void => undefined;
            const arrived = new Promise<void>((resolve) => {
                arrive = resolve;
            });
            const hold: Hold = {match, id: null, released: false, queued: [], arrive};
            holds.push(hold);
            return {
                arrived,
                release: () => {
                    if (hold.released) return;
                    hold.released = true;
                    for (const deliver of hold.queued.splice(0)) deliver();
                },
            };
        },
        holdSend: (match) => {
            let arrive = (): void => undefined;
            const arrived = new Promise<void>((resolve) => {
                arrive = resolve;
            });
            const delayed = {match, taken: false, released: false, queued: [] as Array<() => void>, arrive};
            sends.push(delayed);
            return {
                arrived,
                release: () => {
                    if (delayed.released) return;
                    delayed.released = true;
                    for (const send of delayed.queued.splice(0)) send();
                },
            };
        },
    };
}

function toRequest(frame: RequestFrame): TappedRequest {
    return {contract: frame.contract, method: frame.method, effect: frame.effect, input: frame.input};
}

/** 窗口发给 Files 的写请求。 */
export function filesWrites(requests: ReadonlyArray<TappedRequest>): TappedRequest[] {
    return requests.filter((request) => request.contract.startsWith("nbook.files/") && request.effect === "write");
}
