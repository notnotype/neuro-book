# nb-ui

`@notnotype/nb-ui` 为 NeuroBook 系项目提供 Vue/Nuxt UI primitives。Nuxt module 自动注册组件与 composable；也可以从正式 subpath 手动导入。

```ts
export default defineNuxtConfig({modules: ["@notnotype/nb-ui/nuxt"]});
```

```ts
import {Button, Dialog, FileTree, Table} from "@notnotype/nb-ui/components";
import {useNotification} from "@notnotype/nb-ui/composables";
```

包自带编译后的 `dist/nb-ui.css` 和组件内部图标规则。宿主提供公开 colorway token；主题可以进一步改变形态、节奏和组件实现。组件清单、可访问性交互和主题合同见[项目 README](https://github.com/notnotype/neuro-book/blob/master/packages/nb-ui/README.md)。
