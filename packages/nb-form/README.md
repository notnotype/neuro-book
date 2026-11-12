# @notnotype/nb-form

按数据 schema 画表单。行为合同：[`docs/specs/ui/forms.md`](../../docs/specs/ui/forms.md)。

```ts
import {checkDescription, resolveForm, validateForm} from "@notnotype/nb-form";

const check = checkDescription(schema, {policy: "agent"});   // 模型生成的描述先过检查
const model = resolveForm(schema);                           // 字段树与选中的控件
const issues = validateForm(model, value);                   // 问题按字段路径给出
```

描述是 TypeBox 生成的、或手写的同等 JSON Schema；界面提示写在 `x-form` 里（见 Spec 的“输入与前置条件”）。

Vue 渲染层（`@notnotype/nb-form/vue`）：

```vue
<SchemaForm :schema="schema" v-model="value" :options="{providers}" />
<SchemaField :schema="setting" v-model="value" :id="rowId" bare />
```

组件合同见 [`SchemaForm.md`](src/vue/SchemaForm.md)、[`SchemaField.md`](src/vue/SchemaField.md)。

## 文字与语言

描述里的文字（标题、说明、占位、单位、选项名、调用方问题的文字）是 nb-ui 的文字值：字符串、目录里的键（`TextRef`），或按语言给出的映射。表单自己的文字（“添加”、问题汇总、按码写出的问题等）在本包自带的消息目录里，命名空间 `nb-form`，源语言 zh-CN（[`docs/specs/ui/i18n.md`](../../docs/specs/ui/i18n.md)）。

- **有宿主**：宿主经 nb-ui 的 `TEXT_PORT_KEY` 注入翻译端口，并登记本包的目录；语言以端口为准，`locale` 属性不起作用。

  ```ts
  import {NB_FORM_CATALOGS, NB_FORM_NAMESPACE} from "@notnotype/nb-form/locales";
  engine.register(NB_FORM_NAMESPACE, NB_FORM_CATALOGS, "zh-CN");
  ```

- **没有宿主**（nbdev 面板、独立页面）：不用注入。`SchemaForm`、`SchemaField` 按 `locale`（缺省 zh-CN）用缺省端口，目录里没有的语言显示中文；描述里写别的命名空间的键时，那份目录要先用 nb-ui 的 `registerDefaultCatalog` 登记进缺省端口，否则显示键名。

核心（`@notnotype/nb-form`）没有目录：`resolveText(text, locale)` 只解析字符串与语言映射，遇到 `TextRef` 返回键名作兜底；界面上的文字由 Vue 层经端口翻译。调用方要在自己的位置写出问题时，在组件的 `setup` 里 `useFormText()` 取得表单所用的端口，交给 `describeIssues(schema, value, issues, text, hints?)`。

## 安装

```bash
bun add @notnotype/nb-form
```

只支持 Bun。包里是 TypeScript 与 `.vue` 源码，不带编译产物，由宿主的 Vite 与 Tailwind v4 编译（[ADR 0028](../../docs/adr/0028-tailwind-only-host-compiles-nb-ui.md)、[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。只用核心入口（描述、检查、解析、校验）不需要别的包，只依赖 `typebox`。用 `./vue` 的宿主自己装 `vue`、`@notnotype/nb-ui` 与 `typescript`（编译单文件组件时解析导入的 props 类型要用）：这三个是可选的 peer 依赖，Bun 不会自动装；宿主另装 `vite`、`@vitejs/plugin-vue`、`tailwindcss` 与 `@tailwindcss/vite`。只用核心、又对本包的源码做类型检查时，要装上 `@notnotype/nb-ui`：核心从它取文字值的类型（只取类型，运行时不加载）。许可证 AGPL-3.0-only。
