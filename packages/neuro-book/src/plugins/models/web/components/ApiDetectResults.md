---
标签: [state:local, state:inject, env:clipboard]
---

# ApiDetectResults

服务商详情“接口格式”下面的协议检测结果（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 21）：同一个地址上四种协议各试一次的结果，一行一种。通过的写耗时，失败的写状态码与归类后的原因、下面一行淡色写请求的路径与服务商原文的开头；当前用的那种标“正在用”，通过的其余几种有“用这个”，失败的有“复制服务商原文”。结果只对检测时的连接配置成立：快照里的连接版本既不是检测时的、也不是哪一行改用之后的，整块置灰、写“配置已改，请重新检测”，“用这个”停用。这家没有能用来检测的模型时，块里是一个填模型 id 的输入框与“检测”。

受控：检测的发起、取消与采纳都由页面做（`ProvidersPage` 持有状态，换服务商、离开页面时取消在途的检测）；组件只按 `state` 画。

## 状态

| `state` | 画什么 |
|---|---|
| `idle` | 不渲染 |
| `running` | 一行“正在试四种协议”，`aria-live="polite"` |
| `done`，连接版本对得上 | 四行结果；上面一行写用哪个模型试的 |
| `done`，对不上 | 同上，整块置灰，写“配置已改，请重新检测”，“用这个”停用 |
| `failed`，码 `no-model` | 说明、模型 id 输入框与“检测”（回车同样） |
| `failed`，其它码 | 红字写原因（`role="alert"`） |

## 布局

每行四格：状态图标、协议名、结果（耗时或失败原因）、动作；结果下面淡色一行是路径与原文开头（单行截断，悬停看完整原文）。宽度不到约 480px 时协议名与结果上下排，动作仍在行尾。

## 数据

```ts
export type ApiDetectState =
    | {readonly status: "idle"}
    | {readonly status: "running"}
    | {readonly status: "done"; readonly detection: ApiDetection}
    | {readonly status: "failed"; readonly code: string; readonly reason: string};

defineProps<{
    state: ApiDetectState;
    /** 快照里这家现在的连接版本（`SnapshotProvider.connection`）。 */
    connection: string;
    disabled?: boolean;       // 只读时停用“用这个”与“检测”，缺省 false
}>();
defineEmits<{
    (e: "adopt", api: ApiCheck["api"], connection: string): void;   // 点“用这个”：带这一行的连接版本
    (e: "detect", model: string): void;                              // 填了模型 id 后再检测
}>();
```

没有 slots 与 expose，attrs 落在根元素上。

## 交互

- “复制服务商原文”把这一行的原文写进剪贴板，按钮的名称换成“已复制”，直到下一次检测。
- 采纳之后快照的连接版本等于那一行的：结果照样有效，“正在用”移到那一行。

## 隐藏通道理由

- `state:local`：模型 id 输入框的草稿、“已复制”的提示。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:clipboard`：复制原文只在这一处用，交给页面转一道不多给任何能力。
