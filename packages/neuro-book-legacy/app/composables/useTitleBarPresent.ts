import {readonly, ref, type Ref} from "vue";

/**
 * 标题栏是否**真的画出来了**。
 *
 * 唯一真相是标题栏组件的挂载事实，不是 Desktop Bridge 标志：切片 5 起浏览器主页面也有标题栏，
 * 按 bridge 判会让通知条从 `y=16` 起画、压住标题栏右侧的控件（卡片是 `pointer-events-auto`，还会吃掉点击）。
 * 与标题栏抢同一块屏幕的东西（通知视口等）按这个事实让位。
 *
 * 模块级 ref 只在客户端由标题栏的挂载 / 卸载写（SSR 不写），因此不会跨请求共享请求态。
 */
const titleBarPresent = ref(false);

/** 只读读取当前标题栏是否在场。 */
export function useTitleBarPresent(): Readonly<Ref<boolean>> {
    return readonly(titleBarPresent);
}

/** 标题栏组件用自己的挂载事实登记在场状态；卸载时清掉。 */
export function markTitleBarPresent(present: boolean): void {
    titleBarPresent.value = present;
}
