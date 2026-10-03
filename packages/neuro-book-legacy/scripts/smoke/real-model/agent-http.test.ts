/**
 * 真实模型 Agent HTTP smoke：经 dev server 的正式 `/api/agent/sessions/**` 入口 create + invoke。
 *
 * dev server 不可达时该用例 skip（不自动拉起 dev server）；Provider 与模型由 dev server 环境提供。
 * 运行入口：`bun run test:real-model`。
 */

import {describe, expect, it} from "vitest";
import {runAgentHttpSmoke} from "nbook/scripts/smoke/agent-http";
import {probeRealModelDevServer, REAL_MODEL_SMOKE_BASE_URL} from "./support";

describe("真实模型：Agent HTTP smoke（dev server）", () => {
    it("dev server 可达时完成 create + invoke", async (context) => {
        if (!(await probeRealModelDevServer())) {
            context.skip(`dev server 不可达（${REAL_MODEL_SMOKE_BASE_URL}）；先启动 bun run dev 或设置 AGENT_HTTP_BASE_URL`);
        }

        const result = await runAgentHttpSmoke({baseUrl: REAL_MODEL_SMOKE_BASE_URL});
        expect(result.created.sessionId).toBeGreaterThan(0);
        expect(result.invoked.status).toBe("completed");
        expect(typeof result.invoked.invocationId).toBe("string");
        expect(result.invoked.invocationId.length).toBeGreaterThan(0);
        const summary = result.invoked.finalMessage?.trim() || result.invoked.reportResult?.result?.trim() || "";
        expect(summary.length).toBeGreaterThan(0);
    }, 180_000);
});
