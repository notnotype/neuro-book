/**
 * `bash` 方言（docs/specs/agent/permissions.md 的“命令与方言”）：把一段命令拆成单条命令，判断每条是不是只读。
 *
 * 解析交给 `unbash`，这里只把语法树压平成规则要看的样子。两条约定是整个判定的基础：
 * - 解析要么完整、要么 `{opaque: true}`，不交半棵树：`unbash` 是容错解析，出错时也给树，漏掉的命令规则就看不到；
 * - 只读是白名单，到子命令与选项，清单外一律不算。这不是安全边界，只覆盖模型通常的写法。
 */

import {forEachChild, parse} from "unbash";
import type {Command, Redirection, SyntaxNode, Word} from "unbash";

export interface CommandRedirect {
    readonly write: boolean;
    /** 目标的原文（引号已去掉）；有展开时 `literal` 为假，这时它不是能拿去比对的地址。 */
    readonly target: string;
    readonly literal: boolean;
}

export interface SimpleCommand {
    /** 剥完包装的命令与参数，引号已去掉。只有重定向的（`> f`、`{ a; } > f`）是空数组。 */
    readonly argv: readonly string[];
    readonly redirects: readonly CommandRedirect[];
    /** 环境变量前缀的名字：`GIT_EXTERNAL_DIFF=x git diff` 这样的前缀能改命令的行为，只读判断要看。 */
    readonly assignments: readonly string[];
    readonly hasExpansion: boolean;
}

export type ParsedCommand = {readonly commands: readonly SimpleCommand[]};
export type OpaqueCommand = {readonly opaque: true};

/** 一种命令语言。`parse` 抛错由调用方按 `opaque` 算。 */
export interface CommandDialect {
    readonly id: string;
    parse(text: string): ParsedCommand | OpaqueCommand;
    readOnly(command: SimpleCommand): boolean;
}

const OPAQUE: OpaqueCommand = {opaque: true};
/** `bash -c` 里套 `bash -c` 的层数上限：再深的不是模型通常的写法。 */
const MAX_DEPTH = 8;
/** 不写文件的“重定向目标”。 */
const DISCARD_TARGETS = new Set(["/dev/null", "/dev/stdout", "/dev/stderr"]);
/** 文件名就是命令的目录：`/bin/rm` 算 `rm`，`/home/x/cat` 不算 `cat`，那是别的程序。 */
const SYSTEM_BIN = /^\/(?:usr\/(?:local\/)?)?s?bin\/([^/]+)$/u;
/** 把别的命令当参数执行、这里跟不进去的。 */
const RUNS_OTHERS = new Set(["eval", "xargs", "source", ".", "parallel"]);
const FIND_RUNS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const SHELLS = new Set(["bash", "sh", "dash", "zsh"]);

/** 包装命令：选项认得的留下剥掉，认不出的算看不懂。`takesValue` 是带一个值的选项，`positionals` 是命令前面的位置参数个数。 */
const WRAPPERS: Readonly<Record<string, {readonly flags?: RegExp; readonly takesValue?: RegExp; readonly positionals?: number}>> = {
    time: {flags: /^-[pv]$/u},
    nohup: {},
    command: {flags: /^-p$/u},
    builtin: {},
    exec: {},
    nice: {flags: /^(?:-\d+|--adjustment=-?\d+)$/u, takesValue: /^-n$/u},
    timeout: {flags: /^(?:--foreground|--preserve-status|-v|--verbose|--signal=\S+|--kill-after=\S+)$/u, takesValue: /^-[ks]$/u, positionals: 1},
    stdbuf: {flags: /^(?:-[ioe]\S+|--(?:input|output|error)=\S+)$/u, takesValue: /^-[ioe]$/u},
};

const GLOB_PARTS: ReadonlySet<string> = new Set(["Glob", "ExtendedGlob"]);
const wordHasExpansion = (word: Word): boolean => (word.parts ?? []).some(function expands(part): boolean {
    switch (part.type) {
        case "Literal":
        case "SingleQuoted":
        case "AnsiCQuoted":
        case "LocaleString":
            return false;
        case "DoubleQuoted":
            return part.parts.some(expands);
        default:
            // 通配符不算展开：它只影响匹配哪些文件，命令名是通配符的不在白名单里。
            return !GLOB_PARTS.has(part.type);
    }
});

const redirectOf = (redirect: Redirection): CommandRedirect | null => {
    if (redirect.type !== "Redirect" || !redirect.operator.includes(">")) return null;
    const target = redirect.target;
    if (target === undefined) return {write: true, target: "", literal: false};
    // 文件描述符之间的复制（`2>&1`、`>&2`）不写文件。
    if (redirect.operator.endsWith("&") && /^(?:\d+|-)$/u.test(target.value)) return null;
    if (DISCARD_TARGETS.has(target.value)) return null;
    return {write: true, target: target.value, literal: !wordHasExpansion(target)};
};

const baseName = (word: string): string => SYSTEM_BIN.exec(word)?.[1] ?? word;

/** 剥一层包装，交回里面的命令；不是包装时交回原样；认不出时 null。 */
function peelWrapper(argv: readonly string[]): readonly string[] | null {
    const name = argv[0]!;
    if (name === "command" && (argv[1] === "-v" || argv[1] === "-V")) return argv;
    if (name === "env") return peelEnv(argv);
    const wrapper = WRAPPERS[name];
    if (wrapper === undefined) return argv;
    let at = 1;
    while (at < argv.length) {
        const word = argv[at]!;
        if (word === "--") {
            at += 1;
            break;
        }
        if (!word.startsWith("-")) break;
        if (wrapper.takesValue?.test(word) === true) at += 2;
        else if (wrapper.flags?.test(word) === true) at += 1;
        else return null;
    }
    at += wrapper.positionals ?? 0;
    return at >= argv.length ? (name === "exec" ? [] : argv) : argv.slice(at);
}

/** `env A=1 B=2 cmd`：`env` 本身不带命令时是读环境，留着；带选项的（`-S` 能拼出命令）算看不懂。 */
function peelEnv(argv: readonly string[]): readonly string[] | null {
    let at = 1;
    while (at < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(argv[at]!)) at += 1;
    if (at >= argv.length) return argv;
    return argv[at]!.startsWith("-") ? null : argv.slice(at);
}

/** 反复剥包装到不是包装；命令名取文件名。 */
function normalize(words: readonly string[]): readonly string[] | null {
    let argv = words;
    for (;;) {
        if (argv.length === 0) return argv;
        const named = [baseName(argv[0]!), ...argv.slice(1)];
        const peeled = peelWrapper(named);
        if (peeled === null) return null;
        if (peeled.length === named.length) return named;
        argv = peeled;
    }
}

/** `bash -c '<字面量>'` 的脚本；不是这个形状交回 null，形状对但不是字面量或带别的参数算看不懂。 */
function inlineScript(command: Command, argv: readonly string[]): string | typeof OPAQUE | null {
    if (!SHELLS.has(argv[0]!)) return null;
    if (argv.length === 1) return OPAQUE; // 从标准输入读脚本。
    const flag = argv[1]!;
    if (!/^-[elux]*c[elux]*$/u.test(flag)) return null;
    if (argv.length !== 3) return OPAQUE;
    const script = command.args[command.args.length - 1];
    return script?.type === "Word" && !wordHasExpansion(script) ? argv[2]! : OPAQUE;
}

const opaqueUse = (argv: readonly string[]): boolean => RUNS_OTHERS.has(argv[0]!) || (argv[0] === "find" && argv.some((word) => FIND_RUNS.has(word)));

function collect(text: string, depth: number, commands: SimpleCommand[]): boolean {
    if (depth > MAX_DEPTH) return false;
    let understood = true;
    const visit = (node: SyntaxNode): void => {
        if (!understood) return;
        if ("errors" in node && node.errors !== undefined && node.errors.length > 0) {
            understood = false;
            return;
        }
        if (node.type === "Redirected") {
            const redirects = node.redirects.flatMap((redirect) => redirectOf(redirect) ?? []);
            if (redirects.length > 0) commands.push({argv: [], redirects, assignments: [], hasExpansion: false});
        }
        if (node.type === "Command" && !simple(node, depth, commands)) {
            understood = false;
            return;
        }
        forEachChild(node, visit);
    };
    visit(parse(text));
    return understood;
}

function simple(node: Command, depth: number, commands: SimpleCommand[]): boolean {
    const redirects = node.redirects.flatMap((redirect) => redirectOf(redirect) ?? []);
    const assignments = node.prefix.flatMap((item) => (item.type === "Assignment" && item.name !== undefined ? [item.name] : []));
    if (node.name === undefined) {
        if (redirects.length > 0) commands.push({argv: [], redirects, assignments, hasExpansion: false});
        return true;
    }
    // 命令名里有展开：跑的是什么要到运行时才知道。
    if (wordHasExpansion(node.name)) return false;
    const words = [node.name, ...node.args.flatMap((item) => (item.type === "Word" ? [item] : []))];
    const argv = normalize(words.map((word) => word.value));
    if (argv === null) return false;
    // 剥完之后的命令名同样要是字面量：`timeout 5 $cmd`。
    if (argv.length > 0 && words.some((word) => word.value === argv[0] && wordHasExpansion(word))) return false;
    if (argv.length > 0 && opaqueUse(argv)) return false;
    if (argv.length > 0) {
        const script = inlineScript(node, argv);
        if (script === OPAQUE) return false;
        if (typeof script === "string") {
            if (redirects.length > 0) commands.push({argv: [], redirects, assignments, hasExpansion: false});
            return collect(script, depth + 1, commands);
        }
    }
    commands.push({argv, redirects, assignments, hasExpansion: words.some(wordHasExpansion)});
    return true;
}

/** 选项是否命中：`--output` 也认 `--output=x`；短选项认连写（`-Dv`）。 */
const hasOption = (args: readonly string[], options: readonly string[]): boolean => args.some((arg) => options.some((option) => {
    if (arg === option || (option.startsWith("--") && arg.startsWith(`${option}=`))) return true;
    return /^-[A-Za-z]$/u.test(option) && /^-[A-Za-z]+/u.test(arg) && !arg.startsWith("--") && arg.includes(option[1]!);
}));
const positionalsOf = (args: readonly string[]): readonly string[] => args.filter((arg) => !arg.startsWith("-"));

type ReadOnlyCheck = (args: readonly string[]) => boolean;
const anyArgs: ReadOnlyCheck = () => true;
const unless = (...options: string[]): ReadOnlyCheck => (args) => !hasOption(args, options);

/** `sed` 的脚本能写文件（`w`）、跑命令（`e`），替换的标志里也能带。只认得常见的写法，别的不算只读。 */
const SED_WRITES = /(?:^|[;{}\s])\d*[,$\d\s]*[we](?:\s|$)|\/[gpiIm\d]*(?:w\s|e\s*(?:[;}]|$))/u;

const GIT_DENIED = ["-c", "--ext-diff", "--textconv", "--output", "--exec", "--upload-pack", "--paginate"];
const onlyListing = (...listing: string[]): ReadOnlyCheck => (args) => positionalsOf(args).length === 0 && args.every((arg) => listing.some((option) => arg === option || arg.startsWith(`${option}=`)));
/** git 的只读子命令。`branch`、`tag`、`remote`、`config` 同时能改东西，只认列表的写法。 */
const GIT_READ_ONLY: Readonly<Record<string, ReadOnlyCheck>> = {
    status: anyArgs, log: anyArgs, show: anyArgs, diff: anyArgs, blame: anyArgs, shortlog: anyArgs, describe: anyArgs,
    "rev-parse": anyArgs, "rev-list": anyArgs, "ls-files": anyArgs, "ls-tree": anyArgs, "cat-file": anyArgs, grep: unless("-O", "--open-files-in-pager"),
    "merge-base": anyArgs, "show-ref": anyArgs, "name-rev": anyArgs, "count-objects": anyArgs, whatchanged: anyArgs,
    branch: onlyListing("-a", "--all", "-r", "--remotes", "-v", "-vv", "--verbose", "--list", "-l", "--show-current", "--contains", "--merged", "--no-merged", "--no-color", "--color", "--sort", "--format"),
    tag: onlyListing("-l", "--list", "--sort", "--contains", "--merged", "--no-merged", "--format"),
    remote: onlyListing("-v", "--verbose"),
    config: (args) => hasOption(args, ["--get", "--get-all", "--get-regexp", "--list", "-l"]) && !hasOption(args, ["--unset", "--unset-all", "--add", "--replace-all", "--edit", "-e", "--global", "--system", "--file", "-f", "--rename-section", "--remove-section"]),
    reflog: (args) => args[0] === undefined || args[0] === "show" || args[0].startsWith("-"),
    stash: (args) => args[0] === "list" || args[0] === "show",
    worktree: (args) => args[0] === "list",
};
function gitReadOnly(args: readonly string[]): boolean {
    // 全局选项：只认 `-C <目录>` 与 `--no-pager`；`-c`、`--exec-path` 这些能让它跑别的程序。
    let at = 0;
    while (args[at]?.startsWith("-") === true) {
        if (args[at] === "-C") at += 2;
        else if (args[at] === "--no-pager") at += 1;
        else return false;
    }
    const check = GIT_READ_ONLY[args[at] ?? ""];
    const rest = args.slice(at + 1);
    return check !== undefined && !hasOption(rest, GIT_DENIED) && check(rest);
}

/** 只读命令的白名单。选项能写文件或跑程序的写在 `unless` 里；能靠位置参数写文件的只认写法。 */
const READ_ONLY: Readonly<Record<string, ReadOnlyCheck>> = {
    cat: anyArgs, head: anyArgs, tail: anyArgs, wc: anyArgs, ls: anyArgs, stat: anyArgs, file: anyArgs, du: anyArgs, df: anyArgs, pwd: anyArgs,
    echo: anyArgs, printf: anyArgs, true: anyArgs, false: anyArgs, ":": anyArgs, test: anyArgs, "[": anyArgs, cd: anyArgs,
    which: anyArgs, whereis: anyArgs, type: anyArgs, basename: anyArgs, dirname: anyArgs, realpath: anyArgs, readlink: anyArgs,
    whoami: anyArgs, id: anyArgs, uname: anyArgs, printenv: anyArgs, cut: anyArgs, tr: anyArgs, grep: anyArgs, egrep: anyArgs, fgrep: anyArgs,
    cmp: anyArgs, comm: anyArgs, nl: anyArgs, tac: anyArgs, rev: anyArgs, seq: anyArgs, fold: anyArgs, column: anyArgs, od: anyArgs, hexdump: anyArgs,
    md5sum: anyArgs, sha1sum: anyArgs, sha256sum: anyArgs, strings: anyArgs, jq: anyArgs,
    env: (args) => args.length === 0,
    command: (args) => args[0] === "-v" || args[0] === "-V",
    date: unless("-s", "--set"),
    hostname: (args) => positionalsOf(args).length === 0 && !hasOption(args, ["-F", "--file", "-b", "--boot"]),
    sort: unless("-o", "--output", "--compress-program"),
    uniq: (args) => positionalsOf(args).length <= 1,
    diff: unless("--output"),
    tree: unless("-o"),
    rg: unless("--pre"),
    find: unless("-delete", "-fprint", "-fprint0", "-fprintf", "-fls"),
    sed: (args) => !hasOption(args, ["-i", "--in-place", "-f", "--file"]) && !args.some((arg) => SED_WRITES.test(arg)),
    git: gitReadOnly,
};

export interface BashDialectOptions {
    /** 设置里追加的只读命令，按词前缀比对（`npm ls`）。只能加，不能把清单里的删掉。 */
    readonly extraReadOnly?: readonly string[];
}

/** 环境变量前缀里不改变命令行为的：`LANG=C grep` 很常见。 */
const HARMLESS_ASSIGNMENTS = /^(?:LANG|LANGUAGE|LC_[A-Z]+|TZ|NO_COLOR|TERM|COLUMNS|LINES)$/u;

export function createBashDialect(options: BashDialectOptions = {}): CommandDialect {
    const extras = (options.extraReadOnly ?? []).map((prefix) => prefix.trim().split(/\s+/u));
    return {
        id: "bash",
        parse(text) {
            const commands: SimpleCommand[] = [];
            return collect(text, 0, commands) ? {commands} : OPAQUE;
        },
        readOnly(command) {
            if (command.redirects.some((redirect) => redirect.write)) return false;
            if (command.assignments.some((name) => !HARMLESS_ASSIGNMENTS.test(name))) return false;
            const [name, ...args] = command.argv;
            if (name === undefined) return true;
            if (extras.some((prefix) => prefix.every((word, index) => command.argv[index] === word))) return true;
            return Object.hasOwn(READ_ONLY, name) && READ_ONLY[name]!(args);
        },
    };
}
