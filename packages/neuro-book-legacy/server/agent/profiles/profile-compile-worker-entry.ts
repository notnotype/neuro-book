import {parentPort} from "node:worker_threads";
import {runProfileCompile, runProfileCompileAll, runProfileCompileEntry} from "./profile-compile-worker-runtime";
import type {
    AgentProfileCompileAllRequestDto,
    AgentProfileCompileRequestDto,
} from "nbook/shared/dto/agent-profile.dto";

type WorkerRequest = {
    id: number;
    mode?: "single" | "all" | "entry";
    input: (AgentProfileCompileRequestDto | AgentProfileCompileAllRequestDto) & {
        profileRoot?: string;
        profileRootLabel?: string;
        runtimePaths?: import("nbook/server/runtime/paths/runtime-paths").RuntimePaths;
    };
};

if (!parentPort) {
    throw new Error("profile compile worker 必须运行在 worker_threads 中。");
}

parentPort.on("message", async (message: WorkerRequest) => {
    const result = message.mode === "all"
        ? await runProfileCompileAll(message.input)
        : message.mode === "entry"
            ? await runProfileCompileEntry(message.input as AgentProfileCompileRequestDto)
            : await runProfileCompile({...message.input as AgentProfileCompileRequestDto, deferPreview: true});
    parentPort!.postMessage({
        id: message.id,
        result,
    });
});
