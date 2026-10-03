import {describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

describe("waitUntil", () => {
    it("条件成立时返回条件的值", async () => {
        let checks = 0;
        const value = await waitUntil("第三次检查成立", () => (++checks >= 3 ? `第 ${String(checks)} 次` : null), {intervalMs: 1});
        expect(value).toBe("第 3 次");
    });

    it("超时时抛错，消息带上等待的内容", async () => {
        await expect(waitUntil("永远不成立的条件", () => false, {timeoutMs: 20, intervalMs: 5})).rejects.toThrow("永远不成立的条件");
    });
});
