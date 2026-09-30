---
标签: [state:inject]
---

# LowCodeForm

由 `LowCodeFormDto` 驱动的受控设置表单：宿主只需提供字段定义和值对象，组件便按字段类型选择对应控件，并把用户修改映射回 JSON 对象。Project scope 还可用继承值和覆盖路径表达「跟随上层」或「项目自定义」，不需要宿主为每个字段手写表单布局。

## 布局与交互

字段按 `form.fields` 顺序纵向排列，每项之间留固定间距。每个字段由 `LowCodeFieldShell` 提供标签、描述、必填标记和 issues，再按 `component` 渲染对应字段控件；内容变多时表单自然增长，由外层宿主负责滚动。390px 窄屏下仍为单列布局，长说明和错误文字换行。

支持 text、textarea、number、switch、select、combobox、radio、checkbox 与 resource-preset 字段类型。字段变更通过 `update:modelValue` 回传新的 JSON 对象。`scope="project"` 且 `inheritanceMode="manual"` 时，字段行提供继承 / 覆盖切换；继承字段显示 `inheritedValue`（或字段默认值）并禁用编辑，覆盖字段显示 `modelValue`。用户编辑继承字段时自动创建字段 patch 并加入 `overridePaths`。切回继承时删除该字段 patch、覆盖路径及对应资源 mutations。`always-override` 下所有字段按覆盖处理，不显示手动切换入口。

## 数据

```ts
import type {
    LowCodeFormDto,
    LowCodeFormIssueDto,
    LowCodeJsonObject,
    LowCodeResourceMutationDto,
} from "nbook/shared/dto/low-code-form.dto";

type LowCodeFormScope = "global" | "project";
type LowCodeFormInheritanceMode = "manual" | "always-override";

interface LowCodeFormProps {
    /** 字段定义和 defaults；必填。 */
    form: LowCodeFormDto;
    /** 当前编辑 JSON 对象；必填、受控，无默认值。 */
    modelValue: LowCodeJsonObject;
    /** 服务端或宿主提供的问题；默认 []。 */
    issues?: LowCodeFormIssueDto[];
    /** 配置作用域；默认 "global"。 */
    scope?: LowCodeFormScope;
    /** Project 字段继承策略；默认 "manual"。 */
    inheritanceMode?: LowCodeFormInheritanceMode;
    /** Project scope 下的上层有效值；默认 {}。 */
    inheritedValue?: LowCodeJsonObject;
    /** 当前已覆盖字段路径；默认 []。 */
    overridePaths?: string[];
    /** 已暂存资源修改；默认 []。 */
    resourceMutations?: LowCodeResourceMutationDto[];
    /** 禁用整张表单；默认 false。 */
    disabled?: boolean;
}

interface LowCodeFormEmits {
    /** 字段值修改或切换至继承时发出新的表单 JSON 对象。 */
    (event: "update:modelValue", value: LowCodeJsonObject): void;
    /** Project 手动继承 / 覆盖切换或继承字段首次编辑时发出新路径列表。 */
    (event: "update:overridePaths", value: string[]): void;
    /** 资源预设字段产生或清除本地 mutation 时发出新 mutation 列表。 */
    (event: "update:resourceMutations", value: LowCodeResourceMutationDto[]): void;
}
```

没有 slots 或 `expose`。未声明 attrs 按 Vue 默认落在最外层 grid `div`。表单不持有受控值；所有三个事件都由宿主处理并在需要时回传对应 prop。

## 状态与边界

- 默认 global scope：字段从 `modelValue` 按点路径取值，缺失时回退 `form.defaults`，再回退字段 `defaultValue`。
- Project 手动继承：未覆盖字段取 `inheritedValue`，缺失时回退表单默认值；未覆盖且没有已有 patch 的字段禁用。覆盖字段读写 `modelValue`。
- disabled：所有子字段收到禁用状态；资源预设字段的交互入口也随之禁用。
- issues：按 `path` 分派到对应字段；组件还会为非空选项中的失效 select / combobox / radio / checkbox 值合成 `unavailable_option` warning。其它格式验证由宿主提供，不在此组件执行。
- 空表单：不渲染字段，只保留空 grid；无单独空态文案。
- 组件没有加载态或表单级错误 UI；加载和提交失败由宿主负责。

## 不支持

- 不读取或写入 store、浏览器存储，不发起请求，也不提交或校验表单。
- 不负责从服务端加载 schema / values；字段列表和所有数据都由 props 提供。
- 不提供自定义字段插槽；新增字段类型需在表单数据模型与字段控件分发处共同实现。

## 上游边界

`LowCodeFieldShell` 负责标签、必填标记、描述、actions 插槽与字段 issues；各字段控件定义其具体交互。`LowCodeResourcePresetField` 子组件可能为确认操作渲染 nb-ui Dialog portal；这是子组件的环境通道，不计入 `LowCodeForm` 自身标签，本表单只负责转发它的 mutation 更新。字段控件和 nb-ui 上游未声明的键盘、焦点与视觉细节不属于本表单合同。

## 隐藏通道理由

`state:inject`：组件调用 `useI18n()` 生成不可用选项的提示文案，复用应用语言设置而不要求宿主逐条传译文。除此之外表单字段、值与更新出口都来自明面 props / emits；`LowCodeResourcePresetField` 的 `env:portal` 属于子组件，不在此重复标记。
