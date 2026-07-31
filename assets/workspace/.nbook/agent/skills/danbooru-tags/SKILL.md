---
name: danbooru-tags
description: |
  Validate Danbooru hard anchors for Anima generation: artists, characters, series/IP, appearance, clothing, props, poses, expressions, scenes, and random candidates.
  Not for composition, prompt writing, or workflow execution.
---

# danbooru-tags

纯标签检索工具。不决定构图、不写 prompt、不执行 workflow。

## 硬约束

- 始终使用本地 `bin/danbooru-tags.exe`，不搜索、不递归。
- 默认先用已知/推断出的 Danbooru canonical tag 精确查询。
- 精确查询查不到时，才进入同组别名、拆分词、候选词补查。
- 候选池和随机池不是默认入口；仅在用户要求随机/抽卡，或精确补查仍缺失时使用。
- `confirmed_tags` 可用于回填（仍需意图筛选）；`candidate_tags` 仅作候选，必须筛选。
- `missing` → 写入 nltags。
- 不决定构图、镜头、光影、workflow 执行。
- 不写完整 prompt。
- 非 artist category 的 tag 不加 `@`，不作为画师。
- 随机角色/服装/姿势/场景候选不使用 `--for-prompt`。

## CLI 位置

```powershell
$SKILLS_ROOT = $env:COMFYUI_GOOD_ANIMA_SKILLS_DIR
if (-not $SKILLS_ROOT) { throw "COMFYUI_GOOD_ANIMA_SKILLS_DIR is required" }
$TAG_ROOT = Join-Path $SKILLS_ROOT "danbooru-tags"
$cli = Join-Path $TAG_ROOT "bin/danbooru-tags.exe"
```

不搜索递归。不使用旧路径。

## 检索优先级

按顺序执行：

1. **精确验证**：先用模型已知、用户给定或已解析的 canonical tag 查询。
   - 默认 `--match-mode auto`：先 exact，exact 无命中才 fuzzy。
   - 只允许直接命中时使用 `--match-mode exact`。
   - artist：`--group artist --prefix "@artist name"`
   - character：`--group character --keyword "character name"`
   - series/IP：`--group series --keyword "series name"`
   - general hard anchor：`--group <group> --keyword "tag phrase"`
2. **小范围补查**：精确验证无命中时，只补同一语义锚点的别名、英文名、拆分词。
3. **候选池**：补查仍无命中，且该锚点必须落成 tag 时，才取同 group 候选。
4. **nltags**：复合概念、关系、构图、光影、查不到的自然语言描述写入 nltags。
5. **随机池**：仅用户明确要求随机/roll/抽卡时调用。

禁止：

- 不先精确验证就直接查候选池。
- 不把 group 候选整批塞进 prompt。
- 不为普通描述扩展大候选池。
- 不为同一锚点连续循环补查。

## 批量查询（生图前默认）

默认批量只放精确验证项和必要的小范围补查项。JSON 必须 UTF-8 without BOM：

```powershell
$json = @{
  queries = @(
    @{ id = "character"; group = "character"; keyword = "kanade tachibana"; limit = 5 },
    @{ id = "series"; group = "series"; keyword = "angel beats"; limit = 5 },
    @{ id = "artist"; group = "artist"; prefix = "@mignon"; limit = 5 }
  )
} | ConvertTo-Json -Depth 20
$file = Join-Path $env:TEMP "danbooru_batch.json"
[System.IO.File]::WriteAllText($file, $json, [System.Text.UTF8Encoding]::new($false))
& $cli --batch-file $file --batch-workers 8 --for-prompt --json --compact
```

## 单查

```powershell
# 画师
& $cli --group artist --prefix "@mignon" --limit 5 --for-prompt --json --compact

# 角色
& $cli --group character --keyword "hakurei reimu" --limit 5 --for-prompt --json --compact

# 只做直接命中验证，不返回模糊候选
& $cli --group character --keyword "hakurei reimu" --match-mode exact --limit 5 --for-prompt --json --compact
```

## 随机

| 意图                    | 命令                                       | 输出字段                    | 数量 |
| ----------------------- | ------------------------------------------ | --------------------------- | ---- |
| 抽 N 候选画师挑 1       | `--random N --json`                        | `random_artists`            | N 条 |
| 角色/服装/姿势/场景候选 | `--random N --group <group> --json`        | `random_tags`               | N 条 |
| 随机 1 画师直接生图回填 | `--random 5 --for-prompt --json --compact` | `random_artists_for_prompt` | 1 条 |

规则：

- 候选池用 `--random N --json`，生图回填用 `--random N --for-prompt`（只返回 1 条），不混用。
- `--for-prompt` 不允许与 `--group` 一起用。
- N 使用 10–50，上限 300。只调用一次，不循环。
- 不向用户复述完整候选 JSON。

## 批量规则

- 同一锚点优先放 canonical 主词；别名、拆分词只在主词不稳或无命中风险高时加入。
- 精确 artist/character/series 查询 `limit=5`。
- 服装/动作/场景/俗称 `limit=10–20`。
- 普通生图 ≤4 语义锚点；稳定 canonical 每锚点 1 个 query，不稳定锚点最多 2–3 变体，总 query 4–12。
- 最多 1 次批量 + 1 次补查。
- group 漏匹配时同批加 `category=general` 变体。
- general 命中仅作 `candidate_tags`。

## 查 vs 不查

**查：** 用户指定角色/作品/画师、关键服装/道具/姿势、随机候选、已解析 canonical 候选需确认。

**不查（写 nltags）：** 普通自然语言描述、光源方向、前景/中景/背景、脸部清晰/故事关系/氛围。

## 输出读取

- `confirmed_tags` — 可回填，仍需意图筛选。
- `confirmed_tags` 只来自 `exact_tag`、`exact_alias`、artist `prefix`。
- `candidate_tags` — 模糊补查或回退候选，必须筛选，不直接回填。
- `missing` — 写 nltags。
- 不向用户复述完整搜索过程。

## JSON 输出 schema

### 单查 `--for-prompt --json --compact`

```json
{
  "found": true,
  "confirmed_tags": {
    "characters": [
      {
        "tag": "hakurei_reimu",
        "prompt_tag": "hakurei reimu",
        "category": "characters",
        "source_category": "characters",
        "count": 65105,
        "match_score": 1000,
        "match_layer": "exact_tag"
      }
    ]
  },
  "candidate_tags": {}
}
```

### 批量 `--batch-file ... --for-prompt --json --compact`

```json
{
  "found": true,
  "results": {
    "character": {
      "found": true,
      "confirmed_tags": {},
      "candidate_tags": {}
    }
  },
  "missing": [],
  "usage": {
    "confirmed_tags": "...",
    "candidate_tags": "...",
    "nltags_hint": "...",
    "empty_result": "..."
  }
}
```

字段规则：

- `found=false` → 不回填 tag。
- `confirmed_tags.<category>[]` → 可作为 hard tag 候选，仍按用户意图筛选。
- `candidate_tags.<category>[]` → 只用于人工/模型筛选，不直接写入 `hard_tags`。
- `missing[]` → 对应 query 没有可确认 tag；停止补查或改写为 nltags。
- `match_layer=exact_tag` → tag 直接命中。
- `match_layer=exact_alias` → alias 精确命中。
- `match_layer=prefix` → artist prefix 命中。
- `match_layer=fuzzy` / `group_general_fallback` → 候选，不是 confirmed。

## 硬性规则

- Artist tag 必须来自 artist category，保留 `@`。
- Character/series/general tag 不带 `@`，不作为画师。
- `confirmed_tags` 不证明默认服装/发色稳定。
- 不伪造 Danbooru tag。
- CLI 不可用/非 0/非 JSON/字段缺失 → 停止，不切换旧实现。
- `newest`/`recent`/`mid`/`early`/`old` 和 `year XXXX` 是 Anima 年代控制词，不需 tag 命中证明。

## 分组速查

| group                     | 内容                   |
| ------------------------- | ---------------------- |
| `artist`                  | 画师，保留 `@`         |
| `character`               | 角色                   |
| `series`/`ip`/`copyright` | 作品                   |
| `appearance`/`body`       | 发色、瞳色、发型、体型 |
| `expression`              | 表情                   |
| `pose`/`action`           | 姿势、动作             |
| `clothing`/`outfit`       | 服装                   |
| `accessory`/`prop`        | 配饰、道具             |
| `scene`/`background`      | 场景、天气             |
| `lighting`                | 光影 tag               |
| `meta`                    | highres 等             |
