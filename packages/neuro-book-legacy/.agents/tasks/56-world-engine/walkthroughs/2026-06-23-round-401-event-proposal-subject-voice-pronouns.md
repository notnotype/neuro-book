# Round 401 - Event Proposal Subject Voice Pronouns

## Context

Round 400 真实取消分支验收时发现一个新的作者流卡点：`events.jsonl draft` 虽然会把主体名 `薇洛丝` 替换成 `我`，但后续从 slice summary / `world.events` 继承来的第三人称代词仍可能残留，例如：

```json
{"text":"我经历了这件事：我意识到自己未被重点监视（已编辑）。我意识到子爵和法师的注意力暂时不在自己身上，这给了她继续观察出口和守卫站位的机会。她决定暂时不暴露任何异常。","time":"复兴纪元488年 1月15日 14:00:08"}
```

如果作者下一步确认追加，这会直接污染 `simulation/subjects/player/events.jsonl` 的第一人称经历流。

## Changes

- `app/utils/world-engine-workbench-real.ts`
  - `subjectVoiceText()` 仍先把当前 subject name 保守替换为 `我`。
  - 新增 `normalizeSubjectVoicePronouns()`，只收敛常见主体自我叙事残留：
    - `给了她/他/它 ... 机会/继续/...` -> `给了我 ...`
    - 句首 `她/他/它决定/意识到/发现/...` -> `我决定/我意识到/我发现/...`
  - 不做全量第三人称替换，避免把 `观察她的蓝色符文` 这类指向其他角色的宾语误改成 `我`。
- `app/utils/world-engine-ide-entry.test.ts`
  - 增加 Round 400 暴露的真实句式回归测试。
  - 保留既有 `memory.jsonl` 断言中的 `她很紧张`，确认 memory/current cognition 不被主体 event voice 规则误改。

## Verification

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts
```

结果：

- 1 个测试文件通过。
- 3 条测试通过。

## Browser Acceptance

真实浏览器只读验收：

1. 启动临时 dev server：`bunx nuxt dev --port 3001`。
2. 打开 `http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2`。
3. 点击顶部 `World` 打开真实 Workbench。
4. 将 `薇洛丝 / player` 设为主体文件建议语境。
5. 查看最新 `[验收] 薇洛丝意识到自己未被重点监视（已编辑）` 的 `Subject file proposals`。
6. 确认 `events.jsonl draft` JSONL 为：

```json
{"text":"我经历了这件事：我意识到自己未被重点监视（已编辑）。我意识到子爵和法师的注意力暂时不在自己身上，这给了我继续观察出口和守卫站位的机会。我决定暂时不暴露任何异常。","time":"复兴纪元488年 1月15日 14:00:08"}
```

观察到 Inspector metadata 原始 summary 仍保留原文 `这给了她...`，这是预期行为：本轮只修主体文件建议草稿，不改 World Engine slice 原文。

验收后已关闭浏览器页，停止临时 dev server，并确认 `port 3001 free`。

## Plan vs Actual

- 计划：修正真实写入前最容易污染 `events.jsonl` 的 proposal 人称残留。
- 实际：只在 subject event proposal 生成阶段做保守代词收敛，并用窄测试 + 真实浏览器只读验收确认。
- 未做：没有做通用中文改写器；没有点击确认追加真实 `events.jsonl`。

## Next

- 如果继续真实写入验收，当前这条候选已经没有 `给了她 / 她决定` 残留，但仍应由用户明确授权后再点击确认。
- 若后续出现更多人称残留，应先按真实样例补窄规则，不要把所有 `他/她/它` 全局替换成 `我`。
