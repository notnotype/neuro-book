# Anima 特有失败模式

只在模型遇到具体失败症状时按需读取。不自动加载。

## E001：单人主体太小
**症状**：画面中间一个小人，四周空白。
**修**：主体占比 40-60%，用 upper body / cowboy shot 控制。不写 full body + plain background。

## E002：双人互不相关
**症状**：两人并排各看各的。
**修**：至少定义视线接触/手部接触/共享道具。用 eye contact / holding hands + nltags 绑定位置。

## E003：透视导致脸部变形
**症状**：仰视/俯视时脸崩——下巴太尖、眼睛歪。
**修**：降角度强度：slight low angle 代替 extreme low angle。极端角度 + 简单背景 + perfect face。anatomy 崩溃时先降角度，不硬扛。

## E004：前景挡住主角脸
**症状**：三人以上，前景角色头/手正好挡主角脸。
**修**：主角放中景，前景只露肩膀/背影。nltags 写死：Place main subject at center midground, foreground character as out-of-focus silhouette.

## E005：背景比主体抢眼
**症状**：背景精细华丽，主体被淹没。
**修**：简单暗背景 + rim light + shallow depth of field。背景 tag 越少越好，3 个以上可能已在抢戏。

## E006：切线——不同物体边缘刚好贴上
**症状**：人物轮廓线和背景线条刚好相切，视觉粘连。
**修**：要么明确重叠（一前一后），要么明确分离（中间留空隙）。nltags：Keep figures separated by clear gap. Do not let outlines touch.

## E007：光源方向不连续
**症状**：人物背光但背景阳光明媚，窗光从左但树影从右。
**修**：一个场景只定义一个光源方向。backlighting + sunset 合理，backlighting + noon sun 矛盾。背光必须补 fill light。

## E008：三人以上肢体归属混乱
**症状**：手臂腿纠缠，分不清谁的手搭谁肩上。
**修**：3 人最多两组身体接触。nltags 写死归属：Left girl's hand on center's waist. Right girl's arm rests on center's shoulder. Keep each character's limbs clearly separated.

## E009：表情与场景不匹配
**症状**：战斗场景微笑、拥抱场景苦脸。
**修**：检查场景情绪→表情一致性。写完 prompt 后读一遍确认没有违和感。

## E010：人物与环境比例失调
**症状**：人物只到门框一半高，比桌子矮。
**修**：全身+场景 → nltags 写死比例：The desk reaches her waist. The door frame is visibly taller than her head.

## E011：极端比例导致解剖崩坏
**症状**：loli + huge breasts 或 gigantic breasts + extremely thin waist。
**修**：不要全身展示；用胸部以上构图。极端比例+写实解剖本质冲突，选其一。
