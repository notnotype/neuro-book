/**
 * 真实模型 Harness 直连 smoke：创建 leader.default 会话 → 真实 provider 一轮 invocation → JSONL 落盘。
 *
 * 缺 `DEEPSEEK_API_KEY` 时整组 skip（证据中记为「未验证」，不得写成通过）。
 * 运行入口：`bun run test:real-model`。
 */

import {beforeAll, describe, expect, it} from "vitest";
import {
    createAgentSmokeHarness,
    resolveAgentSmokeModelSetup,
    resolveAgentSmokeWorkspaceRoot,
    runAgentSmoke,
} from "nbook/scripts/smoke/agent";
import {resolveRealModelCredentials, writeRealModelGlobalConfig} from "./support";

const credentials = resolveRealModelCredentials();

describe.skipIf(!credentials)("真实模型：Harness 直连 smoke", () => {
    beforeAll(async () => {
        await writeRealModelGlobalConfig(credentials!);
    });

    it("真实 provider 完成一轮 invocation 并落盘 session", async () => {
        const setup = resolveAgentSmokeModelSetup();
        const report = await runAgentSmoke({
            workspaceRoot: resolveAgentSmokeWorkspaceRoot(),
            modelLabel: `${setup.model.provider}/${setup.model.id}`,
            createHarness: (workspaceRoot) => createAgentSmokeHarness(workspaceRoot, setup),
        });

        expect(report.status).toBe("completed");
        expect(report.ok).toBe(true);
    }, 120_000);
});
