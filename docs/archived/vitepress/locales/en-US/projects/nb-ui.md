# nb-ui

`@notnotype/nb-ui` provides Vue/Nuxt UI primitives for NeuroBook-derived applications. Its Nuxt module auto-registers components and composables; consumers can also import from explicit subpaths.

```ts
export default defineNuxtConfig({modules: ["@notnotype/nb-ui/nuxt"]});
```

```ts
import {Button, Dialog, FileTree, Table} from "@notnotype/nb-ui/components";
import {useNotification} from "@notnotype/nb-ui/composables";
```

The package ships compiled `dist/nb-ui.css` and icon rules used by its own components. Hosts provide the public colorway tokens; themes may additionally change shape, rhythm and component implementations. See the [project README](https://github.com/notnotype/neuro-book/blob/master/packages/nb-ui/README.md) for the component catalog, accessibility behavior and theme contract.
