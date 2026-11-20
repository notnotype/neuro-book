/**
 * 书架页交给工作台首页贡献点的组件（docs/specs/ui/workbench-shell.md 输出 36）：每次挂载建一份页面模型，交给
 * `BookshelfHost.vue` 渲染；卸载时释放模型（定时刷新停止，在途的响应作废）。用渲染函数写：插件的合同测试在 bun test
 * 里导入插件，bun 不能加载 `.vue`。
 */

import {defineComponent, h, onBeforeUnmount} from "vue";
import type {Component, Ref, ShallowRef} from "vue";

import type {ShelfPage} from "./shelf-page";

export interface BookshelfHomeOptions {
    /** `components/BookshelfHost.vue`。 */
    readonly component: Component;
    /** 本页的设置窗口开着（公开状态 `nbook.settings/windowOpen`）：齿轮画成按下。 */
    readonly settingsOpen: Readonly<Ref<boolean>>;
    readonly createPage: () => ShelfPage;
    /** 案头的贡献位（`desk.ts`）：书架画出来时才要组件。 */
    readonly desk: {readonly companion: Readonly<ShallowRef<Component | null>>; want(): void};
}

export function createBookshelfHome(options: BookshelfHomeOptions): Component {
    return defineComponent({
        name: "BookshelfHome",
        setup() {
            const page = options.createPage();
            options.desk.want();
            onBeforeUnmount(() => page.dispose());
            return () => h(options.component, {page, settingsOpen: options.settingsOpen.value, companion: options.desk.companion.value});
        },
    });
}
