/**
 * 键盘事件与键位写法的匹配（docs/specs/workbench/markdown-editing.md 输出 28）：控件里有些快捷键要打开界面、不是直接执行动作，
 * 不能走 Tiptap 的键位表，由控件在编辑器 DOM 上自己监听，用这里判断是不是目录里写的那个键位。
 *
 * - 按物理键位（`event.code`）：macOS 上 Option 会改变 `event.key`（Option+M 是 µ）。
 * - 修饰键要完全一致，包括没写的不能按着（Ctrl+Alt+M 不匹配 Ctrl+Alt+Shift+M）。
 * - AltGr 排除：Windows 把 AltGr 报成 Ctrl+Alt，在 AltGr+M 能打出字符的布局上，带 Alt 的键位会吞掉用户的输入。
 * - 输入法组字中不匹配：组字中 `key` 是 `Process`，`code` 仍是物理键位。
 */

import {parseKeybinding} from "nbook/plugins/commands/shared/contracts";
import type {KeyPlatform} from "nbook/plugins/commands/shared/contracts";

import type {KeyEventLike} from "../shared/contracts";

export function keyEventMatches(binding: string, platform: KeyPlatform, event: KeyEventLike): boolean {
    const parsed = parseKeybinding(binding, platform);
    if (!parsed.ok || event.isComposing) return false;
    const {key} = parsed.value;
    const code = /^[A-Z]$/u.test(key) ? `Key${key}` : /^[0-9]$/u.test(key) ? `Digit${key}` : null;
    if (code === null || event.code !== code) return false;
    const {ctrl, meta, alt, shift} = parsed.value;
    if (event.ctrlKey !== ctrl || event.metaKey !== meta || event.altKey !== alt || event.shiftKey !== shift) return false;
    return !event.getModifierState("AltGraph");
}
