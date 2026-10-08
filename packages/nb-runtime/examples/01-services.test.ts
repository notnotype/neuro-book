import {expect, it} from "bun:test";

import {runServicesExample} from "./01-services";

it("示例 1：依赖先激活；停止时依赖者先释放，提供者的服务实例后释放", async () => {
    expect(await runServicesExample()).toEqual({
        log: ["clock 激活", "greeter 激活：现在是 09:00", "greeter 释放", "clock 释放"],
        startup: "available",
        stop: "closed",
    });
});
