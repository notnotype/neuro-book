---
标签: [state:local, state:inject]
---

# TagInput

一组短文字的输入：每一项是一个淡底小块，末尾接着打字加新的一项。用在值本来就是一串名字的地方（地点、人物、标签），比一列输入框加“添加”按钮紧凑，放得进一行。与 `Input` 同一套尺寸与外观（带框的字段，或放在已有外框里原地编辑的 `bare`）。

## 布局

小块与末尾的输入依次排开，放不下时换行，高度随行数长（至少一个控件高）；小块不截断，很长的一项自己占一行。可以改的时候每个小块右边一个 ×。没有项时只有输入，显示 `placeholder`。

`390×844` 下结构不变，只是更早换行。

## 交互

- 在末尾的输入里打字，按 Enter，或打出分隔符（`,`、`，`、`、`）时，把打的字加成一项；粘贴含分隔符的文字时按分隔符拆成几项；输入框失焦时把没加的字加进去。去掉首尾空白，空的不加，与已有的项相同的不加。
- 输入法组字时的 Enter 与分隔符归输入法，不加项。
- 输入为空时按退格先选中最后一项，再按一次删掉它；左右方向键在项之间走，Delete 或退格删掉选中的项。点 × 删掉这一项。
- `readonly`：没有末尾的输入与 ×，项可以聚焦与复制。`disabled`：整体不可聚焦、降低不透明度。

## 数据

```ts
type TagInputSize = "sm" | "md";
type TagInputVariant = "default" | "bare";

type TagInputProps = {
    /** 受控值：各项的文字，按显示顺序。 */
    modelValue?: string[];
    /** 末尾输入的 id；空时取 `Field` 上下文的 id。 */
    id?: string;
    /** 缺省 "md"。 */
    size?: TagInputSize;
    /** 缺省 "default"（带框的字段）；"bare" 没有外框与左右内边距，同 `Input`。 */
    variant?: TagInputVariant;
    /** 没有项时末尾输入的占位；缺省空。 */
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    /** 出错外观与 `aria-invalid`；与 `Field` 上下文取或。 */
    invalid?: boolean;
    /** × 的名称，`{{item}}` 换成这一项的文字；缺省“移除 {{item}}”，按显示语言覆盖。 */
    removeLabel?: string;
};

type TagInputEmits = {
    /** 加了或删了一项；值已去掉首尾空白、去重。 */
    (event: "update:modelValue", value: string[]): void;
};
```

没有插槽与 expose。`aria-*` 与 `role` 落在末尾的输入上，其余透传属性落在根上。

`state:local`：末尾输入里还没加的字、选中的项。`state:inject`：经翻译端口取缺省文字。

## 上游边界

加项、删项、组字与项之间的键盘来自 reka-ui 的 `TagsInput`；本组件承诺的是上面写的分隔符、去空白、去重与外观。

## 不支持

拖动排序、改一项的文字（删掉重加）、候选补全、项数上限。
