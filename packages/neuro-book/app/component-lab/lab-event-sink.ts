import {inject, type InjectionKey} from "vue";

/**
 * fixture 把被检视组件发出的事件转交给 Lab 的通道。
 *
 * 用 provide/inject 而不是让 fixture 往上 emit：fixture 是 Lab 动态挂载的，
 * Lab 不静态知道它会 emit 什么，逐个声明转发事件等于把事件名抄第二遍。
 */
export type LabEventSink = (name: string, payload?: unknown) => void;

export const LAB_EVENT_SINK: InjectionKey<LabEventSink> = Symbol("lab-event-sink");
export type LabDataSink = (value: unknown) => void;

export const LAB_DATA_SINK: InjectionKey<LabDataSink> = Symbol("lab-data-sink");

/** fixture 可把当前受控状态同步到 Lab 的数据面板。 */
export function useLabDataSink(): LabDataSink {
    return inject(LAB_DATA_SINK, () => undefined);
}

/** fixture 之外的地方调用会拿到一个什么都不做的 sink，因此 fixture 单独渲染也不报错。 */
export function useLabEventSink(): LabEventSink {
    return inject(LAB_EVENT_SINK, () => undefined);
}
