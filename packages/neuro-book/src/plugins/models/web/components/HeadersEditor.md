---
标签: [state:local, state:inject]
---

# HeadersEditor

服务商与模型的自定义请求头（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 5）：一行一个名称与值，可加可删。行数组是组件自己的草稿，没填完的行留在原处、标出原因，不写；合格的行（名称非空、不分大小写不重复、值非空）在失焦、回车或删行时一起经 `commit` 交出，与当前值相同时不交。值可以写 `env:<变量名>`；名称像凭据而值不是 `env:` 时提示改用环境变量。

## 数据

```ts
defineProps<{
    headers: Readonly<Record<string, string>>;   // 已保存的值（受控）；别处改了时合格的行换成新值，没填完的行留着
    disabled?: boolean;                          // 缺省 false
    hint?: string;                               // 添加按钮旁的淡色提示，缺省不显示
}>();
defineEmits<{(e: "commit", headers: Record<string, string>): void}>();
```

没有 slots 与 expose，attrs 落在根元素上。

## 隐藏通道理由

- `state:local`：行数组草稿（没填完的行不能交给父组件，交了就是写进设置）。
- `state:inject`：文字经宿主注入的翻译端口取。
