import {expect, it} from "bun:test";

import {runContributionPointExample} from "./03-contribution-point";

it("示例 3：通过校验的贡献交给接收者并可执行；不合格的那条被拒、原因可查；停止时恰好撤回一次", async () => {
    expect(await runContributionPointExample()).toEqual({
        titles: ["打开文件"],
        ran: "已打开",
        rejected: {status: "rejected", reason: "invalid-declaration", detail: "菜单项要有标题"},
        log: ["撤回 file.open"],
    });
});
