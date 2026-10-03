# Fullstack Template / UI Library

## Relative documents refs

- [../../README.md](../../README.md)：NeuroBook 文档入口。
- [../../../PROJECT-STATUS.md](../../../PROJECT-STATUS.md)：仓库当前状态。
- [../84-llmlint-standalone-repo/README.md](../84-llmlint-standalone-repo/README.md)：llmlint sibling 仓与 vendored snapshot 的参考模式。
- `C:\Users\notnotype\Documents\CodeRepository\GithubProjects\llmlint`：衍生项目现状参考，尤其是 `skill/` runtime package 与 `web/` Nuxt 子应用。

## User Request / Topic

- 参考 NeuroBook 及其衍生项目 `llmlint`，整理一套可复用的全栈项目模板。
- 将跨项目重复的 UI 基础组件独立为组件库，单独维护，并允许业务项目通过 `bun link` 本地链接。
- 本轮先调研和建 task；计划需要进一步明确目录结构，以及后续实现时哪些文件需要移动。

## Goal

建立一份 decision-complete 的架构计划：后续实现者可以据此创建 sibling 仓 `nb-ui` 与 `nb-fullstack-template`，迁移 NeuroBook / llmlint 已重复的前端基础设施，并保留业务项目各自的领域代码边界。

成功标准：

- 明确 sibling 仓形态、目录结构、包导出面和本地 `bun link` 联调方式。
- 明确第一批需要从 NeuroBook / llmlint 移动、抽取或删除的文件。
- 明确模板第一版范围：基础全栈，不包含 NeuroBook 的 Agent / Workspace / World Engine 等重型业务能力。
- 给出迁移顺序与验证方式，避免一次性大范围震荡。

## Current State

- NeuroBook 是重型产品应用：Nuxt 4 + Vue 3 + Bun + Nitro + Prisma/libSQL + Pinia + UnoCSS + Vitest，已有完整 `app/components/common`、主题、通知、Dialog、resizable panel、API error 解析等基础设施。
- llmlint 已从 NeuroBook 内嵌 skill 独立为 sibling 仓，根仓负责开发资产，`skill/` 是可安装 runtime package，`web/` 是 Nuxt 4 全栈子应用。
- 两边已经重复维护这些基础件：
  - `Dialog.vue`
  - `Dropdown.vue` / `dropdown.types.ts`
  - `IconButton.vue`
  - `NotificationViewport.vue` / `useNotification.ts`
  - `SegmentedControl.vue`
  - `useResizablePanel.ts`
  - `theme-tokens.ts` / `apply-theme.ts`
  - `api-error.ts`
- `useResizablePanel.ts` 两边几乎同源，适合直接抽库；`Dialog.vue` 应以 NeuroBook 的更完整能力为底座；主题 tokens 需要拆成“基础变量契约 + 产品变量覆盖”，不能强迫 llmlint 吃完整 Novel IDE 主题。

## Decisions / Discussion

- 仓库形态：采用 sibling 仓，而不是 monorepo。
  - `C:\Users\notnotype\Documents\CodeRepository\GithubProjects\nb-ui`
  - `C:\Users\notnotype\Documents\CodeRepository\GithubProjects\nb-fullstack-template`
  - NeuroBook / llmlint / 后续产品仓通过 `bun link` 连接本地开发版本。
- 模板范围：第一版只做基础全栈。
  - 包含 Nuxt / Nitro API / auth / Prisma-libSQL / 主题 / 通知 / Dialog / 文档任务规范 / 基础脚本。
  - 不包含 NeuroBook 的 Agent Harness、Project Workspace、World Engine、Markdown Studio、Windows Portable release。
- UI 库策略：先抽跨项目基础设施，不抽业务组件。
  - 业务组件如 `NovelIde*`、`WorldEngine*`、`MarkdownStudio*`、llmlint `ReviewEditor` 留在各自项目。
  - UI 包需要支持宿主注入 theme host class 和通用文案，避免组件内部绑定 `nbook` 或 `llmlint` 别名。
- 迁移顺序：先新建 `nb-ui` 与模板 playground，再用 llmlint web 做小型试迁移，最后再分批替换 NeuroBook。

## Target Directory Design

### `nb-ui`

```text
nb-ui/
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  uno.config.ts
  README.md
  src/
    module.ts
    index.ts
    styles.css
    components/
      controls/
        Dropdown.vue
        IconButton.vue
        SegmentedControl.vue
        SwitchField.vue
        dropdown.types.ts
      feedback/
        Dialog.vue
        NotificationViewport.vue
      form/
        FormCheckbox.vue
        FormField.vue
        FormInput.vue
        FormNumberInput.vue
        FormSelect.vue
        FormTextarea.vue
    composables/
      useNotification.ts
      useResizablePanel.ts
    theme/
      apply-theme.ts
      theme-contract.ts
    utils/
      api-error.ts
  playground/
    app/
      app.vue
      pages/index.vue
    nuxt.config.ts
```

公开导出：

- `@notnotype/nb-ui/nuxt`：Nuxt module，负责组件注册、样式注入、linked package transpile。
- `@notnotype/nb-ui/components`：Vue 组件。
- `@notnotype/nb-ui/composables`：`useNotification`、`useResizablePanel`。
- `@notnotype/nb-ui/theme`：基础主题变量契约和 `applyTheme()`。
- `@notnotype/nb-ui/utils`：`resolveApiErrorMessage()`。
- `@notnotype/nb-ui/styles.css`：组件基础样式入口。

### `nb-fullstack-template`

```text
nb-fullstack-template/
  package.json
  tsconfig.json
  nuxt.config.ts
  uno.config.ts
  vitest.config.ts
  prisma.config.ts
  .env.example
  README.md
  PROJECT-STATUS.md
  RELEASE.md
  AGENTS.md
  app/
    app.vue
    pages/
      index.vue
      login.vue
      register.vue
    composables/
      useAuthState.ts
    utils/
      web-settings.ts
    i18n/
      i18n.config.ts
      locales/
        zh-CN.ts
        en-US.ts
  server/
    api/
      auth/
        login.post.ts
        logout.post.ts
        me.get.ts
        register.post.ts
      health.get.ts
    database/
      prisma.ts
    middleware/
      auth.ts
    utils/
      auth.ts
      password.ts
      dto.ts
  shared/
    dto/
      auth.dto.ts
  prisma/
    schema.prisma
    migrations/
  scripts/
    init-db.ts
  docs/
    README.md
    tasks/
      README.md
      TEMPLATE.md
  reference/
    README.md
```

模板默认脚本：

- `dev`：初始化必要生成物后启动 Nuxt。
- `build`：构建 Nuxt/Nitro。
- `typecheck`：运行 `vue-tsc --noEmit`。
- `test`：运行 Vitest。
- `db:generate` / `db:migrate` / `db:init`：管理 Prisma/libSQL。
- `docs:dev`：启动文档站，后续需要时再接 VitePress。

## File Move / Extraction Plan

### 从 NeuroBook 抽到 `nb-ui`

| Source | Target | Strategy |
| --- | --- | --- |
| `app/components/common/Dialog.vue` | `nb-ui/src/components/feedback/Dialog.vue` | 以 NeuroBook 版本为主，移除 `nbook` alias 与硬编码 i18n，改为 labels / props / injection。 |
| `app/components/common/IconButton.vue` | `nb-ui/src/components/controls/IconButton.vue` | 保留 size / variant 能力，统一 `aria-label` / `title` 契约。 |
| `app/components/common/Dropdown.vue` | `nb-ui/src/components/controls/Dropdown.vue` | 移动实现，去掉项目路径别名。 |
| `app/components/common/dropdown.types.ts` | `nb-ui/src/components/controls/dropdown.types.ts` | 作为 public type 导出。 |
| `app/components/common/NotificationViewport.vue` | `nb-ui/src/components/feedback/NotificationViewport.vue` | 改为消费库内 `useNotification()`，保留 position 能力。 |
| `app/composables/useNotification.ts` | `nb-ui/src/composables/useNotification.ts` | 抽成全局通知 store，避免依赖 Nuxt app 私有状态。 |
| `app/composables/useResizablePanel.ts` | `nb-ui/src/composables/useResizablePanel.ts` | 直接迁移为共享实现。 |
| `app/components/common/form/SegmentedControl.vue` | `nb-ui/src/components/controls/SegmentedControl.vue` | 以 NeuroBook 较完整版本为底座，llmlint 后续改用同一组件。 |
| `app/components/common/form/FormInput.vue` | `nb-ui/src/components/form/FormInput.vue` | 第一批表单基础件。 |
| `app/components/common/form/FormTextarea.vue` | `nb-ui/src/components/form/FormTextarea.vue` | 第一批表单基础件。 |
| `app/components/common/form/FormSelect.vue` | `nb-ui/src/components/form/FormSelect.vue` | 第一批表单基础件。 |
| `app/components/common/form/FormCheckbox.vue` | `nb-ui/src/components/form/FormCheckbox.vue` | 第一批表单基础件。 |
| `app/components/common/form/FormNumberInput.vue` | `nb-ui/src/components/form/FormNumberInput.vue` | 第一批表单基础件。 |
| `app/components/common/form/FormField.vue` | `nb-ui/src/components/form/FormField.vue` | 第一批表单基础件。 |
| `app/utils/theme/apply-theme.ts` | `nb-ui/src/theme/apply-theme.ts` | 抽通用 apply 逻辑；产品 theme tokens 留在应用内。 |
| `app/utils/theme/theme-tokens.ts` | `nb-ui/src/theme/theme-contract.ts` | 只抽变量名契约和基础类型；完整 NeuroBook tokens 继续留在 NeuroBook。 |
| `app/utils/api-error.ts` | `nb-ui/src/utils/api-error.ts` | 抽通用 API 错误解析。 |

NeuroBook 迁移后短期处理：

- 在 NeuroBook 中保留原路径 wrapper 或分批改 import，避免一次性改完整个前端。
- `app/utils/theme/theme-tokens.ts` 保留为 NeuroBook 产品主题真相源，只从 `nb-ui/theme` 复用基础类型 / apply 函数。
- `app/components/common/low-code-form/*`、`diff/*`、`LucideIconPickerDialog.vue`、`SideDetailPanel.vue` 暂不移动；等第一批稳定后再评估。

### 从 llmlint web 移除重复件

| Source | Target / Replacement | Strategy |
| --- | --- | --- |
| `web/app/components/common/Dialog.vue` | `@notnotype/nb-ui/components` | 删除本地轻量版，改 import 库组件。 |
| `web/app/components/common/IconButton.vue` | `@notnotype/nb-ui/components` | 删除本地版本。 |
| `web/app/components/common/Dropdown.vue` | `@notnotype/nb-ui/components` | 删除本地版本。 |
| `web/app/components/common/dropdown.types.ts` | `@notnotype/nb-ui/components` | 删除本地 type。 |
| `web/app/components/common/NotificationViewport.vue` | `@notnotype/nb-ui/components` | 删除本地版本。 |
| `web/app/components/common/SegmentedControl.vue` | `@notnotype/nb-ui/components` | 删除本地版本。 |
| `web/app/components/common/SwitchField.vue` | `nb-ui/src/components/controls/SwitchField.vue` | 抽入库，llmlint 使用库组件。 |
| `web/app/composables/useNotification.ts` | `@notnotype/nb-ui/composables` | 删除本地 composable。 |
| `web/app/composables/useResizablePanel.ts` | `@notnotype/nb-ui/composables` | 删除本地 composable。 |
| `web/app/utils/theme/apply-theme.ts` | `@notnotype/nb-ui/theme` | 删除本地 apply 逻辑。 |
| `web/app/utils/api-error.ts` | `@notnotype/nb-ui/utils` | 删除本地解析逻辑。 |

llmlint 保留：

- `web/app/utils/theme/theme-tokens.ts`：保留 llmlint 的产品主题 token，只改成满足 `nb-ui` 基础变量契约。
- `web/app/composables/useLlmlintTheme.ts`、`useLlmlintI18n.ts`：保留产品适配层。
- `web/app/components/ReviewEditor.vue`、`TextPanel.vue`、`IssueCard.vue` 等业务组件不移动。

### 用于模板的源文件参考

| Reference Source | Template Target | Notes |
| --- | --- | --- |
| `llmlint/web/nuxt.config.ts` | `nb-fullstack-template/nuxt.config.ts` | 作为轻量 Nuxt 全栈配置底座，加入 `@notnotype/nb-ui/nuxt`。 |
| `llmlint/web/server/api/auth/*` | `nb-fullstack-template/server/api/auth/*` | 作为最小 auth 流程参考。 |
| `llmlint/web/server/utils/auth.ts` | `nb-fullstack-template/server/utils/auth.ts` | 保留基础 session / role 判断。 |
| `llmlint/web/server/utils/password.ts` | `nb-fullstack-template/server/utils/password.ts` | 复用 scrypt 密码处理。 |
| `llmlint/web/server/utils/dto.ts` | `nb-fullstack-template/server/utils/dto.ts` | 复用 zod DTO parse 模式。 |
| `llmlint/web/prisma/schema.prisma` | `nb-fullstack-template/prisma/schema.prisma` | 精简为 User + session 所需字段。 |
| `llmlint/web/scripts/init-db.ts` | `nb-fullstack-template/scripts/init-db.ts` | 精简为模板初始化脚本。 |
| `neuro-book/docs/tasks/README.md` | `nb-fullstack-template/docs/tasks/README.md` | 泛化任务 walkthrough 规范，去掉 NeuroBook 专属表述。 |
| `neuro-book/docs/tasks/TEMPLATE.md` | `nb-fullstack-template/docs/tasks/TEMPLATE.md` | 泛化为模板默认任务格式。 |
| `neuro-book/PROJECT-STATUS.md` | `nb-fullstack-template/PROJECT-STATUS.md` | 改成空项目状态模板。 |

## Implementation Walkthrough

### 2026-07-03 调研与计划落档

- 已对比 NeuroBook 与 llmlint 的 package、Nuxt 配置、文档任务结构、UI common 组件和 composables。
- 已确认 `useResizablePanel` 几乎同源，适合直接抽库。
- 已确认 `Dialog` 应以 NeuroBook 版本为基础，因为它已有大型工作台、关闭拦截、busy、尺寸预设、teleport host 等能力。
- 已确认主题不能整包搬 NeuroBook token；库只定义基础变量契约，产品各自保留 theme tokens。
- 本文档新增目标目录设计与明确文件迁移清单。

### 2026-07-03 首轮实现

已完成：

- 新建 sibling `C:\Users\notnotype\Documents\CodeRepository\GithubProjects\nb-ui`。
- `nb-ui` 已实现 Nuxt module、公共导出、基础 theme contract、API error util、`useNotification`、`useResizablePanel`、Dialog / Notification / Dropdown / IconButton / SegmentedControl / SwitchField / 基础 Form 组件。
- UI 取舍：
  - `Dialog` 以 NeuroBook 更完整的关闭拦截、busy、尺寸预设、teleport、request-close 语义为底座。
  - `SegmentedControl` / `Dropdown` / `SwitchField` / `NotificationViewport` 更偏向 llmlint web 的新版轻量 UI，同时吸收 NeuroBook 的 count / icon / tone / size 等可配置能力。
  - 组件只消费基础 CSS 变量，不绑定 `nbook` 或 `llmlint` 路径别名。
- `nb-ui/playground` 已可构建，用于后续视觉和交互验证。
- 新建 sibling `C:\Users\notnotype\Documents\CodeRepository\GithubProjects\nb-fullstack-template`。
- `nb-fullstack-template` 已实现 Nuxt 4 SPA、`@notnotype/nb-ui` 接入、注册/登录/退出/me API、Prisma/libSQL SQLite、scrypt 密码、zod DTO、默认页面、任务文档模板、`PROJECT-STATUS.md` / `RELEASE.md` / `AGENTS.md`。
- 未移动 `neuro-book` 或 `llmlint` 目录；本轮也没有迁移两个现有项目的源码 import。

计划出入：

- 模板 `package.json` 初始尝试使用错误形态 `link:../nb-ui`，但 Bun 在当前 Windows 环境持续报 `failed linking dependency/workspace to node_modules for package @notnotype/nb-ui`。首轮为保证模板可安装和可验证，曾临时改为 `file:../nb-ui`；后续 bun link 调查确认正确形态应为 `link:@notnotype/nb-ui`。
- 新版 Nuxt 4.4.8 在本地需要显式安装 `@nuxt/cli`，两个新项目都已加入 devDependency。
- `bun run db:migrate` 验证在本机无输出超过 60 秒；尝试中断该 exec 会话时工具后端不支持 interrupt，随后 Windows 进程枚举命令也卡住。没有为了清理而误杀全局 bun/node 进程。数据库迁移链路目前只完成 migration 文件落地、`prisma generate` 和 build 中的 Prisma client 生成验证，`migrate dev` 仍需后续单独复核。

### 2026-07-03 基础契约修复

已完成：

- `nb-ui` 公共 API 已补齐 `@notnotype/nb-ui/components` 的组件值导出和类型导出，覆盖 `Dialog`、`IconButton`、`Dropdown`、`SegmentedControl`、`SwitchField`、`NotificationViewport`、基础 Form 组件与 dropdown types。
- `nb-ui` 继续保留 Nuxt module 自动注册组件能力；新增 playground `manual-import.vue` 验证手动导入组件值的正式支持路径。
- `@nuxt/kit` 已调整为 `nb-ui` module 运行时依赖，避免宿主项目解析 Nuxt module 时依赖不稳定。
- `nb-ui` Nuxt module 在 dev 下把组件库 package root 加入 `vite.server.fs.allow`，兼容 sibling / `file:` / symlink 形态。
- `nb-fullstack-template` 在本轮曾默认依赖 `@notnotype/nb-ui: "file:../nb-ui"`；该决策已被后续 bun link 主路径切换取代。
- `nb-fullstack-template` 新增 `db:deploy`、`db:create`、`db:setup` 与 `db:migrate:dev` 脚本：
  - `db:create` 显式创建 `DATABASE_URL=file:` 指向的本地 SQLite 文件。
  - `db:setup` 现在执行 `prisma generate -> db:create -> prisma migrate deploy -> init-db`。
  - `db:migrate:dev` 只用于开发者修改 schema 后生成迁移。
- README 已同步说明 Nuxt 自动注册、手动导入、主题变量、数据库初始化命令和默认 admin 环境变量；UI 依赖主路径在后续切换为 bun link。

关键根因：

- `prisma migrate deploy` 在当前 Prisma 7 + SQLite 下不会为不存在的 `file:` 数据库自动创建文件；Prisma CLI 包装层只显示空的 `Schema engine error`，直接调用 schema engine 可看到 `P1003 Database ... does not exist`。
- 本轮没有手写 SQL 绕过 Prisma migrate，而是在迁移前补齐“本地 SQLite 文件必须存在”的模板契约。schema 变更仍由 Prisma migrations 负责。

计划出入：

- 第一版中途曾把本地依赖主路径从最初设想的 `bun link` 调整为 `file:../nb-ui`；该结论已被后续最小 fixture 复核修正：失败点是 `link:../nb-ui` 用法错误，不是 bun link 主流程不可用。
- 本轮没有移动 NeuroBook / llmlint 目录，也没有迁移两个现有项目的源码 import。

### 2026-07-03 bun link 主路径切换

已完成：

- 复核 Bun 1.3.14 在 Windows 下的 link 行为：
  - `link:../some-package` 会在最小普通包和 scoped 包上复现 `FileNotFound: failed linking dependency/workspace to node_modules`。
  - 正确流程是先在包目录执行 `bun link` 注册包名，再在 consumer 中使用 `bun link <package>` 或 `package.json` 写 `link:<package-name>`。
  - `link:@notnotype/nb-ui` 在已注册 `@notnotype/nb-ui` 后可通过 `bun install` 复现，且 `node_modules/@notnotype/nb-ui` 是指向 sibling `../nb-ui` 的 symlink。
- `nb-fullstack-template/package.json` 已将 `@notnotype/nb-ui` 从 `file:../nb-ui` 改为 `link:@notnotype/nb-ui`。
- `nb-fullstack-template/bun.lock` 已更新为 `@notnotype/nb-ui@link:@notnotype/nb-ui`。
- `nb-fullstack-template` README 首次运行路径已改为先在 `../nb-ui` 执行 `bun link`，再进入模板 `bun install -> db:setup -> dev`。
- `nb-ui` README 已将 sibling app 使用方式改为 bun link 主路径，并明确 `link:../nb-ui` 不是有效写法。

计划出入：

- 本次不新增 setup/preinstall 脚本自动执行 `bun link`。`bun link` registry 是开发机全局状态，文档化显式注册比隐藏在 lifecycle 中更直接，也更符合 Bun 的实际模型。
- 本次不引入 npm 发布、打包产物或 monorepo workspace；`nb-ui` 继续作为 sibling 源码包由 Nuxt/Vite 转译。

### 2026-07-03 bun link 审查复核

审查结论：

- 未发现需要继续修复的任务遗漏；`file:../nb-ui` 只保留在历史记录中，`link:../nb-ui` 只保留为明确错误反例。
- `nb-fullstack-template` 严格安装链路已复核：`bun install --frozen-lockfile` 通过，`node_modules/@notnotype/nb-ui` 是指向 sibling `../nb-ui` 的 symlink，`bun.lock` 为 `@notnotype/nb-ui@link:@notnotype/nb-ui`。
- `nb-ui` 严格安装链路已复核：`bun install --frozen-lockfile` 通过。
- 复跑验证：
  - `nb-ui`: `bun run typecheck`、`bun run test`、`bun run build` 均通过。
  - `nb-fullstack-template`: `bun run typecheck`、`bun run test`、`bun run build` 均通过。
  - `$env:DATABASE_URL='file:./.agent/smoke-review.db'; bun run db:setup` 通过，迁移与默认 `admin` 初始化均非交互完成。
- 浏览器验证仍未执行，符合本轮约束。

### 2026-07-03 v0.6 组件库与模板优化

已完成：

- 只优化 sibling `nb-ui` 与 `nb-fullstack-template`；未迁移 NeuroBook / llmlint 的组件 import，也未移动任何项目目录。
- `nb-ui` 新增基础公共组件：
  - `Button` 支持 `primary / secondary / subtle / danger / ghost`、`sm / md`、`block`、`loading`、`disabled`。
  - `Panel` 支持 `default / subtle` tone、`sm / md` padding，并可用 `as` 指定语义标签。
- `nb-ui` 表单组件补齐常用 HTML 属性类型化入口：`id`、`name`、`required`、`readonly`、`autofocus`、长度限制等；`FormField` 增加 required 标记。
- `nb-ui` 主题系统从单纯 `Record<--${string}, string>` 升级为公共 token key + 扩展变量形态，并提供 `defaultDarkTheme`、`defaultLightTheme`、`applyNbTheme()`。
- `nb-ui` 新增组件 smoke tests，覆盖 Button、Panel、FormInput、FormField；测试环境显式接入 `@vue/test-utils`、`@vitejs/plugin-vue`、`happy-dom`。
- `nb-fullstack-template` 改用共享 `Button` / `Panel` / Form 组件表达首页、登录页、注册页。
- 模板主题变量从 `app.vue` 抽到 `app/theme/default-theme.ts`，入口改用 `applyNbTheme(document.body, templateDarkTheme)`。
- `.env.example` 补充 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。
- 新增 `/protected` 页面和 `/api/protected` API，展示 `requireCurrentUser` 的受保护页面/API 标准写法。
- 模板新增 DTO schema 测试，覆盖登录/注册请求校验。
- `nb-ui` README 和模板 README 已补充组件、主题、bun link、派生新项目 checklist。

计划出入：

- 没有引入 Storybook、npm 发布、自动打包产物或 monorepo workspace。
- “主体系统”按主题系统处理；没有引入业务 subject system。

验证结果：

- `nb-ui`
  - `bun install --frozen-lockfile`：通过。
  - `bun run typecheck`：通过。
  - `bun run test`：2 files / 6 tests passed。
  - `bun run build`：通过。
- `nb-fullstack-template`
  - `bun run typecheck`：通过。
  - `bun run test`：2 files / 3 tests passed。
  - `bun run build`：通过，Nitro 输出包含 `/api/protected` route chunk。
  - `bun install --frozen-lockfile`：通过，`node_modules/@notnotype/nb-ui` 确认为指向 sibling `../nb-ui` 的 symlink。
  - `$env:DATABASE_URL='file:./.agent/smoke-template-v06.db'; bun run db:setup`：通过，迁移与默认 `admin` 初始化均非交互完成。
- 浏览器验证未执行，符合本轮约束。

### 2026-07-03 v0.6 审查复核

审查结论：

- 未发现本轮计划遗漏或阻塞问题；`nb-ui` 公共导出、Nuxt 自动注册、模板 linked 依赖、模板页面/API、数据库初始化和 README 契约能互相对上。
- `file:../nb-ui` 只保留在任务历史说明中；`link:../nb-ui` 只保留为明确错误反例。模板实际依赖与 lockfile 均为 `link:@notnotype/nb-ui`。
- `node_modules/@notnotype/nb-ui` 再次确认为指向 sibling `C:\Users\notnotype\Documents\CodeRepository\GithubProjects\nb-ui` 的 symlink。
- 模板生产构建输出包含 `routes/api/protected.get.mjs`，受保护 API 示例进入 Nitro 产物。

复跑验证：

- `nb-ui`
  - `bun install --frozen-lockfile`：通过。
  - `bun run typecheck`：通过。
  - `bun run test`：2 files / 6 tests passed。
  - `bun run build`：通过。
- `nb-fullstack-template`
  - `cd ../nb-ui && bun link`：通过，注册包名 `@notnotype/nb-ui`。
  - `bun install --frozen-lockfile`：通过，安装 `@notnotype/nb-ui@link:@notnotype/nb-ui`。
  - `bun run typecheck`：通过。
  - `bun run test`：2 files / 3 tests passed。
  - `bun run build`：通过。
  - `$env:DATABASE_URL='file:./.agent/smoke-review-v06.db'; bun run db:setup`：通过，迁移与默认 `admin` 初始化均非交互完成。

未执行：

- 浏览器验证未执行，符合本轮约束；当前只复核构建、类型、测试、linked package 与后端初始化链路。

### 2026-07-03 v0.6 深度审查与补强

审查结论：

- `nb-ui` 已具备内部组件库第一版的基本 Interface：Nuxt 自动注册、手动导入、共享 composables、主题 token、基础表单和反馈控件都能通过 Bun linked sibling 使用。
- 发现并修复一个浅 Interface：`FormField` 原本主要是视觉包装，调用方仍需自己连接 label / description / error / required 与输入控件。现在 `FormField` 会向 nested nb-ui form inputs 提供生成的 input id、`required`、`aria-describedby` 和 `aria-invalid`，调用方只需把输入放进字段内。
- 主题系统补上 `--color-scheme` public token；`defaultDarkTheme` / `defaultLightTheme` 分别声明 `dark` / `light`，`.nb-ui-theme` 通过该变量影响原生控件的浏览器渲染。
- `nb-fullstack-template` 登录/注册页改为展示新的 `FormField` 语义，不再在 nested `FormInput` 重复声明 `required`；`/protected` 页面补充 API 失败通知与跳转出口。
- 未动 NeuroBook / llmlint 源码，未移动任何项目目录。

变更文件：

- `../nb-ui/src/components/form/form-field-context.ts`
- `../nb-ui/src/components/form/FormField.vue`
- `../nb-ui/src/components/form/FormInput.vue`
- `../nb-ui/src/components/form/FormNumberInput.vue`
- `../nb-ui/src/components/form/FormTextarea.vue`
- `../nb-ui/src/components/form/FormSelect.vue`
- `../nb-ui/src/components/form/FormCheckbox.vue`
- `../nb-ui/src/theme/theme-contract.ts`
- `../nb-ui/src/styles.css`
- `../nb-ui/src/components/components.test.ts`
- `../nb-ui/src/theme/theme.test.ts`
- `../nb-ui/README.md`
- `../nb-fullstack-template/app/pages/login.vue`
- `../nb-fullstack-template/app/pages/register.vue`
- `../nb-fullstack-template/app/pages/protected.vue`
- `../nb-fullstack-template/README.md`

验证结果：

- `nb-ui`
  - `bun run typecheck`：通过。
  - `bun run test`：3 files / 9 tests passed。
  - `bun run build`：通过；仅见 Nuxt/Rollup/Vue 上游 sourcemap / deprecation warning。
- `nb-fullstack-template`
  - `cd ../nb-ui && bun link`：通过，注册包名 `@notnotype/nb-ui`。
  - `bun install --frozen-lockfile`：通过，安装 `@notnotype/nb-ui@link:@notnotype/nb-ui`。
  - `node_modules/@notnotype/nb-ui`：确认为指向 sibling `C:\Users\notnotype\Documents\CodeRepository\GithubProjects\nb-ui` 的 symlink。
  - `bun run typecheck`：通过。
  - `bun run test`：2 files / 3 tests passed。
  - `bun run build`：通过；Nitro 输出包含 `/api/protected` route chunk。并行构建时 Nitro 收尾较慢，但最终退出码为 0。
  - `$env:DATABASE_URL='file:./.agent/smoke-template-v07.db'; bun run db:setup`：通过，迁移与默认 `admin` 初始化均非交互完成。

计划出入：

- 本轮没有引入新的大型设计系统、Storybook、npm 发布或 monorepo workspace。
- 浏览器验证仍未执行，符合当前约束；如后续要验视觉与交互，需要单独明确。

### 2026-07-03 v0.6 控件语义、主题一致性与模板守卫

审查结论：

- `nb-ui` 组件库的下一处浅 Interface 是控件语义与主题一致性：`NotificationViewport` 和 `IconButton` 仍有硬编码状态色，`SwitchField` / `SegmentedControl` / `Dropdown` 的基础 ARIA 与稳定 id 还不够完整。
- 已将 `NotificationViewport` 的 success / warning / error / info 样式改为基于 `--status-success`、`--status-warning`、`--status-danger`、`--accent-main` 与宿主背景 token 派生，不再固定 emerald/red/amber/sky 色板。
- `IconButton` 的 danger hover 改用 `--status-danger`，并导出 `IconButtonVariant` / `IconButtonSize`。
- `Dropdown` 改用 Vue `useId()` 生成稳定 menu id，并补 `aria-haspopup="menu"`。
- `SegmentedControl` 增加 `ariaLabel` 与 `role="group"`；`SwitchField` 改为 `role="switch"` + `aria-checked`。
- `nb-fullstack-template` 新增 `app/middleware/auth.ts` named route middleware；`/protected` 页面改为 `definePageMeta({ middleware: "auth" })`，页面只负责调用受保护 API 和展示结果。
- 验证经验：不要并行运行 `bun install` 与 `bun run build`，因为 install 会改 `node_modules`，会让同时运行的 Nuxt build 短暂找不到 linked package。本轮已按顺序重跑通过。

变更文件：

- `../nb-ui/src/components/controls/IconButton.vue`
- `../nb-ui/src/components/controls/Dropdown.vue`
- `../nb-ui/src/components/controls/SegmentedControl.vue`
- `../nb-ui/src/components/controls/SwitchField.vue`
- `../nb-ui/src/components/feedback/NotificationViewport.vue`
- `../nb-ui/src/components/index.ts`
- `../nb-ui/src/components/components.test.ts`
- `../nb-ui/README.md`
- `../nb-fullstack-template/app/middleware/auth.ts`
- `../nb-fullstack-template/app/pages/protected.vue`
- `../nb-fullstack-template/README.md`

验证结果：

- `nb-ui`
  - `bun run typecheck`：通过。
  - `bun run test`：3 files / 13 tests passed。
  - `bun run build`：通过；仍只有 Nuxt/Rollup/Vue 上游 sourcemap / deprecation warning。
- `nb-fullstack-template`
  - `bun run typecheck`：通过。
  - `bun run test`：2 files / 3 tests passed。
  - `cd ../nb-ui && bun link`：通过，注册包名 `@notnotype/nb-ui`。
  - `bun install --frozen-lockfile`：顺序执行时通过，安装 `@notnotype/nb-ui@link:@notnotype/nb-ui`。
  - `node_modules/@notnotype/nb-ui`：确认为指向 sibling `C:\Users\notnotype\Documents\CodeRepository\GithubProjects\nb-ui` 的 symlink。
  - `bun run build`：通过；Nitro 输出包含 `/api/protected` route chunk。
  - `$env:DATABASE_URL='file:./.agent/smoke-template-v08.db'; bun run db:setup`：通过，迁移与默认 `admin` 初始化均非交互完成。

计划出入：

- 本轮没有引入大型设计系统、Storybook、npm 发布、monorepo workspace 或浏览器验证。
- 没有动 NeuroBook / llmlint 源码，未迁移它们的组件 import。

### 2026-07-06 模板配置文件与可关闭认证

问题判断：

- `nb-fullstack-template` 原本只有 `.env.example`，没有项目级配置文件；`.env` 适合密钥、数据库地址和部署环境变量，不适合作为模板产品行为的主配置。
- 认证启用状态被硬编码为默认事实：`AuthSessionDto.authEnabled` 是字面量 `true`，`/api/auth/me` 总返回 `authEnabled: true`，route middleware 和 `requireCurrentUser(event)` 都只能按“必须登录”工作。
- 这会导致派生项目如果不需要登录，只能删代码或绕过 middleware，不符合模板应有的配置契约。

已完成：

- 新增 `../nb-fullstack-template/shared/config/template.config.ts`，作为模板项目级配置入口。
- `templateConfig.auth.enabled` 默认 `true`；派生项目可改为 `false` 来关闭登录、注册、session 校验和受保护页面跳转。
- `templateConfig.auth.anonymousUser` 定义认证关闭后的当前身份；`useAuthState()`、`/api/auth/me`、`app/middleware/auth.ts`、`requireCurrentUser(event)` 都会使用同一份配置身份。
- `AuthSessionDto.authEnabled` 从 `true` 字面量改为 `boolean`。
- `getCurrentUser(event)` 和 `requireCurrentUser(event)` 的 Interface 改为返回 `AuthUserDto` 身份；认证开启时来自数据库用户，认证关闭时来自配置身份。
- `login` / `register` / `logout` API 在认证关闭时返回当前配置 session，不再强制读写数据库 session。
- 首页会显示“认证已关闭”和当前配置身份；登录/注册页直接访问时会刷新配置并回到首页。
- README 增加 `Template config` 章节和派生项目 checklist。

验证结果：

- `nb-fullstack-template`
  - `bun run typecheck`：通过。
  - `bun run test`：3 files / 4 tests passed，新增测试覆盖认证关闭时返回 configured anonymous identity。
  - `bun run build`：通过；仅见 Vue/Nitro 上游 deprecation warning。
  - `$env:DATABASE_URL='file:./.agent/smoke-template-config.db'; bun run db:setup`：通过，迁移与默认 `admin` 初始化均非交互完成。

未执行：

- 浏览器验证未执行；当前只验证类型、测试、构建和数据库初始化链路。

### 2026-07-06 模板默认关闭认证

已完成：

- `../nb-fullstack-template/shared/config/template.config.ts` 中 `templateConfig.auth.enabled` 默认值从 `true` 改为 `false`。
- 配置注释改为说明：模板默认关闭认证；需要登录、注册、session 校验和受保护页面跳转时，再显式改为 `true`。
- README 改成 optional auth 语义，说明默认不会有登录墙；admin 初始账号和 `NUXT_SESSION_PASSWORD` 只在启用认证时是主路径关注项。
- `server/utils/auth-config.test.ts` 新增断言，锁定默认 `auth.enabled === false`。

验证结果：

- `nb-fullstack-template`
  - `bun run typecheck`：通过。
  - `bun run test`：3 files / 5 tests passed。
  - `bun run build`：通过；仅见 Vue/Nitro 上游 deprecation warning。

### 2026-07-06 模板全局样式与组件展示页

问题判断：

- 截图中的白边来自模板缺少全局 reset，浏览器默认 `body { margin: 8px; }` 让 `html` 白色背景露出。
- `nb-ui` 作为组件库不应强行重置宿主 app 的 body margin；这个 reset 应放在 `nb-fullstack-template` 的 app 级全局样式里。

已完成：

- 新增 `../nb-fullstack-template/app/styles/global.css`：
  - 设置全局 `box-sizing`。
  - 去掉 `body` 默认 margin。
  - 给 `html`、`body`、`#__nuxt` 设置高度和模板背景兜底。
  - 统一 form control 继承字体。
- `../nb-fullstack-template/nuxt.config.ts` 引入 `~/styles/global.css`。
- `../nb-fullstack-template/app/app.vue` 将 `templateDarkTheme` 同时应用到 `document.documentElement` 和 `document.body`。
- 新增 `../nb-fullstack-template/app/pages/components.vue`，展示 Button、IconButton、Panel、Form、FormSelect、FormNumberInput、FormTextarea、FormCheckbox、SegmentedControl、SwitchField、Dropdown、Notification、Dialog。
- 首页新增“组件展示”入口。
- `../nb-fullstack-template/README.md` 记录全局样式和 `/components` 页面。

验证结果：

- `nb-fullstack-template`
  - `bun run typecheck`：通过。
  - `bun run test`：3 files / 5 tests passed。
  - `bun run build`：通过；产物包含 `components` 页面 chunk。仍只有 Nuxt/Rollup/Vue 上游 sourcemap / deprecation warning。

未执行：

- 按项目约束未自动执行浏览器验证；如果需要视觉验收，可以单独打开 dev server 检查 `/` 和 `/components`。

### 2026-07-06 nb-ui 反馈组件与展示页质感补强

问题判断：

- `/components` 页面虽然已经使用部分 nb-ui 组件，但整体仍像临时 demo：静态反馈没有真正的 nb-ui 组件，只能靠 toast 容器或手写样式；`FormCheckbox` 仍是原生 checkbox，视觉明显弱于其它表单组件。
- 通用缺口应该补进 `nb-ui`，但展示页专用 Section/Header/Swatch 不进入组件库，避免过度设计。

已完成：

- `nb-ui` 新增 `Notification.vue`：
  - 支持 `info / success / warning / error` tone。
  - 支持 title、message、dismiss、action、默认 slot、title slot、action slot。
  - 使用现有 theme tokens 派生视觉，不引入新色板。
- `NotificationViewport.vue` 改为复用 `Notification.vue` 渲染 toast，静态通知和全局 toast 共享同一套外观。
- `FormCheckbox.vue` 改为 nb-ui 自绘 checkbox，保留真实 checkbox input、v-model、disabled、required、FormField context 和 aria 透传。
- `@notnotype/nb-ui/components` 导出 `Notification` 与 `NotificationTone`。
- `nb-fullstack-template /components` 重做为文档式 demo：
  - 每个展示区使用 `Panel`。
  - 静态反馈使用 `Notification`。
  - toast 只通过 `useNotification()` 展示行为。
  - 表单区展示默认、说明、错误、禁用和自绘 checkbox。
  - 控件区展示 SegmentedControl、SwitchField、Dropdown、IconButton。
  - Dialog 区展示普通和 busy 状态。
- `nb-ui` README 与模板 README 已同步。

验证结果：

- `nb-ui`
  - `bun run typecheck`：通过。
  - `bun run test`：3 files / 16 tests passed。
  - `bun run build`：通过；仅见 Nuxt/Rollup/Vue 上游 sourcemap / deprecation warning。
- `nb-fullstack-template`
  - `bun run typecheck`：通过。
  - `bun run test`：3 files / 5 tests passed。
  - `bun run build`：通过；产物包含 `components` 页面 chunk。

未执行：

- 浏览器视觉验证未执行，符合本轮约束。

## Verification / Test

基础契约修复后的验证结果：

- `nb-ui`
  - `bun install`：通过。
  - `bun run typecheck`：通过。
  - `bun run test`：通过，1 file / 2 tests passed。
  - `bun run build`：通过。
- `nb-fullstack-template`
  - `bun install`：通过。
  - `node_modules/@notnotype/nb-ui`：确认为指向 `C:\Users\notnotype\Documents\CodeRepository\GithubProjects\nb-ui` 的 symlink。
  - `bun.lock`：确认为 `@notnotype/nb-ui@link:@notnotype/nb-ui`。
  - `bun run typecheck`：通过。
  - `bun run test`：通过，1 file / 1 test passed。
  - `bun run build`：通过。
  - `$env:DATABASE_URL='file:./.agent/smoke-link.db'; bun run db:setup`：通过，迁移与默认 `admin` 初始化均非交互完成。

未执行：

- 浏览器验证未执行，符合本轮约束；如需要视觉和交互验收，后续再明确执行。

## TODO / Follow-ups

- 基础契约稳定后，再分批迁移 llmlint web 的重复基础组件。
- llmlint 试迁移稳定后，再规划 NeuroBook common 层分批迁移。
- 稳定后再决定是否发布到 npm；当前第一阶段仍保持 sibling 源码包 + Nuxt/Vite 转译，并通过 bun link 接入。

首轮实现验证结果：

- `cd ../nb-ui && bun install`：完成；Bun 输出过 `@parcel/watcher` lifecycle 提示但退出码为 0。
- `cd ../nb-ui && bun run typecheck`：通过。
- `cd ../nb-ui && bun run test`：1 file / 2 tests passed。
- `cd ../nb-ui && bun run build`：通过；Nuxt playground / Nitro 构建完成，有 Nuxt/Vue 依赖的 sourcemap 与 deprecation warning。
- `cd ../nb-fullstack-template && bun install`：初始错误写法 `link:../nb-ui` 失败；后续已改为正确的 `link:@notnotype/nb-ui` 主路径。
- `cd ../nb-fullstack-template && bun run typecheck`：通过，包含 `nuxt prepare` 与 `prisma generate`。
- `cd ../nb-fullstack-template && bun run test`：1 file / 1 test passed。
- `cd ../nb-fullstack-template && bun run build`：通过，Nuxt/Nitro 构建出 auth 与 health API route chunks。
- `cd ../nb-fullstack-template && bun run db:migrate`：首轮未完成，见上方计划出入；本轮已改为 `db:setup` 主路径，并通过临时 SQLite 数据库验证。
