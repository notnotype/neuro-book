/**
 * 模板类型检查的两处补充。各宿主打开了 `checkUnknownProps`、`checkUnknownEvents`，用来拦写错或改过名的组件属性与事件。
 *
 * - 任何组件都接受 ARIA 属性与 `role`：Vue 运行时把组件没声明的属性透传到根元素，reka 的组件也一样，但 vue-tsc
 *   认为组件只接受自己声明的属性。补在 `AllowedComponentProps`（`class`、`style` 也声明在这里）上。这几个名字不会是
 *   组件自己的属性名，所以不会挡住改名检查，Lab 推导场景输入时也照样把它们排除在组件属性之外（`lab-subject.ts`）；
 *   `id`、`title` 与原生事件不补，它们可能就是组件自己的属性或事件。
 * - Vue 的 `AriaAttributes` 还没有 ARIA 1.3 的 `aria-description`。Vue 补上以后删掉这一项。
 */
// `AriaAttributes` 是 `vue` 自己的类型，在增强块里直接可见，不必另外导入（SDK 打包时把这一块原样附在组件声明末尾）。
// 都补在 `vue` 上：nb-ui 只依赖 `vue`，不依赖它内部的 `@vue/runtime-dom`，严格解析的包管理器下补那个模块会找不到。
declare module "vue" {
    interface AllowedComponentProps extends AriaAttributes {
        role?: string;
    }

    interface AriaAttributes {
        "aria-description"?: string;
    }
}

export {};
