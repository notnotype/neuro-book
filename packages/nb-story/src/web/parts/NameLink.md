---
标签: ["state:inject"]
---

# 人名链接

把一个人物或事物的名字写成带淡底色的可点文字，点了在抽屉里打开它的人物卡（docs/specs/story/viewer.md 输出 20），不离开当前页。Ctrl（macOS 上 ⌘）点开在另一半（输出 67，不传页签：另一张里已开着的人只激活、不改它的页签）；右键弹出书的外壳里共用的菜单，里面是“在旁边打开”，窄档没有这个菜单，照常是浏览器自己的。

## 数据

```ts
defineProps<{
    /** 点的 id（查询结果里 NodeRef 的 id）。必填。 */
    id: string;
    /** 显示的名字。必填。 */
    label: string;
    /** 打开人物卡时停在哪个页签，缺省 "summary"。 */
    tab?: "summary" | "relations" | "records" | "episodes";
    /** 加粗（主要人物），缺省 false。 */
    strong?: boolean;
}>();
```

没有 emits、slots、expose；attrs 透传到按钮上。

## 隐藏通道理由

`state:inject`：经 `useBook()` 调 `openCard`、`openBeside`，理由同 RefLink：名字到处都是，人物卡属于书的外壳。右键经注入的 `NAME_MENU` 打开外壳里共用的那一个菜单：每个名字各挂一个菜单太重，菜单也属于外壳。卡片里的名字拿到的会话是详情外壳的代理，`openCard` 换它所在的那张。

## 注意事项

点击会 `stop` 冒泡。
