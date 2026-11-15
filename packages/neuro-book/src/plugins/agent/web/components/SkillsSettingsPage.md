---
标签: [state:local, state:inject]
---

# SkillsSettingsPage

设置窗口里的“Skill”页（[`agent/skills.md`](../../../../../../../docs/specs/agent/skills.md) 输出 25、34）：列出 Skill 目录，按来源分组，未初始化的能初始化，每个都能打开它的 `SKILL.md`。页面只画目录与发出动作；取目录、确认框、打开文件与文件夹由页面包装（`skills-page.ts`）做。

## 布局

- 页头只有“打开 Skill 文件夹”，靠右。
- 分组：“我的 Skill”在前，然后每个插件一组（组头是插件的显示名，没有时写插件 id；按名字排），“内置”在后；组里没有 Skill 时整组不画。组标题下一条分割线。分组与 Profile 设置的 Skill 一节共用 `groupSkills`。
- 整页一张网格，各组各行经子网格共用五列（[UI 规范](../../../../../../nb-ui/docs/ui-development-spec.md)“几何、排版与动效”第 6 条）：名字与说明（伸缩）、状态徽标、“初始化”、“打开”、展开按钮。某一行没有徽标或“初始化”时那一格空着，别的行的按钮不挪。
- 一行两行字：名字；下面一行是说明，无效的与上次初始化没成功的换成原因（无效的用危险色）。说明与原因单行截断，悬停看全文。
- 状态徽标只在不是“可用”时出现：未初始化（警告色）、正在初始化（带转圈）、无效（危险色）。
- 展开后在这一行下面占满整行：许可、兼容性、外部依赖、metadata、上次安装的输出（上次初始化没有成功时，等宽、按原样分行）、位置，没有的项不列。
- 没有 Skill 时，页头之下是居中的一句说明：怎样把 Skill 放进来、之后怎样用。
- 还没取到目录时，页头之下是居中的转圈加“正在读取 Skill…”。
- 页面窄于 480px 时，名字与说明占满第一行，徽标与按钮落到第二行、仍在各自的列里（按钮列不收）；说明照样单行截断。

## 交互

- “初始化”发出 `init(id)`，包装弹确认框（`SkillInitDialog`）。
- “打开”发出 `open(id)`。没有 `SKILL.md` 的无效 Skill 不能打开（按钮不可用）。
- 展开按钮切换这一行的详情，`aria-expanded` 随之变化；展开状态是页面自己的，目录刷新后同一个 id 的行保持展开。
- “打开 Skill 文件夹”发出 `open-folder`。

## 数据

```ts
import type {SkillEntry} from "../../shared/skills";

type SkillsSettingsPageProps = {
    /** null：还没取到 */
    entries: readonly SkillEntry[] | null;
};

type SkillsSettingsPageEmits = {
    (e: "init", id: string): void;
    (e: "open", id: string): void;
    (e: "open-folder"): void;
};
```

没有插槽与 `expose`，属性不透传。

## 隐藏通道理由

- `state:local`：哪些行展开着。
- `state:inject`：文字经 Agent 插件的翻译端口取（`useAgentPageText`），原因按码换成文字。

## 不支持

- 在页里改 Skill、删除 Skill：用户在 Skill 文件夹里改。
