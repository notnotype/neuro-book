import {describe, expect, it} from "vitest";
import {RunKernelStageError, toRunKernelErrorInfo, withRunKernelPhase} from "nbook/server/agent/harness/run-kernel-error";

describe("run kernel error helpers", () => {
    it("withRunKernelPhase 会包装普通错误并保留 phase", async () => {
        await expect(withRunKernelPhase("ingest", async () => {
            throw new Error("ingest exploded");
        })).rejects.toMatchObject({
            name: "RunKernelStageError",
            phase: "ingest",
            message: "ingest exploded",
        });
    });

    it("withRunKernelPhase 不重复包装已有 stage error", async () => {
        const error = new RunKernelStageError("compaction", new Error("compact exploded"));

        await expect(withRunKernelPhase("ingest", async () => {
            throw error;
        })).rejects.toBe(error);
    });

    it("toRunKernelErrorInfo 优先使用 stage error 的 phase", () => {
        const error = new RunKernelStageError("compaction", new Error("compact exploded"));

        expect(toRunKernelErrorInfo(error, "model")).toEqual({
            message: "compact exploded",
            phase: "compaction",
        });
    });

    it("toRunKernelErrorInfo 会用 fallback phase 处理普通错误", () => {
        expect(toRunKernelErrorInfo(new Error("model exploded"), "model")).toEqual({
            message: "model exploded",
            phase: "model",
        });
    });
});
