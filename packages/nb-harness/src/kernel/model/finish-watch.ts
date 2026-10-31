/**
 * 观察一次请求的 SSE：chat completions 形状的流一直没给出非空的 `finish_reason`（搬自 master `finish-watch.ts`）。
 * 有的网关耗尽预算后直接送 `[DONE]` 收尾而不送结束原因，OMP 把它记成正常的 `stop`，半句话就成了“正常结束”；
 * 适配器据此改记成 `length`。Anthropic、Responses 等流的块里没有 `choices`，不受影响。
 */

export interface FinishWatch {
    observe(event: {readonly data: string}): void;
    readonly missing: boolean;
}

export function createFinishWatch(): FinishWatch {
    let sawChoices = false;
    let sawFinish = false;
    return {
        observe(event) {
            if (sawFinish || event.data === "" || event.data === "[DONE]") return;
            let parsed: unknown;
            try {
                parsed = JSON.parse(event.data);
            } catch {
                // 不是 JSON 的块（注释、心跳）与结束原因无关。
                return;
            }
            const chunk = parsed as {choices?: unknown; finish_reason?: unknown} | null;
            if (!Array.isArray(chunk?.choices)) return;
            sawChoices = true;
            // 结束原因通常在 choices[0]；个别网关把它放在带 usage 的末块顶层。字面量 "null" 是网关把 null 写成了字符串，不算。
            const reasons = [(chunk.choices[0] as {finish_reason?: unknown} | undefined)?.finish_reason, chunk.finish_reason];
            if (reasons.some((reason) => typeof reason === "string" && reason !== "" && reason.toLowerCase() !== "null")) sawFinish = true;
        },
        get missing() {
            return sawChoices && !sawFinish;
        },
    };
}
