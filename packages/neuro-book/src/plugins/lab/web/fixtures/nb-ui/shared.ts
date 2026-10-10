/**
 * nb-ui 组件场景的共用部分。被测组件经 nb-ui 的公开入口按名字取，不深导入它的源码目录；登记文件只做 type 导入，
 * 组件模块在选中场景时才加载。
 */

import type {Component} from "vue";

import type * as NbUi from "@notnotype/nb-ui/components";

/** 公开入口里的组件导出名。泛型组件（`Table`）是函数而不是 `Component` 对象，也算在内。 */
export type NbUiComponentName = {[K in keyof typeof NbUi]: (typeof NbUi)[K] extends Component | ((...args: never[]) => unknown) ? K : never}[keyof typeof NbUi];

/** `defineSubjectFixture` 的 `subject`：从 `@notnotype/nb-ui/components` 取名为 `name` 的组件。 */
export function nbUiSubject(name: NbUiComponentName): () => Promise<{default: Component}> {
    return async () => ({default: (await import("@notnotype/nb-ui/components"))[name] as Component});
}
