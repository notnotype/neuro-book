/**
 * 测试里卡住一步再放行用的小工具：在某一步进行中发指令时，用它们停住那一步。
 */

import type {TestTool} from "./test-session.js";

/** `open()` 之后 `promise` 完成。 */
export function gate(): {readonly promise: Promise<void>; open(): void} {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return {promise, open};
}

/** 一个停住的工具：开始执行时 `started` 完成，`release()` 之后交回“工具完成”。 */
export function blockingTool(toolId = "lab.block"): {readonly tool: TestTool; readonly started: Promise<void>; release(): void} {
    const started = gate();
    const release = gate();
    const tool: TestTool = {id: toolId, execute: async () => {
        started.open();
        await release.promise;
        return "工具完成";
    }};
    return {tool, started: started.promise, release: () => release.open()};
}
