---
name: rp-v2-bootstrap
description: Bootstrap RP mode v2 for a project from zero to playable - RP world timeline init (worldKey=rp), character dossiers under rp/characters/, avatar creation with the user, opening prose, and optional state-view config. For rp.leader hosting a project's first RP session.
when_to_use:
  - 用户在 RP 模式下开始一个还没有任何 RP 运行态的项目（rp/ 目录为空、rp 世界线无切片）。
  - 用户说「开始跑团」「进入 RP」「帮我捏个角色开新冒险」而项目尚未初始化。
  - RP 化身或关键 NPC 需要补建档案。
---

# RP v2 Bootstrap：从零到可玩

按顺序完成五步。每步都是幂等的——中断后重跑不会破坏已有内容。协议细节见已注入的 rp-v2 参考文档（README / world-contract / adjudication / character-memory）。

## Step 1：确认世界观材料 + 建目录骨架（rp/ 子树）

- 先建齐 `rp/` 目录骨架（幂等；缺哪个建哪个，各放一个说明用途的 README.md 占位）：`rp/manual/`、`rp/lorebook/`、`rp/characters/`、`rp/ticks/`。下游 agent 会按需读这些目录，骨架缺失会让它们白吃 ENOENT。
- 读 `rp/manual/README.md`、`rp/manual/player-guide/`、`rp/manual/gm-guide.md` 与 `rp/lorebook/` 核心设定。
- **材料缺失（新冒险）时，本 skill 不负责聊设定**：先走开团引导 `rp-v2-adventure-intake`（改编写作模式 lorebook 或从零问答共创，冒险企划书经用户确认后落盘 rp/manual/ + rp/lorebook/），再回到这里从 Step 2 继续。不要跳过引导空转生成。
- **RP 与写作模式完全分离**：仅开团引导改编路线允许在用户授权下从写作模式的 manual/、lorebook/ 一次性拷贝改编进 `rp/`；此后两份独立演化，运行时绝不跨读。**v2 没有 `rp/current.md`**——跨 Tick 状态全部由 World Engine 承载，不要建这个文件。

## Step 2：建立 RP 世界引擎配置 + 初始化世界线

先确认 `rp/world-engine/` 就绪：`schema/index.ts` 与 `calendar.ts`。缺失时由你用文件工具建立（rp.world 没有文件工具，建配置只能是你）。**直接抄下面的模板改字段**，不要自己发明导出格式：

`rp/world-engine/schema/index.ts` —— 必须导出名为 `WorldSchema`（或 default）的**普通对象**，键是 subject 类型名、值是 `z.object(...)`。不要包别的壳，不要导出函数：

```ts
import {z} from "zod";

/** 引用其他 subject：值形如 subject://some-id */
function Ref(targetType: string) {
    return z.string().regex(/^subject:\/\/[\w-]+$/).describe(`ref:${targetType}`);
}

export const WorldSchema = {
    world: z.object({
        era: z.string().default("复兴纪元").describe("纪元"),
        events: z.array(z.string()).default([]).describe("世界事件流水"),
    }),
    character: z.object({
        hp: z.number().int().default(100).describe("生命值"),
        位置: Ref("location").optional().describe("当前位置"),
        持有物: z.array(z.string()).default([]).describe("随身物品"),
        关系: z.array(z.object({对象: Ref("character"), 类型: z.string(), 好感: z.number().optional()})).default([]).describe("人际关系"),
        secret: z.object({}).passthrough().optional().describe("god-view 隐藏状态"),
    }),
    location: z.object({
        描述: z.string().default("").describe("环境要点"),
        连接: z.array(z.object({目标: Ref("location"), 方向: z.string().optional(), 距离: z.string().optional()})).default([]).describe("通路"),
    }),
} as const;
```

`rp/world-engine/calendar.ts` —— default 导出历法对象（按世界观改纪元名与格式）：

```ts
export default {
    type: "simple",
    eraBefore: "复兴纪元",
    eraAfter: "复兴纪元",
    baseUnit: "second",
    units: [
        {name: "minute", parent: "second", ratio: 60},
        {name: "hour", parent: "minute", ratio: 60},
        {name: "day", parent: "hour", ratio: 24},
    ],
    format: "{eraName}{day}日 {hour:02}:{minute:02}:{second:02}",
};
```

按题材增删 `character` 的字段（奇幻加装备/技能，现实向加好感度/关系即可），保留「位置」「关系」「连接」「secret」四个约定字段——地图/关系图面板与 secret 剥除都依赖它们。

然后 invoke rp.world，消息写明「初始化」并给出：纪年/开局时间、world subject 初始状态、化身与关键 NPC 的首切片事实（位置/关键数值/持有物）。要求它：

- 一律 worldKey="rp"（绝不碰写作模式主世界线）。
- 地点 subject 带 `连接` 字段、角色 subject 带 `关系` 字段（地图与关系图面板靠它们生长）；schema 不含这些字段时如实报告即可，不硬造。
- 隐藏状态放进 subject 的 `secret` 子对象。

## Step 3：角色建档（rp/characters/）

对化身与每个关键 NPC：

1. `rp_character_update op=ensure` 建骨架并登记注册表：**必须带 `name`（中文显示名）**，常用称呼放 `aliases`（如「子爵」「白发女孩」）；id 用简短小写拉丁串（如 `brauer`）。注册表按显示名防重复——同一角色第二次 ensure 换拼法会被拒绝并返回已有 id。之后全管线引用该角色只用注册表 id 或显示名。
2. 按 subject-creation-guide 方法论写 soul.md（第一人称扮演手册：我是谁/性格调色盘/说话方式/我知道什么/想要什么怕什么/不会做什么），`op=write_soul` 写入。**化身（player）的 soul.md 侧重身份与处境，性格留给用户输入**。
3. `op=write_mood` 写开局心境。
4. 开局已知的关键信息用 `op=add_knowledge` 落账（含来源）；开局就该有的戏剧反差交给 rp.screenwriter 用 `op=add_unknown` 登记。

## Step 4：开场白

生成开场白 Writer Brief（`<context>` 通常为空，`<beats>` 写化身入场/身体感/可见人物/第一选择点），创建 rp.writer 写入 `rp/ticks/000000-initial-state/prose.md`。终稿组装：正文链接 + 彩绘的元场景引导。

## Step 5（可选）：状态面板配置

用户想让侧栏角色卡更好看时，按 `world-engine-state-view` skill 写 `world-engine/state-view.json`（hp 配 progress、物品配 item-list 等）。RP 侧栏与 World Engine Workbench 都会消费它。

## 完成标准

- `rp/world-engine/` 配置就绪（schema + calendar，独立于写作模式）。
- rp 世界线有 world subject 与开局切片（RP 侧栏「世界」面板能显示时间与登场要素）。
- 化身与关键 NPC 在 rp/characters/ 下有 soul/心境/已知信息。
- `rp/ticks/000000-initial-state/prose.md` 已由 rp.writer 写入，用户收到开场白链接。
- 之后进入常规 Tick 流水线（见 rp-v2/README.md）。
