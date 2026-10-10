/**
 * 书架页交给工作台首页贡献点的组件（docs/specs/ui/workbench-shell.md 输出 36）：每次挂载建一份页面模型，交给
 * `BookshelfHost.vue` 渲染；卸载时释放模型（定时刷新停止，在途的响应作废）。用渲染函数写：插件的合同测试在 bun test
 * 里导入插件，bun 不能加载 `.vue`。
 */

import {defineComponent, h, onBeforeUnmount} from "vue";
import type {Component, Ref} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import type {ShelfPage} from "./shelf-page";

export interface BookshelfHomeOptions {
    /** `components/BookshelfHost.vue`。 */
    readonly component: Component;
    readonly locale: Readonly<Ref<DisplayLocale>>;
    readonly createPage: () => ShelfPage;
}

export function createBookshelfHome(options: BookshelfHomeOptions): Component {
    return defineComponent({
        name: "BookshelfHome",
        setup() {
            const page = options.createPage();
            onBeforeUnmount(() => page.dispose());
            return () => h(options.component, {page, locale: options.locale.value});
        },
    });
}
