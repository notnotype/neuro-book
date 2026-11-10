/**
 * `write`（docs/specs/agent/builtin-tools.md 输出 9）：整份写入，自动建上级目录，不核对基线（照 code agent 的做法）。
 */

import {hashlineFormatHeader} from "@oh-my-pi/pi-natives";

import {failure, globalAddress} from "../files/index.js";
import type {SessionEditStores} from "./snapshot.js";
import type {KitToolDeclaration, KitToolImplementation} from "./types.js";

export const writeDeclaration = (pathParameter: string): KitToolDeclaration => ({
    description: "把内容整份写进一个资源地址：不存在就新建（上级目录自动建好），存在就覆盖。写完可以直接用结果里的行锚改。",
    parameters: {
        type: "object",
        properties: {
            path: {type: "string", description: pathParameter},
            content: {type: "string", description: "文件的全部内容"},
        },
        required: ["path", "content"],
    },
    version: "1",
    concurrency: "exclusive",
    effect: "write",
});

export function writeTool(stores: SessionEditStores): KitToolImplementation {
    return {
        subjects: (args) => [{kind: "path", access: "write", address: args.path as string}],
        create: (context, {files}) => {
            const held = stores.acquire(context.sessionId);
            return {
                dispose: () => held.release(),
                execute: async (args, call) => {
                    const expanded = globalAddress(files, args.path as string);
                    if (!expanded.ok) return expanded.failure;
                    const {address} = expanded;
                    const content = args.content as string;
                    const saved = await files.call(call).write(address, content, {expect: "any", createParents: true});
                    if (!saved.ok) return failure(saved);
                    const lines = content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
                    const located = await files.readPath(address, {signal: call.signal});
                    // 写已经成了；定位失败（例如刚被删）只是这次给不了行锚，下一次 `read` 会给。
                    if (!located.ok) return {text: `[${address}] 已写入，${String(lines)} 行`};
                    // 内容是模型自己给的，全部行都算看过。
                    const seen = lines === 0 ? [0] : Array.from({length: lines}, (_, index) => index + 1);
                    const tag = held.store.recordSnapshot(located.value.path, content, seen);
                    return {text: `${hashlineFormatHeader(address, tag)} 已写入，${String(lines)} 行`};
                },
            };
        },
    };
}
