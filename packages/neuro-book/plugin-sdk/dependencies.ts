/**
 * 作者机器上要有的包，打包（`pack.ts`）与测试里的作者目录（`testing/author.ts`）共用这两张表；版本范围由打包时取应用自己的
 * `package.json`。只放名字，不引用别的模块：Playwright（Node）也加载它。
 */

/** 构建预设在作者机器上运行时要的包：SDK 的普通依赖。 */
/** `yaml`：打包 Skill 时按运行时的同一套规则读 `SKILL.md`。 */
export const BUILD_DEPENDENCIES = ["vite", "@vitejs/plugin-vue", "@iconify/utils", "@iconify-json/lucide", "semver", "yaml"] as const;

/** 作者项目自己装的包：SDK 的 peer 依赖 vue 与 typebox，加上类型检查用的 typescript 与 vue-tsc；`create` 把它们写进开发依赖。 */
export const AUTHOR_PACKAGES = ["typebox", "typescript", "vue", "vue-tsc"] as const;
