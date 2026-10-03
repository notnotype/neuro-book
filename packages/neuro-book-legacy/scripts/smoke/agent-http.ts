/**
 * Agent HTTP smoke：经 dev server 的正式 `/api/agent/sessions/**` 入口创建 session 并 invoke。
 *
 * CLI（`bun run smoke:agent-http`）与真实模型测试（`test:real-model`）共用 `runAgentHttpSmoke`；
 * dev server 探活由调用方负责（CLI 直接失败，测试转为 skip）。
 */

import {randomUUID} from "node:crypto";
import type {InvokeAgentResult} from "nbook/shared/dto/agent-session.dto";

export const DEFAULT_AGENT_HTTP_BASE_URL = "http://localhost:3000";

export type AgentHttpSmokeResult = {
    created: {sessionId: number};
    invoked: InvokeAgentResult;
};

/** 执行一次 HTTP 冒烟；Provider、模型与 dev server 状态由环境提供。 */
export async function runAgentHttpSmoke(options: {baseUrl?: string} = {}): Promise<AgentHttpSmokeResult> {
    const baseUrl = options.baseUrl ?? process.env.AGENT_HTTP_BASE_URL ?? DEFAULT_AGENT_HTTP_BASE_URL;

    const created = await request(baseUrl, "/api/agent/sessions", {
        method: "POST",
        body: {
            profileKey: "leader.default",
            initial: {
                role: "http-smoke",
            },
        },
    }) as {sessionId?: number};
    if (typeof created?.sessionId !== "number") {
        throw new Error(`创建 session 响应缺少 sessionId：${JSON.stringify(created)}`);
    }

    const invoked = await request(baseUrl, `/api/agent/sessions/${String(created.sessionId)}/invocations`, {
        method: "POST",
        body: {
            mode: "prompt",
            clientMessageId: randomUUID(),
            message: {
                // 不要求工具调用：部分 profile 没有 report_result，工具指令会让模型转而提问并进入 waiting。
                text: "用一句中文回复：agent http smoke ok。不要调用任何工具。",
            },
        },
    }) as InvokeAgentResult;

    return {created: {sessionId: created.sessionId}, invoked};
}

async function main(): Promise<void> {
    const result = await runAgentHttpSmoke();
    console.log("# Agent HTTP Smoke");
    console.log(JSON.stringify(result.invoked, null, 2));
}

async function request(baseUrl: string, path: string, input: {
    method: "GET" | "POST";
    body?: unknown;
}): Promise<unknown> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: input.method,
        headers: input.body ? {"content-type": "application/json"} : undefined,
        body: input.body ? JSON.stringify(input.body) : undefined,
    });
    if (!response.ok) {
        throw new Error(`${input.method} ${path} failed: ${response.status} ${await response.text()}`);
    }
    return response.json();
}

if (import.meta.main) await main();
