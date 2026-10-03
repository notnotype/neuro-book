# Markdown Studio

Markdown Studio 是正文和设定的主编辑区。

它的立场很明确：**Markdown 文件是长期真相源**，编辑器只是视图。你的稿子始终是磁盘上一堆能用任何编辑器打开的 `.md` 文件，不是数据库里的私有格式。

## 两种编辑模式

| 模式 | 适合 |
| --- | --- |
| 富文本 | 专心写作。所见即所得，不被语法干扰 |
| 源码 | 精确处理 Markdown、frontmatter、引用和方言标签 |

两种模式编辑的是同一个文件，随时切换。

::: tip frontmatter 是什么
文件开头用 `---` 包起来的一段配置，用来记录这个文件的元信息，比如它属于哪一章。你通常不用手写，系统会维护。
:::

## 扩展语法

在标准 Markdown 之上，NeuroBook 加了几个写小说真正用得上的标签。

**批注**——写作时给自己或给 AI 留意见，不进正文：

```markdown
她抬头<comment body="这里节奏太快">看了他一眼</comment>。
```

开闭标签各占一行时，批注作用于整段：

```markdown
<comment body="整段视角混乱，需要重写">
这里是一整段正文。
</comment>
```

**注音**——拼音、假名、术语原文、短译文：

```markdown
远处站着<ruby text="hàn zì">汉字</ruby>先生。
```

**双语对照**——整段译文对照：

```markdown
<bilingual text="老人缓缓走向祭坛。">
The old man walked slowly toward the altar.
</bilingual>
```

**可渲染 HTML**——只有显式的 `<html>` 块会真正渲染，默认先显示为源码卡片，点击才渲染，且运行在沙箱里：

```markdown
<html>
<div style="text-align:center">一封信的排版</div>
</html>
```

`<html>` 之外的未知 HTML 标签**不会丢失也不会渲染**，只保留源码。这是有意设计——粘贴进来的网页片段不会突然在你的稿子里执行。

::: tip 宽容形态
开标签黏在正文后面紧跟换行这种写法（人和 AI 都容易写出来），编辑器读入时会自动规范化成标准形态，不用你手动改。
:::

## Inline AI

选中一段文字，直接在编辑器里唤起 AI 修改：流式预览、原地替换、不打断主编辑流。

关键设计是**它不占用主会话**：Inline AI 跑在独立的后台会话上，发送后不会自动弹开右侧 Agent 面板，也不会切换你正在进行的主对话。你可以在 PromptBar 里选择当前项目的 Inline AI 会话、新建会话，或者临时换个模型。

## 输入与保存

编辑器做了防抖：打字时不会每敲一个键就全文序列化一次。防抖窗口会在失焦、`Ctrl+S`、提交或切换模式时结算。

**外部修改的处理**：如果 Agent 或其他工具改了你正在编辑的文件，系统会先结算你的输入再取快照，不会用磁盘内容盖掉你刚敲的字。真正冲突时（保存乐观锁失败）会弹出对比界面让你选。

## 文件之外

编辑器里看到的文件树就是 Project Workspace 的真实目录：

- `lorebook/`：稳定设定
- `manuscript/`：正文章节
- `world-engine/`：世界引擎配置

Agent 也按同样的路径读写。**你看到的和 AI 看到的是同一套文件**，没有隐藏的中间层。

## 继续阅读

- [Markdown 方言完整规范](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/content/markdown-dialect.md)
- [llmlint 文风检查](/core/llmlint)：写完之后给稿子做 lint。
- [认识你的小说工作台](/tutorials/01-studio-tour)：界面导览。
