# 内容节点当前状态规范 v0.1

## 定位

内容节点目录由 `index.md` 表达稳定设定，由同级 `state.md` 表达当前世界状态。`state.md` 是可选文件；缺失表示该节点暂无需要系统维护的当前状态。

本规范只定义当前状态，不定义状态变更记录、历史回放或自动世界模拟。

## 分工

- `index.md`：人物、环境、主题、叙事角度、语言风格等稳定设定。
- `state.md`：人物、物品、地点、组织等条目的当前状态，以及角色间信息差等可变状态。
- 剧情系统：情节与冲突。
- 叙事模块：读者知道什么、何时披露。

## 文件格式

`state.md` 使用 YAML frontmatter 加 Markdown 正文。

```markdown
---
statusNote: 已经知道凶手身份，但没有公开证据。
updatedAt: chapter-1
knowledge:
  - 所有王国公民都知道的常识。
  - 这是王国禁忌绝学，只有王室成员有资格学，[角色A](lorebook/character/A)什么时候偷学了。
  - [皇室成员B](lorebook/character/B)在成年的时候选择学习。
ext: {}
---

## 当前状态

当前位置、背包、目标、伤势、物品状态等细节写在正文中。
```

## 字段

- `statusNote`：当前状态摘要，可缺省。
- `updatedAt`：状态更新时间或剧情锚点；为空或缺省表示未记录。
- `knowledge`：角色间信息差。每项是自然语言字符串，可包含 Markdown 内容节点链接。
- `ext`：自由扩展对象；系统不依赖。

## 信息差

`knowledge[]` 直接使用自然语言字符串。主题默认是当前 `state.md` 所属内容节点，因此不再写 `subject`。

复杂情况也写成自然语言：

- `所有王国公民都知道的常识。`
- `这是王国禁忌绝学，只有王室成员有资格学，[角色A](lorebook/character/A)什么时候偷学了。`
- `[皇室成员B](lorebook/character/B)在成年的时候选择学习。`

内容节点只处理角色之间的信息差；读者信息差由叙事模块处理，不写入 `refs`。

## 校验

- `state.md` 不存在时不报错。
- `state.md` 存在但 frontmatter 非法时报 `invalid-state-frontmatter`。
- `state.md` 字段不符合 schema 时报 `invalid-state-field`。
- `knowledge[]` 字符串里的 Markdown 内容节点链接会按正文引用规则进行断链校验：优先 Project-relative path，也支持相对当前文件路径和当前 Project Workspace 内绝对路径。
- `workspace node validate --recursive <target>` 会递归校验目标目录下所有内容节点。
- 旧 URI 协议不作为状态引用目标。
