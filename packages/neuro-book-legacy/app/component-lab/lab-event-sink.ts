import {inject, type InjectionKey} from "vue";

/**
 * fixture 把被检视组件发出的事件转交给 Lab 的通道。
 *
 * 用 provide/inject 而不是让 fixture 往上 emit：fixture 是 Lab 动态挂载的，
 * Lab 不静态知道它会 emit 什么，逐个声明转发事件等于把事件名抄第二遍。
 */
export type LabEventSink = (name: string, payload?: unknown) => void;

export const LAB_EVENT_SINK: InjectionKey<LabEventSink> = Symbol("lab-event-sink");

/** fixture 上报被测组件的内部状态（`state:local` 的可观察快照）。只读展示，不回流给 fixture。 */
export type LabDataSink = (value: unknown) => void;

export const LAB_DATA_SINK: InjectionKey<LabDataSink> = Symbol("lab-data-sink");

/** 分层输入的回写：组件发出 `update:x`，或 fixture 扮演宿主改值时，由 Lab 写回当前场景输入。 */
export type LabInputSink = (layer: "props" | "model", key: string, value: unknown) => void;

export const LAB_INPUT_SINK: InjectionKey<LabInputSink> = Symbol("lab-input-sink");

export type LabControlsRegister = (active: boolean) => void;

export const LAB_CONTROLS_REGISTER: InjectionKey<LabControlsRegister> = Symbol("lab-controls-register");

/** fixture 上报内部状态；不在 Lab 里时是空操作。 */
export function useLabDataSink(): LabDataSink {
    return inject(LAB_DATA_SINK, () => undefined);
}

/** fixture 之外的地方调用会拿到一个什么都不做的 sink，因此 fixture 单独渲染也不报错。 */
export function useLabEventSink(): LabEventSink {
    return inject(LAB_EVENT_SINK, () => undefined);
}

/** fixture 挂载交互调试控制实体时通知 Lab 展开底部控制栏。 */
export function useLabControlsRegister(): LabControlsRegister {
    return inject(LAB_CONTROLS_REGISTER, () => undefined);
}
