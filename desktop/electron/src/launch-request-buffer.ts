import {
    parseDesktopLaunchRequest,
    type DesktopLaunchRequest,
} from "nbook/shared/desktop-contract";

/** 在启动页、导航和 Vue 订阅之间保存有限数量的外部启动请求。 */
export class DesktopLaunchRequestBuffer {
    readonly #capacity: number;
    readonly #pending: DesktopLaunchRequest[] = [];

    constructor(capacity = 16) {
        if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 64) {
            throw new Error("Desktop launch request buffer capacity 必须是 1-64 的整数。");
        }
        this.#capacity = capacity;
    }

    push(value: unknown): DesktopLaunchRequest {
        const request = parseDesktopLaunchRequest(value);
        if (this.#pending.length === this.#capacity) this.#pending.shift();
        this.#pending.push(request);
        return request;
    }

    drain(): DesktopLaunchRequest[] {
        return this.#pending.splice(0);
    }
}
