/**
 * 执行者与 Chrome 的沙箱（bwrap）。两边的执行者都能跑任意代码，Chrome 又能被执行者经 CDP 叫去打开 `file://`，
 * 所以两者都在沙箱里：看不到家目录（密钥、`~/.omp`、评测的私有目录、BU 的密文都在家目录下）、`/run`（用户总线：
 * 经 `systemd-run --user` 能跑到沙箱外）与宿主的 `/tmp`、`/var/tmp`；调用方另给的路径（运行目录、Chrome 的临时根、
 * 密钥文件所在的目录，它们可能不在上面这些位置下）也盖住；只把要用的路径绑回来。网络不隔离：要连本机的 Chrome、假站与网关，
 * 也连得到同一批里别的格的假站与 Chrome（模型写的代码去扫本机端口的情形没见过，逐格隔离网络改动面大，没做）。
 *
 * 这只防“读文件、拿密钥、跑到沙箱外”，不是对抗性的隔离（同一个用户、同一个网络）。
 *
 * 根是只读绑定，bwrap 在根下建不了挂载点：要绑进来的目录都挂在沙箱自己的 tmpfs `/tmp` 下（例如 `/tmp/work`）。
 */

import {homedir} from "node:os";

export interface SandboxBind {
    readonly host: string;
    readonly sandbox: string;
    readonly writable: boolean;
}

export interface SandboxSpec {
    /** 沙箱里要跑的命令与参数。 */
    readonly command: readonly string[];
    /** 原样（同一路径）只读绑回来的宿主路径，例如 Python 环境与它的解释器。 */
    readonly readonly?: readonly string[];
    readonly binds?: readonly SandboxBind[];
    /** 在沙箱里新建的空目录（建在 tmpfs 上，例如家目录 `/tmp/home`）。 */
    readonly dirs?: readonly string[];
    /** 另外要藏起来的宿主目录（真实路径）：用空的 tmpfs 盖住。已在家目录、`/tmp`、`/run`、`/var/tmp` 下的不用另盖。 */
    readonly hide?: readonly string[];
    /** 沙箱里的全部环境变量：从空开始，不继承调度器的环境（里面有代理与别的东西）。 */
    readonly env: Readonly<Record<string, string>>;
    readonly cwd: string;
}

/** 生成 `bwrap` 的参数（第一个元素是 `bwrap`）。先后有讲究：先整体只读绑根，再用 tmpfs 盖住要藏的目录，最后把要用的路径绑回来。 */
export function sandboxArgv(spec: SandboxSpec, home: string = homedir()): string[] {
    const masked = ["/tmp", "/run", "/var/tmp", home];
    const argv = [
        "bwrap",
        "--ro-bind", "/", "/",
        "--dev", "/dev",
        "--tmpfs", "/dev/shm",
        "--proc", "/proc",
    ];
    for (const path of masked) argv.push("--tmpfs", path);
    const inside = (path: string, root: string) => path === root || path.startsWith(`${root.replace(/\/$/u, "")}/`);
    for (const path of new Set(spec.hide ?? [])) {
        if (!masked.some((root) => inside(path, root))) argv.push("--tmpfs", path);
    }
    for (const path of spec.readonly ?? []) argv.push("--ro-bind", path, path);
    for (const bind of spec.binds ?? []) argv.push(bind.writable ? "--bind" : "--ro-bind", bind.host, bind.sandbox);
    for (const dir of spec.dirs ?? []) argv.push("--dir", dir);
    argv.push("--unshare-pid", "--die-with-parent", "--new-session", "--clearenv");
    for (const [key, value] of Object.entries(spec.env)) argv.push("--setenv", key, value);
    argv.push("--chdir", spec.cwd, "--", ...spec.command);
    return argv;
}
