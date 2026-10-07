/**
 * 帧的 JSON 编解码：WebSocket 链路两端（浏览器、服务端、以后的 TUI）与进程内测试链路共用。
 *
 * `JSON.stringify` 会把一些值静默丢掉或改写（函数与 symbol 消失、`NaN` 变 `null`、`Date` 变字符串、
 * `Map` 变空对象），对端收到的就不是发送方以为的值。这里只放行 JSON 能如实表示的值，其余在编码时抛错，
 * `Peer` 据此把这一个请求、结果或事件结算为结构化失败（RemoteLink.send 的合同）。
 * 行为合同见 docs/specs/runtime/plugin-channel.md 的“WebSocket 传输与握手”第 1 条。
 */

import type {Frame} from "./protocol";

/** 帧里有 JSON 不能如实表示的值。消息只含键名与类型，不含值。 */
export class FrameEncodingError extends TypeError {
    constructor(message: string) {
        super(message);
        this.name = "FrameEncodingError";
    }
}

function describe(key: string): string {
    return key === "" ? "帧" : `字段 ${key}`;
}

/**
 * `JSON.stringify` 的 replacer 收到的 `value` 已经过 `toJSON`（`Date` 已是字符串），所以从 `this[key]`
 * 取原值判断。对象上的 `undefined` 属性按 JSON 的规则省略，与可选字段缺省同义；数组里的会变成 `null`，拒绝。
 */
function strictReplacer(this: unknown, key: string, value: unknown): unknown {
    const holder = this as Record<string, unknown>;
    const original = holder[key];
    switch (typeof original) {
        case "string":
        case "boolean":
            return value;
        case "number":
            if (!Number.isFinite(original)) {
                throw new FrameEncodingError(`${describe(key)} 是非有限数，JSON 不能表示`);
            }
            return value;
        case "undefined":
            if (Array.isArray(holder)) {
                throw new FrameEncodingError(`数组元素 ${key} 是 undefined，JSON 会改写为 null`);
            }
            return undefined;
        case "object": {
            if (original === null || Array.isArray(original)) {
                return value;
            }
            const prototype: unknown = Object.getPrototypeOf(original);
            if (prototype !== Object.prototype && prototype !== null) {
                const name = (original as {constructor?: {name?: unknown}}).constructor?.name;
                throw new FrameEncodingError(`${describe(key)} 不是普通对象（${typeof name === "string" ? name : "未知类型"}），JSON 不能如实表示`);
            }
            return value;
        }
        default:
            throw new FrameEncodingError(`${describe(key)} 是 ${typeof original}，JSON 不能表示`);
    }
}

/** 编码一帧；有 JSON 不能如实表示的值（含循环引用）时同步抛错。 */
export function encodeJsonFrame(frame: Frame): string {
    return JSON.stringify(frame, strictReplacer);
}

/**
 * 按同一规则编码一个业务值：要把值经链路发出、或落盘后要能原样读回的插件用它（例如 Storage 的记录值）。
 * 值本身是 `undefined` 时同样抛错。
 */
export function encodeJsonValue(value: unknown): string {
    const text: string | undefined = JSON.stringify(value, strictReplacer);
    if (text === undefined) {
        throw new FrameEncodingError("值是 undefined，JSON 不能表示");
    }
    return text;
}

/** 解码一条文本消息；不是合法 JSON 时原样返回，由 `parseFrame` 判为无效帧。 */
export function decodeJsonFrame(text: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        // 无效 JSON 不在这里报告：交给帧解析统一按无效帧处理（路由关闭链路并记诊断）。
        return text;
    }
}
