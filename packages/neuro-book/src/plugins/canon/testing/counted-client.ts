/**
 * 数一个世界客户端发了哪些读取：界面的测试用它量“一次别处的发布引起几次读取”（docs/specs/canon/author-ui.md 输出 26）。
 * 只包一层、原样转发，不改结果。只由测试使用，不含断言。
 */

import type {CanonClient, CanonMethod} from "../shared/contracts";

export interface CountedClient {
    readonly client: CanonClient;
    /** 发过的读取，按先后：方法与输入。 */
    readonly calls: Array<{readonly method: CanonMethod; readonly input: unknown}>;
}

export function countedClient(client: CanonClient): CountedClient {
    const calls: Array<{readonly method: CanonMethod; readonly input: unknown}> = [];
    return {
        calls,
        client: {
            call: (method, input) => {
                calls.push({method, input});
                return client.call(method, input);
            },
            publish: (request, token) => client.publish(request, token),
            subscribe: (listener) => client.subscribe(listener),
            hold: (label, onEnded) => client.hold(label, onEnded),
        },
    };
}
