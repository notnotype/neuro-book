# NeuroBook 心情差分 · 动画

由 `brand/logo/tools/mood_anim.py` 生成（`produce.py` 导出），不要手改这里的文件。

## 文件

- `neurobook-mood.js`：网页组件 `<neurobook-mood>`，一个 JS 文件、不依赖库。切换状态播切换动画，平时循环；空闲时跟着鼠标看。
- `demo.html`：演示页，点状态看切换。
- `loop/neurobook-mood-<状态>.svg`、`-dark.svg`：每个状态单独循环播放的动画 SVG，不要脚本，可以直接当 `<img>` 用；没有切换动画和跟随鼠标。
- `video/neurobook-moods-tour.webm`：十一个状态轮播一遍的录屏，放在不能跑网页的地方（文档、聊天、社交媒体）；加 `--gif` 时另导出 `.gif`。

## 用法

```html
<script src="neurobook-mood.js"></script>
<neurobook-mood state="think" style="width:96px"></neurobook-mood>
<script>document.querySelector("neurobook-mood").state = "write";</script>
```

- `state`：状态键，见下表。`variant="dark"`：透明底，放在深色背景上。`paused`：停掉循环动画。
- 事件 `statechange`：`detail = { from, to }`。
- 系统设了减少动画时：不循环、切换不播动画、不跟鼠标。

## 状态和动作

| 状态 | 名称 | 动起来是什么样 | 动作表里的动作 |
| --- | --- | --- | --- |
| `focus` | 专注 | 眨眼，尾巴慢慢晃 | head: `none` |
| `think` | 思考 | 头轻轻左右偏，赤星之节外面的环慢慢转，光环上的流光绕圈 | head: `drift`, ring: `spin` |
| `write` | 写作中 | 书右上方露出一支笔在写（写两秒停一下），书跟着轻微抖，头一点一点，星轻轻脉动，笔旁边飘起小金点 | head: `nod`, book: `jitter`, pen: `scribble`, star: `pulse` |
| `done` | 完成 | 跳一下，星「咔」地转 90°，光环旁的星光闪 | head: `hop`, star: `click` |
| `ask` | 等你选择 | 歪头，停一会儿再回正，问号尾巴晃 | head: `tilt` |
| `error` | 出错 | 摇头，炸毛的尾巴发抖 | head: `shake` |
| `idle` | 空闲 | 呼吸；鼠标一动就睁眼看过来、头往鼠标那边歪，停下 2.5 秒后眯回去 | head: `breathe` |
| `sleep` | 睡着 | 深呼吸，z 往上飘 | head: `breathe_deep` |
| `idea` | 灵感 | 往上一冒，星闪一下、环转 90° | head: `pop`, star: `flash`, ring: `kick` |
| `shy` | 害羞 | 头往书后面沉一点，轻轻晃 | head: `shy` |
| `shy_more` | 羞到躲起来 | 头缩到书后面只露眼睛，微微发抖，头顶冒热气 | head: `tremble` |

尾巴的摆动跟着尾巴姿势走，眨眼、光环浮动、流光、进度、z、星光、金点、热气是各自部件的循环。

## 以后加动画、改动画

动画分三层，改哪层只动那一层：

1. **动作表**（`mood_anim.py` 的 `MOTIONS`）：每个动作是周期加关键帧 `K(进度, x, y, 角度, 缩放, 缓动)`，单位是标志的画布单位（100×100）。
   改幅度、节奏只改这里；组件（头、尾巴由 JS 按表算，书、笔、星、环用表生成的 CSS）和循环 SVG 都从这张表生成。
2. **状态表**：`moods.py` 的 `STATES`（眼睛、尾巴、光环、小符号）和 `LOOK`（下沉、粉耳朵等），`mood_anim.py` 的 `ANIM`（每个部件播哪个动作）和 `STATE_NOTES`（说明文字）。
   加一个状态：在这三处各加一行；要新部件（新眼睛、新尾巴姿势）先在 `mood_parts.py`、`mood_v4.py` 里画。
3. **播放**（`mood_anim.py` 里的 JS 模板）：只有加新种类的部件或新交互（像跟随鼠标）时才要改。

改完运行 `uv run --no-project --with shapely python tools/produce.py` 重新导出。

不改文件、在页面里临时加：`NeuroBookMood.defineMotion(名字, { period, keys })`、`NeuroBookMood.defineState(键, { from, name, motion })`，
在创建元素之前调用；已在页面上的元素调用 `el.rebuild()`。录屏、测试时 `NeuroBookMood.manual = true`，设 `NeuroBookMood.clock`，再 `el.tick()` 逐帧画。

动作表一览：

| 动作 | 周期 | 关键帧数 |
| --- | --- | --- |
| `none` | 1 s | 2 |
| `drift` | 4 s | 5 |
| `nod` | 2.8 s | 18 |
| `hop` | 2.2 s | 4 |
| `tilt` | 3.2 s | 5 |
| `shake` | 2.4 s | 9 |
| `breathe` | 3.6 s | 3 |
| `breathe_deep` | 4.2 s | 3 |
| `pop` | 2.6 s | 4 |
| `shy` | 3 s | 5 |
| `tremble` | 0.24 s | 4 |
| `jitter` | 2.8 s | 25 |
| `scribble` | 2.8 s | 15 |
| `spin` | 10 s | 2 |
| `pulse` | 1.1 s | 3 |
| `click` | 2.4 s | 4 |
| `flash` | 2.6 s | 4 |
| `kick` | 2.6 s | 4 |
| `tail_sway` | 5 s | 5 |
| `tail_sway_fast` | 2.4 s | 5 |
| `tail_sway_slow` | 7 s | 5 |
| `tail_quiver` | 0.36 s | 4 |
| `tail_flick` | 1.8 s | 6 |
