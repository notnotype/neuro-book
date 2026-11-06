/**
 * `bash` 方言（docs/specs/agent/permissions.md 的“命令与方言”）：拆分、包装、看不懂的写法、只读清单。解析用真实的 `unbash`。
 */

import {describe, expect, test} from "bun:test";

import {createBashDialect} from "./bash-dialect";
import type {ParsedCommand} from "./bash-dialect";

const dialect = createBashDialect();
const parsed = (text: string): ParsedCommand => {
    const result = dialect.parse(text);
    if ("opaque" in result) throw new Error(`看不懂：${text}`);
    return result;
};
const argvs = (text: string): string[] => parsed(text).commands.filter((command) => command.argv.length > 0).map((command) => command.argv.join(" "));
const writes = (text: string): string[] => parsed(text).commands.flatMap((command) => command.redirects.filter((item) => item.write).map((item) => item.target));
/** 整段都只读：逐条只读，且不是看不懂的。 */
const readOnly = (text: string, on = dialect): boolean => {
    const result = on.parse(text);
    return !("opaque" in result) && result.commands.every((command) => on.readOnly(command));
};

describe("拆成单条命令", () => {
    test.each([
        ["git status && git push", ["git status", "git push"]],
        ["a; b || c", ["a", "b", "c"]],
        ["cat f | grep x | wc -l", ["cat f", "grep x", "wc -l"]],
        ["echo $(rm x)", ["echo $(rm x)", "rm x"]],
        ["echo `rm x`", ["echo `rm x`", "rm x"]],
        ['echo "a $(rm x) b"', ["echo a $(rm x) b", "rm x"]],
        ["(cd a && rm b)", ["cd a", "rm b"]],
        ["{ a; b; }", ["a", "b"]],
        ["for f in $(ls); do rm $f; done", ["ls", "rm $f"]],
        ["while true; do a; done", ["true", "a"]],
        ["if a; then b; else c; fi", ["a", "b", "c"]],
        ["case $(a) in x) b;; esac", ["a", "b"]],
        ["cat <(rm x)", ["cat <(rm x)", "rm x"]],
        ["a=$(rm x)", ["rm x"]],
        ["echo ${a:-$(rm x)}", ["echo ${a:-$(rm x)}", "rm x"]],
        ["f() { rm x; }; f", ["rm x", "f"]],
        ["cat <<EOF\n$(rm x)\nEOF", ["cat", "rm x"]],
    ])("%s", (text, expected) => {
        expect(argvs(text).sort()).toEqual([...expected].sort());
    });

    test("单引号与不展开的 here-doc 里的不是命令", () => {
        expect(argvs("echo '$(rm x)'")).toEqual(["echo $(rm x)"]);
        expect(argvs("cat <<'EOF'\n$(rm x)\nEOF")).toEqual(["cat"]);
    });

    test("参数里的通配符不算展开，变量与命令替换算", () => {
        expect(parsed("ls *.md").commands[0]!.hasExpansion).toBe(false);
        expect(parsed("ls $d").commands[0]!.hasExpansion).toBe(true);
        expect(parsed('ls "$d"').commands[0]!.hasExpansion).toBe(true);
    });

    test("引号去掉，按词比对", () => {
        expect(parsed("git 'push' \"origin\"").commands[0]!.argv).toEqual(["git", "push", "origin"]);
    });
});

describe("重定向", () => {
    test("写的目标交出来；文件描述符复制与丢弃不算写；读不算", () => {
        expect(writes("echo a > f")).toEqual(["f"]);
        expect(writes("echo a >> f")).toEqual(["f"]);
        expect(writes("a &> f")).toEqual(["f"]);
        expect(writes("a 2>&1")).toEqual([]);
        expect(writes("a > /dev/null 2>&1")).toEqual([]);
        expect(writes("a < f")).toEqual([]);
        expect(writes("{ a; b; } > f")).toEqual(["f"]);
        expect(writes("> f")).toEqual(["f"]);
    });

    test("目标有展开：不是能比对的地址", () => {
        expect(parsed("a > $F").commands[0]!.redirects).toEqual([{write: true, target: "$F", literal: false}]);
        expect(parsed("a > tmp://x").commands[0]!.redirects).toEqual([{write: true, target: "tmp://x", literal: true}]);
    });
});

describe("包装", () => {
    test.each([
        ["timeout 5 rm x", "rm x"],
        ["timeout -k 1 -s TERM 5s rm x", "rm x"],
        ["nice -n 5 rm x", "rm x"],
        ["nohup rm x", "rm x"],
        ["stdbuf -oL rm x", "rm x"],
        ["command rm x", "rm x"],
        ["builtin cd x", "cd x"],
        ["/usr/bin/time -v rm x", "rm x"],
        ["time rm x", "rm x"],
        ["FOO=1 rm x", "rm x"],
        ["env A=1 B=2 rm x", "rm x"],
        ["timeout 5s env X=1 nice rm x", "rm x"],
        ["command timeout 5 nohup rm x", "rm x"],
        ["/bin/rm x", "rm x"],
        ["/usr/local/bin/rm x", "rm x"],
    ])("%s", (text, expected) => {
        expect(argvs(text)).toEqual([expected]);
    });

    test("别的目录的同名程序不算：它不是那条命令", () => {
        expect(argvs("/home/x/rm y")).toEqual(["/home/x/rm y"]);
        expect(argvs("./rm y")).toEqual(["./rm y"]);
    });

    test("bash -c 的字面量递归解析，重定向留着", () => {
        expect(argvs("bash -c 'git push && rm x'")).toEqual(["git push", "rm x"]);
        expect(argvs("sh -lc 'bash -c \"rm x\"'")).toEqual(["rm x"]);
        expect(writes("bash -c 'echo a' > f")).toEqual(["f"]);
    });

    test("command -v 是查找，不是包装", () => {
        expect(argvs("command -v rm")).toEqual(["command -v rm"]);
    });
});

describe("看不懂的", () => {
    test.each([
        "eval \"$cmd\"",
        "eval rm x",
        "echo x | xargs rm",
        "find . -exec rm {} ;",
        "find . -name a -ok rm {} ;",
        "source a.sh",
        ". a.sh",
        "$cmd x",
        "\"$cmd\" x",
        "${cmd} x",
        "$(which rm) x",
        "timeout 5 $cmd x",
        "bash -c \"$cmd\"",
        "bash -c 'a' extra",
        "bash",
        "echo a | bash",
        "timeout --what 5 rm x",
        "env -S 'rm x'",
        "nice -z rm x",
        "echo \"未闭合",
        "echo 'a",
        "if a; then",
        "echo $(",
        "bash -c 'echo \"a'",
    ])("%s", (text) => {
        expect(dialect.parse(text)).toEqual({opaque: true});
    });

    test("单引号嵌着的 bash -c 递归，层数太深的算看不懂", () => {
        const nest = (levels: number): string => {
            let text = "rm";
            for (let depth = 0; depth < levels; depth += 1) text = `bash -c '${text.replaceAll("'", "'\\''")}'`;
            return text;
        };
        expect(argvs(nest(4))).toEqual(["rm"]);
        expect(dialect.parse(nest(10))).toEqual({opaque: true});
    });
});

describe("只读清单", () => {
    test.each([
        "cat a", "ls -la", "cd a && ls", "git status", "git log --oneline -5", "git diff HEAD~1", "git show HEAD:a.md", "git -C sub log", "git --no-pager log",
        "git branch", "git branch -a", "git branch --show-current", "git tag --list", "git remote -v", "git config --get user.name", "git stash list", "git reflog",
        "grep -rn a .", "rg a", "find . -name '*.md'", "sed -n '1,10p' a", "sed 's/a/b/g' a", "sed -e 's/a/b/' -e 2d a", "sed -nE '/a/,/b/p' a", "sed 's|a;b|c|g' a", "sed '$d' a", "sed '1!d' a", "sed 's/\\//x/;q5' a", "cat \"$f\"", "LANG=C bash -c 'cat x'", "env LANG=C grep a b", "sort a", "uniq a", "wc -l a", "head -5 a | tail -1", "echo a", "date", "hostname",
        "LANG=C grep a b", "command -v git", "env", "cat a > /dev/null", "cat a 2>&1", "timeout 5 cat a", "bash -c 'cat a'", "for f in *.md; do wc -l $f; done",
    ])("算只读：%s", (text) => {
        expect(readOnly(text)).toBe(true);
    });

    test.each([
        "rm a", "cp a b", "mv a b", "mkdir a", "touch a", "tee a", "python a.py", "node a.js", "awk '{print}' a", "curl a", "npm install", "./run.sh", "less a",
        "echo a > f", "cat a >> f", "cat a | tee f", "cat a; rm b", "echo $(rm a)",
        "git push", "git commit -m a", "git checkout a", "git branch a", "git branch -D a", "git branch -d a", "git branch -m a b", "git tag a", "git tag -d a", "git remote add a b",
        "git config user.name a", "git config --global --get a", "git stash", "git stash pop", "git reflog delete a", "git -c core.pager=x log", "git log --output=f", "git diff --ext-diff", "git --exec-path=x log", "git worktree add a",
        "env BASH_ENV=/tmp/rc bash -c 'cat x'", "BASH_ENV=/tmp/rc bash -c 'cat x'", "env A=1 cat x", "env LD_PRELOAD=x cat a",
        "sed 's/x/touch a/ep' f", "sed 's/x/y/pe' f", "sed 's/x/y/e' f", "sed -e 's/a/b/' -e 'w out' f", "sed --expression='s/a/b/w out' f", "sed -f s f", "sed '/a/{w out' f", "sed 'y/a/b/' f", "sed f",
        "find . \"$(printf -- -delete)\"", "sort $X", "git log $(printf -- --output=x)", "sed $S f",
        "find . -delete", "find . -fprint f", "sed -i s/a/b/ f", "sed --in-place s/a/b/ f", "sed -ni p f", "sed 's/a/b/w out' f", "sed -n 'w out' f", "sed '1e rm x' f", "sed -f s.sed f",
        "sort -o f a", "sort --output=f a", "uniq a b", "date -s now", "hostname a", "diff --output=f a b", "tree -o f", "rg --pre x a", "env A=1", "command a",
        "GIT_EXTERNAL_DIFF=x git diff", "PATH=x cat a", "/home/x/cat a", "./cat a", "eval cat a",
    ])("不算只读：%s", (text) => {
        expect(readOnly(text)).toBe(false);
    });

    test("设置里追加的按词前缀比对；不能把清单外的前缀放宽到别的子命令", () => {
        const extended = createBashDialect({extraReadOnly: ["npm ls", "make -n"]});
        expect(readOnly("npm ls --depth 0", extended)).toBe(true);
        expect(readOnly("npm install", extended)).toBe(false);
        expect(readOnly("npm ls > f", extended)).toBe(false);
        expect(readOnly("make -n all", extended)).toBe(true);
        expect(readOnly("rm a", extended)).toBe(false);
    });
});
