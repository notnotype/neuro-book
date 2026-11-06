/**
 * 落点登记（docs/specs/ui/layout-drag.md 输出 16）：一个插件的来源落到另一个插件的元素上时，经这里查，不读对方的 DOM 标记。
 * 登记按元素存，不经 provide，也不需要工作台在场，所以 Lab 里单独挂编辑器区也能用。前提是同一页面只有一份 nb-layout，见
 * Spec 的“边界与兼容”。
 */

import {watch} from "vue";
import type {Ref} from "vue";

import type {DropKind} from "../drag-gesture";

interface Registration {
    readonly kinds: ReadonlySet<string>;
    readonly data: () => unknown;
}

const registrations = new WeakMap<Element, Registration[]>();

/** 登记一个落点，返回注销函数。种类按 `id` 比较：热更新重新求值定义种类的模块后，已登记的元素仍然查得到。 */
export function registerDropTarget<T>(element: Element, kinds: ReadonlyArray<DropKind<T>>, data: () => T): () => void {
    const registration: Registration = {kinds: new Set(kinds.map((kind) => kind.id)), data};
    registrations.set(element, [...(registrations.get(element) ?? []), registration]);
    return () => {
        const rest = (registrations.get(element) ?? []).filter((candidate) => candidate !== registration);
        if (rest.length === 0) registrations.delete(element);
        else registrations.set(element, rest);
    };
}

/** 组件里登记：元素出现时登记，换元素或组件卸载时注销。 */
export function useDropTarget<T>(element: Readonly<Ref<Element | null>>, kinds: ReadonlyArray<DropKind<T>>, data: () => T): void {
    watch(element, (current, _previous, onCleanup) => {
        if (current !== null) onCleanup(registerDropTarget(current, kinds, data));
    }, {immediate: true, flush: "post"});
}

/**
 * 从 `top` 往上找最近的、登记了这个种类的元素。内层登记了别的种类不挡外层。`top` 来自会话的遮挡判定，被菜单或对话框挡住时
 * 它就在浮层里，往上找不到登记的元素。
 */
export function dropTargetAt<T>(top: Element | null, kind: DropKind<T>): {readonly element: Element; readonly data: T} | null {
    for (let element = top; element !== null; element = element.parentElement) {
        const found = registrations.get(element)?.find((registration) => registration.kinds.has(kind.id));
        // 同一个种类的数据类型由 `registerDropTarget` 的签名保证。
        if (found !== undefined) return {element, data: found.data() as T};
    }
    return null;
}
