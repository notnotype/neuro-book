import {expect, it} from "bun:test";

import {runPerConsumerExample} from "./02-per-consumer";

it("示例 2：两个插件各拿到自己的门面、只看到自己的数据；停止时各自的门面释放，之后再用门面抛 ServiceRevokedError", async () => {
    expect(await runPerConsumerExample()).toEqual({
        reads: {"example.a": ["A 的笔记"], "example.b": ["B 的笔记"]},
        released: ["example.a", "example.b"],
        revokedAfterStop: true,
    });
});
