import {expect, it} from "bun:test";

import {runRemoteServiceExample} from "./04-remote-service";

it("示例 4：提供方在第一次远程调用时才激活；提供方看到调用方的插件与实例；订阅收到每次变化；不合合同的输入为 invalid-input", async () => {
    const {log, results, seen} = await runRemoteServiceExample();

    expect(log).toEqual(["两个实例都已启动", "counter 激活", "example.panel@window-1 加了 2", "example.panel@window-1 加了 3"]);
    expect(results).toEqual([
        {ok: true, value: 2},
        {ok: true, value: 5},
        {ok: true, value: 5},
        expect.objectContaining({ok: false, code: "invalid-input"}),
    ]);
    expect(seen).toEqual([2, 5]);
});
