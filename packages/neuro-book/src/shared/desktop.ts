/**
 * 应用所在的机器能不能弹出桌面程序（浏览器、文件管理器）。命令行的 `nbook start` 打开浏览器、Skill 页打开 Skill 文件夹都按它判断：
 * SSH 会话里打开的是远端机器上的程序，Linux 没有图形会话时 `xdg-open` 什么也做不了。环境与平台由调用方给，这里不读进程。
 */

export type DesktopReach = "yes" | "ssh" | "no-display";

export function desktopReach(env: Readonly<Record<string, string | undefined>>, platform: string): DesktopReach {
    if (env.SSH_CONNECTION || env.SSH_TTY) return "ssh";
    if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return "no-display";
    return "yes";
}
