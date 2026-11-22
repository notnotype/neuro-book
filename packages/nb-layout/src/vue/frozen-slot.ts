/**
 * 停在最后一次渲染的插槽（docs/specs/ui/nested-grid.md 输出 155、156）：`frozen` 为真时不再调宿主的插槽，返回上一次的结果。
 * 宿主已经去掉的内容项、离开的叶在过渡里还画着，宿主的数据可能已经没了，再调插槽就是拿没了的数据去渲染。
 *
 * 只冻插槽这一次调用：里面的组件自己读的响应式数据照常生效，组件按 key 去取已经删掉的数据时要自己容忍。
 *
 * 用 `withMemo`（`v-memo` 的运行时）而不是直接返回上一次的 VNode：已挂载的 VNode 再被返回时 Vue 会先克隆一份再往下修补，
 * 根上的组件可能重渲染；带 `memo` 的才被原样认出、整棵跳过。不冻结时每次换一个记号，照常渲染。
 */

import {Fragment, defineComponent, h, withMemo} from "vue";
import type {VNode} from "vue";

export const FrozenSlot = defineComponent({
    name: "NbFrozenSlot",
    props: {
        frozen: {type: Boolean, required: true},
    },
    setup(props, {slots}) {
        const cache: VNode[] = [];
        let token: object = {};
        return () => {
            if (!props.frozen) token = {};
            return withMemo([token], () => h(Fragment, slots.default?.() ?? []), cache, 0);
        };
    },
});
