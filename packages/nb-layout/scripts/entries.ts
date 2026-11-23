/**
 * 发布入口清单：打包（`pack.ts`）与接口报告（`api-report.ts`）共用这一份，两边不会对不上。
 * 加入口只改这里；报告文件名取 `name`，产物里的子路径取 `subpath`。
 */

/** 发布的入口：子路径、产物名、源码入口。`./lab-sources` 不发（它用 `import.meta.glob`，只有 Vite 宿主能用）。 */
export const ENTRIES = [
    {subpath: ".", name: "index", source: "src/index.ts", vue: false},
    {subpath: "./vue", name: "vue", source: "src/vue/index.ts", vue: true},
    {subpath: "./text", name: "text", source: "src/vue/text.ts", vue: false},
    {subpath: "./locales", name: "locales", source: "src/locales/index.ts", vue: false},
] as const;
