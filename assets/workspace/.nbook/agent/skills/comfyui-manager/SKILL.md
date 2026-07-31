---
name: comfyui-manager
description: Execute prepared ComfyUI workflows — submit/run/validate Anima args, check server/model/deps, manage queue. Never write prompt, never choose artist, never decide composition.
---

# comfyui-manager

## Hard Constraints

- Always execute only `workflow_id` + complete args from `comfyui-animatool`.
- Never write or rewrite `prompt_11` or `prompt_12`.
- Never choose artist, composition, canvas, steps, or `filename_prefix`.
- Never use `run` when user only asked to `submit`.
- Never poll or cache outputs unless user explicitly asks.
- Never pass `fls_*` unless fixing a failed output or the user explicitly asks.

## 1. 工作目录

```powershell
$SKILLS_ROOT = $env:COMFYUI_GOOD_ANIMA_SKILLS_DIR
if (-not $SKILLS_ROOT) { throw "COMFYUI_GOOD_ANIMA_SKILLS_DIR is required" }
$WORKSPACE = Join-Path $SKILLS_ROOT "comfyui-manager/workspace"
$RUNTIME_ROOT = Join-Path (Split-Path -Parent $SKILLS_ROOT) "runtime"
$RUNTIME = Join-Path $RUNTIME_ROOT "comfyui-manager"
Set-Location -LiteralPath $WORKSPACE
$env:COMFYUI_MANAGER_RUNTIME_DIR = $RUNTIME
New-Item -ItemType Directory -Force -Path $RUNTIME | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RUNTIME "args") | Out-Null
```

- Runtime 写到 skills 父目录的 `runtime/comfyui-manager/`。
- 不写回 skill 源目录。
- 无法确定路径时停止。

## 2. 执行前置

Only execute when **ALL** conditions met:

1. 已有 `workflow_id`
2. 已有 `prompt_11`（非空）
3. 已有 `prompt_12`（非空）
4. 已有 `width`
5. 已有 `height`
6. 已有 `batch_size`
7. 已有 `steps`
8. `seed` 可省略；省略时 `run_workflow_args.js` 自动生成随机整数并写回实际 args
9. 已有 `rtx_vsr_quality`
10. 已有 `filename_prefix`

缺任一 → 停止，要求补齐。不补写 prompt，不自选画师/构图/steps/画布。

## 3. Workflow

| workflow                                          | 用途                       |
| ------------------------------------------------- | -------------------------- |
| `local/anima-txt2img-aesthetic-lora`              | 默认双 LoRA 文生图         |
| `local/anima-txt2img-aesthetic-lora-artist-mixer` | 画师融合（`artist_chain`） |
| `local/anima-txt2img-base`                        | 裸模型、对比测试、排障     |

不要根据文件名猜 workflow。用 animatool 准备好的 `workflow_id`。

## 4. 执行模式

### submit（默认，非阻塞）

```powershell
Push-Location "$WORKSPACE"
$result = node ./run_workflow_args.js submit local/anima-txt2img-aesthetic-lora "$RUNTIME/args/args_anima.json" | ConvertFrom-Json
Pop-Location
```

返回：`prompt_id`, args 路径, `filename_prefix`。停止，不自动轮询。

### run（用户明确要求等待/看图时）

```powershell
node ./run_workflow_args.js run local/anima-txt2img-aesthetic-lora "$RUNTIME/args/args_anima.json"
```

### validate

```powershell
node ./run_workflow_args.js validate local/anima-txt2img-aesthetic-lora "$RUNTIME/args/args_anima.json"
```

验证失败 → 停止，不提交。

## 5. Args 格式

纯参数对象，不包 workflow 外壳：

```json
{
  "prompt_11": "...positive...",
  "prompt_12": "...negative...",
  "width": 1024,
  "height": 1536,
  "batch_size": 1,
  "steps": 30,
  "rtx_vsr_quality": "ULTRA",
  "filename_prefix": "anima/%year%-%month%-%day%/anima_base_v1_0-none-character"
}
```

参数边界：

- 只检查字段是否符合 schema，不解释语义。
- `seed` 缺省时，`run_workflow_args.js` 会补 1~4294967295 的随机整数并写回 args 文件；传入 seed 时原值固定不改。
- `artist_chain` 只允许 Artist Mixer workflow。
- 默认不传 `rtx_vsr_scale`。
- `rtx_vsr_quality`: `LOW` / `MEDIUM` / `HIGH` / `ULTRA`。
- `teacache_version`: `v1 (Legacy Fast)` 或 `v2 (Standard Precise)`，不写短的 `v1` / `v2`。
- `FLSampler` / `TeaCache` / `AnimaBoosterLoader` 高级字段默认不传。

FLSampler 排障：

- 普通生图不传 `fls_*`。
- 失败后一次只调一个 `fls_*`。
- 主体发糊：小幅提高 `fls_sharpness`。
- 纹理不足：小幅提高 `fls_fovea_strength`。
- 过锐、噪点、伪影：降低 `fls_sharpness` 或 `fls_fovea_strength`。
- 焦点跳动、局部忽清忽糊：提高 `fls_mask_inertia`。
- 调参后必须重新 `validate`。

## 6. JSON 规则

必须 UTF-8 without BOM：

```powershell
function Write-JsonForCli($Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 30
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}
```

Windows PowerShell 5.x 不要用 `Set-Content -Encoding utf8`。

## 7. 批量

- 同一 prompt 多变体：`batch_size=N`，提交一次。
- 多 prompt：每个单独 `submit`。
- 批量提交后只返回编号、简短主题、`prompt_id`、args 路径。

## 8. 排障

### 连接失败 / connection refused / timeout

```powershell
comfyui-skill --json --dir "$WORKSPACE" server status
```

### 400 / Bad Request

1. 先 `validate`
2. 再 `deps check`
3. 检查 `node_errors`
4. 核对 enum: `teacache_version`, `rtx_vsr_quality`
5. 核对核心字段

### 缺模型 / value_not_in_list

```powershell
comfyui-skill --json --dir "$WORKSPACE" models list diffusion_models
comfyui-skill --json --dir "$WORKSPACE" models list text_encoders
comfyui-skill --json --dir "$WORKSPACE" models list vae
comfyui-skill --json --dir "$WORKSPACE" models list loras
```

核对：`AnimaBoosterLoader.model_name`, `CLIPLoader.clip_name`, `VAELoader.vae_name`, `LoraLoaderModelOnly.lora_name`

模型文件参考：

- `anima-base-v1.0.safetensors` → `diffusion_models/`
- `qwen_3_06b_base.safetensors` → `text_encoders/`
- `qwen_image_vae.safetensors` → `vae/`
- `anima-highres-aesthetic-boost.safetensors` → `loras/`
- `anima-base-1-masterpiece-v51.safetensors` → `loras/`

### 缺自定义节点

```powershell
comfyui-skill --json --dir "$WORKSPACE" deps check local/anima-txt2img-aesthetic-lora
```

- 默认 workflow 使用 `FLS_SamplerV4` + `beta57`。
- 缺 FLSampler、RES4LYF、sampler 或 scheduler 依赖时停止。
- 不用 prompt 修改补救 workflow 依赖缺失。

## 9. 缓存输出

只在用户要求看图 / 补缓存 / 整理批量结果时：

```powershell
node cache_anima_outputs.js --workflow-id local/anima-txt2img-aesthetic-lora
```

批量：使用 manifest。

## 10. 文件名规则

`anima/%year%-%month%-%day%/<model>-<artist|none>-<subject>`

- model: `anima_base_v1_0`（按 workflow base model，不按 LoRA 名）。
- ComfyUI 自动追加 `_00001_` 等序号，不手写。

## 按需参考

服务器管理、排障与非 Anima 生图操作，参见本文件第 8 节「排障」。本 skill 不依赖外部 references 文件。
