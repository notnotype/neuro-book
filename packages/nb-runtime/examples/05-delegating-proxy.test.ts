import {expect, it} from "bun:test";

import {runDelegatingProxyExample} from "./05-delegating-proxy";

it("示例 5：经代理的写入在服务端看到的是原调用方插件、via 为代理；两个插件的数据互不可见", async () => {
    expect(await runDelegatingProxyExample()).toEqual({
        log: ["example.a 经 example.notes-proxy 写入", "example.b 经 example.notes-proxy 写入"],
        reads: {"example.a": {ok: true, value: ["A 的笔记"]}, "example.b": {ok: true, value: ["B 的笔记"]}},
    });
});
