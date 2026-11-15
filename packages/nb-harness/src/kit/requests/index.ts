/**
 * `@notnotype/nb-harness/kit/requests`：模型请求记录（docs/specs/agent/request-trace.md）。宿主建一个记录器、把模型端口
 * 包进 `traceModelPort`，再经自己的远程层把读的那几个方法交给界面。
 *
 * 尚未稳定：形状随查看器的切片还会变，下次发布不必一起出。
 */

export {RequestRecorder, RequestTraceUnavailable} from "./recorder.js";
export type {RequestHandle, RequestRecorderOptions, RequestTraceSettings, TracedCallMeta} from "./recorder.js";
export {traceModelPort} from "./port.js";
export {PREVIEW_CHARS} from "./outline.js";
export {MASK} from "./sanitize.js";
export type * from "./types.js";
