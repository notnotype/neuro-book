---
标签: [state:local, state:inject, env:portal]
---

# ManageModelsDialog

“管理模型”对话框（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 10），参照 Cherry Studio 的“管理”。目录服务商列 OMP 目录里这家的模型，自定义服务商列拉取 `/models` 的结果（可“重新拉取”）；按系列分组，可搜索名称与 id。每行右边“+”加入、“−”移出，改动留在对话框里，“完成”时把加入的候选与移出的 id 一次经 `done` 交出，没有改动时直接关掉。缺字段的候选标“要补字段”（加入后停用，在编辑对话框里补）。移出被角色用着的模型时行下先确认，列出会变成未绑定的角色。读候选失败时原位写原因（没有密钥、不支持、鉴权失败、连不上）。

## 数据

```ts
interface ModelCandidate {id: string; name: string; vision: boolean; reasoning: boolean; incomplete: boolean}
defineProps<{
    open: boolean;                                         // 受控；每次打开从 current 重来
    providerName: string;
    discoverable?: boolean;                                // 有“重新拉取”，缺省 false
    candidates: readonly ModelCandidate[] | null;          // null 是还在读
    current: readonly string[];                            // 列表里已有的 id
    roleUsage?: ReadonlyMap<string, readonly string[]>;    // 缺省空
    error?: string;                                        // 读候选或写入失败的原因，缺省空
    busy?: boolean;                                        // 缺省 false
}>();
defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "refetch"): void;
    (e: "done", change: {add: ModelCandidate[]; remove: string[]}): void;   // 父组件写入成功后关掉
}>();
```

没有 slots 与 expose；attrs 落在 `Dialog` 的面板上。

## 隐藏通道理由

- `state:local`：搜索词、加入与移出的草稿、哪一行在确认。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：nb-ui `Dialog` 传送到 `body`。
