/**
 * 停在最后一次渲染的插槽（docs/specs/ui/nested-grid.md 输出 155、156）：`frozen` 为真时不再调宿主的插槽，返回上一次的结果。
 * 宿主已经去掉的内容项、跟着它离开的叶在过渡里还画着，宿主的数据可能已经没了，再调插槽就是拿没了的数据去渲染。
 *
 * 只冻插槽这一次调用：里面的组件照常按自己的响应式依赖更新，交给子组件的插槽在子组件的渲染里调。那里面按 key 查宿主已删的数据会抛错，
 * 这时补一条说明原因的报错，原错误照常往上传（不吞掉）。连子组件一起冻住做不到：宿主在同一个同步段里删数据时，子组件的渲染任务已经排进队列，
 * 事后暂停它的 effect 拦不住（t53 的探针）。
 *
 * 依赖 Vue 3.5 的三个行为（升级 Vue 时核对，`NestedGrid.dom.test.ts` 里“插槽没再被调”的断言会先红）：
 * - 已挂载的 VNode 再被返回时先克隆再修补（`cloneIfMounted`），根上的组件可能重渲染，所以不能直接返回上一次的 VNode；
 * - 带 `memo` 的不克隆，`patch` 见到同一个 VNode 整棵跳过：`withMemo`（`v-memo` 的运行时）给结果打 `memo`；
 * - `withMemo` 的记号与上次相同时返回缓存的那一个。不冻结时每次换一个记号，照常渲染。
 *
 * 第一次渲染就是冻结的（缓存为空）时会调一次插槽：留着的项都来自上一帧、沿用同一个元素，不会发生。
 */

import {Fragment, defineComponent, h, onErrorCaptured, withMemo} from "vue";
import type {VNode} from "vue";

export const FrozenSlot = defineComponent({
    name: "NbFrozenSlot",
    props: {
        frozen: {type: Boolean, required: true},
        /** 报错里写的是哪一项（例如 `content detail-3`）。 */
        name: {type: String, required: true},
    },
    setup(props, {slots}) {
        const cache: VNode[] = [];
        let token: object = {};
        /** 这一次冻住期间报过了：一个过渡里同一项只补一条说明。 */
        let explained = false;
        onErrorCaptured((_error, _instance, info) => {
            // 只管渲染时抛的（开发构建里 info 是 "render function"，生产构建里是错误码链接，渲染是 1 号）；事件、watcher、定时器里的错误与删数据未必有关。
            if (props.frozen && !explained && (info === "render function" || info.endsWith("#runtime-1"))) {
                explained = true;
                console.error(`[nb-layout/NestedGrid] ${props.name} is kept until the transition ends (leave: "retain") and a component inside failed to render. `
                    + "It may have re-rendered on its own and read data the host has already removed; pass the item to it as a prop instead of looking it up by key in a slot.");
            }
            // 不返回 false：原错误照常往上传给宿主的错误处理。
            return undefined;
        });
        return () => {
            if (!props.frozen) {
                token = {};
                explained = false;
            }
            return withMemo([token], () => h(Fragment, slots.default?.() ?? []), cache, 0);
        };
    },
});
