/**
 * 一个打开的会话里视图记住的东西：已提交的轮的渲染结果，和开发检查用的上一次渲染。都不进日志，重开后重新算。
 *
 * 提交缓存按轮对象记：`core.history` 的已提交轮存在持久链表里，同一轮在各个叶子的状态里是同一个对象，回退与切分支
 * 照样命中。装配结果换了（Profile 哈希变了）整份作废（docs/specs/harness/profile.md 输出 10、11）。
 */

import {createHash} from "node:crypto";
import type {ConversationTurn, Message} from "../api/index.js";
import type {Assembly} from "../extension/assemble.js";

export class ViewCache {
    #assembly: Assembly | null = null;
    #commits = new WeakMap<ConversationTurn, readonly Message[]>();
    /** 开发检查：进行中这一轮上一次渲染的块键。 */
    lastTurn: {readonly turnId: string; readonly keys: readonly string[]} | null = null;

    commits(assembly: Assembly): WeakMap<ConversationTurn, readonly Message[]> {
        if (assembly !== this.#assembly) {
            this.#assembly = assembly;
            this.#commits = new WeakMap();
            this.lastTurn = null;
        }
        return this.#commits;
    }
}

/**
 * 消息按块展开成键：每条消息先一个角色键，再每块“来源 + 内容哈希”，再每个工具调用。
 * 前缀比较按键做，不比拼接后的字符串：相邻 user 消息由适配器合并，字符串前缀说明不了缓存能不能命中。
 */
export function blockKeys(messages: readonly Message[]): string[] {
    const keys: string[] = [];
    for (const message of messages) {
        keys.push(`role:${message.role}${message.role === "tool" ? `:${message.callId ?? ""}` : ""}`);
        for (const {origin, ...content} of message.content) keys.push(`${JSON.stringify(origin)}#${digest(content)}`);
        // 工具调用整个进键（id、工具、参数、服务商元数据）：改了参数也是改了发给服务商的前缀。
        for (const call of message.toolCalls ?? []) keys.push(`call:${digest(call)}`);
    }
    return keys;
}

function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("base64");
}

export function isPrefix(prefix: readonly string[], of: readonly string[]): boolean {
    if (prefix.length > of.length) return false;
    for (let index = 0; index < prefix.length; index += 1) if (prefix[index] !== of[index]) return false;
    return true;
}
