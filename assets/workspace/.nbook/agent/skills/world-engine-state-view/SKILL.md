---
name: world-engine-state-view
description: Author and maintain the World Engine state overview view config (world-engine/state-view.json) so the Workbench 状态总览 panel presents this project's subjects (characters, locations, items, relations) with genre-appropriate widgets. Covers config schema, bounded widget list, auto-inference fallback, and validation.
when_to_use:
  - World Engine 初始化完成 subject schema 设计后，为项目生成配套的状态总览视图配置。
  - 用户说「状态面板太乱」「我想让 hp 显示成血条」「把装备显示成标签」「隐藏某个属性」。
  - 项目 schema 新增/改名了 subject 属性，需要同步视图配置。
  - 用户反馈状态总览面板显示了「配置 N 处问题」警告。
---

# World Engine 状态总览视图配置

World Engine Workbench 的「状态总览」面板按 Project 的 `world-engine/state-view.json` 决定各 subject 的展示方式。**没有配置也能用**（按 schema 自动推断 widget），配置的价值是让面板贴合题材：奇幻的 hp 显示成血条、现实题材的好感度显示成进度条、装备显示成标签、关系显示成可跳转引用。

这是一个普通项目文件，用 write/edit 直接编辑即可。配置改坏不会破坏面板——前端逐字段校验，非法字段丢弃并回退默认渲染，同时在面板上显示「配置 N 处问题」。

## 配置文件结构

路径：`world-engine/state-view.json`（当前 Project Workspace 相对路径）

```jsonc
{
  "version": 1,
  "types": {
    "character": {                       // key = subject type（与 schema 一致）
      "icon": "user",                    // lucide 图标名，可省略
      "label": "角色",                    // 分类显示名
      "titleAttr": "名字",                // 卡片标题用哪个属性（缺省用 subject name）
      "order": 1,                        // 分类排序，小的在前（world 默认最前）
      "pinned": ["hp", "位置"],           // 卡片顶部直接露出的关键属性
      "sections": [                      // 详情分组；未列出的属性自动归入「其他」
        {"title": "战斗", "attrs": ["hp", "mp", "技能"]},
        {"title": "持有", "attrs": ["物品", "装备"]}
      ],
      "display": {                       // 每个属性的展示配置
        "hp":   {"widget": "progress", "max": 100, "color": "danger"},
        "装备": {"widget": "chips"},
        "物品": {"widget": "item-list"},
        "位置": {"widget": "ref"},
        "内部备注": {"hidden": true}
      }
    }
  }
}
```

## widget 清单（有界，只能从中选）

| widget | 适用 | 说明 |
| --- | --- | --- |
| `text` | 字符串标量 | 默认文本 |
| `number` | 数值标量 | 等宽字体数值 |
| `progress` | 有上限的数值 | 进度条；**必须配 `max`**；`color` 可选 accent/danger/warning/success |
| `badge` | enum / boolean | 胶囊标签；编辑时变成下拉 |
| `chips` | 标量数组 | 标签组（技能、装备名、称号） |
| `item-list` | 对象数组 | 名称+数量列表（物品栏）；对象里有 name/title/id 字段作为显示名，count/数量 作为数量 |
| `ref` | desc 为 `ref:<type>` 的属性 | 显示引用目标名称；编辑时从该 type 的 subject 下拉选择 |
| `json` | 复杂对象 | JSON 展示与编辑（兜底） |

自动推断规则（不配 widget 时）：`ref:` desc → ref；enum/boolean → badge；数值 → number；标量数组 → chips；对象数组 → item-list；object → json；其余 → text。**因此只需要为「推断不出的意图」写配置**，典型的就是 progress（推断不出 max）和分组/置顶/隐藏。

## 编写流程

1. 读取项目 schema（`world-engine/` 下的 schema 定义或用 execute_world 查 subject type 与属性）确认每个 type 有哪些属性、类型、desc。
2. 按题材判断展示意图：哪些是用户最关心的（→ pinned），哪些有上限数值（→ progress + max），哪些是收集品（→ chips/item-list），哪些是内部字段（→ hidden）。
3. write `world-engine/state-view.json`。**只引用 schema 中真实存在的属性名**；引用不存在的属性会被前端跳过并计入「配置问题」。
4. 告知用户到 World Engine Workbench 的「状态总览」视图查看效果；有「配置 N 处问题」提示时读取提示逐条修正。

## 红线

- 不要发明 widget 名；不在清单里的值会被丢弃并回退自动推断。
- `progress` 不配 `max` 等于没配（会回退 number）。
- 配置只管展示，不改变 World Engine 数据；不要试图在配置里写入状态值或公式。
- schema 属性改名后同步更新配置，否则旧属性名会变成「配置问题」。
