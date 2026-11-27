---
标签: [state:local, state:inject]
别名: ["条目选择器", "Entry Picker"]
---

# EntryPicker

按名字或别名找一个条目、选中它的输入框（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 的引用字段、新建对话框的上级与另一个身份、移动对话框、列表元素的键）。作品里的条目可能有几百个，不一次读进下拉：每次打字按搜索词去世界里查（`findEntries`），列出名字或别名含这个词的条目。受控零件：搜索词经 `search` 交给宿主，宿主用同目录 `entry-picker.ts` 的 `useEntryFind` 去抖、丢掉晚到的旧结果，把这一次的结果经 `results` 传回。它在 nb-ui `SearchSelect` 之上加的是：按查找的状态写提示，停用的条目，以及选不到想要的条目时列表末尾的“新建”。

## 布局与交互

外框、列表、键盘与焦点就是 nb-ui `SearchSelect` 的远程模式（同名 `.md`），这里只写它加上的：

- 打开列表时发出一次空搜索词，之后每次打字发出搜索词。`useEntryFind` 的做法：空词立刻查，打字停 200 毫秒再查；新的一次查找开始后，更早的结果到了也丢掉。
- 查找中（`results` 不是 `done`、`failed`）列表里写“正在查找……”；没有结果写“没有匹配的条目”；查找失败写“查找失败：原因”，再打字会重查。
- 每一行：名字，右侧是种类与说明（例如“还没出场”“别名：小瑕”）。`exclude` 里的条目照样列出但停用，右侧写 `excludeReason`。
- 给了 `createKind`、`results` 是按输入框里现在的搜索词查的、搜索词不是空的、结果里没有与它同名的条目时，列表末尾多一行“新建‘搜索词’”（右侧写种类），选它发出 `create`，不改值；宿主建好以后把新条目的 id 写回 `modelValue`。
- 可清空（缺省可以）：已选时外框里有清空按钮，点了发出 `null`。
- 输入框显示当前值的名字：当前值在这一批结果里时用结果里的名字；在这里选中的那一项，组件记着它的名字（结果换成下一次查找的、搜不到词后离开都不丢）；别的情况用 `selectedName`（宿主在打开时读到的当前值的名字）。

## 数据

```ts
/** 一个候选条目。 */
interface EntryCandidate {
    readonly id: string;
    readonly name: string;
    /** 种类（人物、知识点这类）；没有时不写。 */
    readonly kind?: string;
    /** 右侧的一句说明，例如“还没出场”“别名：小瑕”。 */
    readonly note?: string;
}

/** 这一次查找到哪了；`done` 记下是按哪个词查的。宿主用 `useEntryFind(find)` 得到它。 */
type EntryResults =
    | {readonly kind: "idle"}
    | {readonly kind: "searching"}
    | {readonly kind: "done"; readonly query: string; readonly items: readonly EntryCandidate[]}
    | {readonly kind: "failed"; readonly reason: string};

type EntryPickerProps = {
    /** 选中的条目 id；null 是没选。受控。 */
    modelValue: string | null;
    /** 当前值的名字；当前值不在这一批结果里时输入框显示它。 */
    selectedName?: string;
    results: EntryResults;
    /** 列出但停用的条目 id（自己、已经在列表里的）。 */
    exclude?: readonly string[];
    /** 停用的条目右侧写的话；缺省“不能选”。 */
    excludeReason?: string;
    /** 给了就可以就地新建这个种类的条目。 */
    createKind?: string;
    placeholder?: string;
    /** 缺省 true。 */
    clearable?: boolean;
    id?: string;
    disabled?: boolean;
    readonly?: boolean;
    invalid?: boolean;
};

type EntryPickerEmits = {
    /** 选中一个条目时发出 id，清空时发出 null。 */
    "update:modelValue": [value: string | null];
    /** 选了“新建”那一行：发出搜索词（去掉首尾空白）。 */
    create: [name: string];
    /** 打开列表时发出空串，之后每次打字发出搜索词。 */
    search: [query: string];
};
```

没有插槽与 expose。`class`、`style` 与其余 attrs 照 `SearchSelect` 落在外框与输入框上。

用法：

```vue
<script setup lang="ts">
const finder = useEntryFind(() => (query) => world.findEntries({query, kinds: targets}));
</script>
<template>
    <EntryPicker v-model="value" :results="finder.results.value" @search="finder.search" />
</template>
```

## 状态

- **没选**：输入框空，显示占位文字（缺省“找一个条目”）。
- **已选**：显示名字；可清空时有清空按钮。
- **查找中、没有结果、查找失败**：见上文。
- **只读、停用、出错**：同 `SearchSelect`。

## 不支持

- 多选。
- 不经查找、一次列出全部条目：条目多时不可行。
- 在选择器里填新条目的其它字段：只给名字与种类，其余在条目页里填。

## 隐藏通道理由

- `state:local`：输入框里现在的搜索词（判断结果是不是按它查的）。
- `state:inject`：经 canon 的翻译端口取“正在查找”“没有匹配的条目”“新建”这些字。
