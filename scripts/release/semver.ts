/**
 * 发布脚本里的版本比较（语义化版本 2.0.0 的优先级规则，构建元数据不参与）。发布脚本的测试在 Node 里跑（vitest），
 * 用不了 `Bun.semver`。要比较的有带预发布段的旧标签（旧应用的 `v0.9.2-canary.20260805.125926Z.39d220b7`）与 npm 上的
 * `0.0.0-stage` 这类版本，所以不只认三段数字。
 */

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

type Parsed = {core: [number, number, number]; prerelease: string[]};

function parse(version: string): Parsed {
    const match = SEMVER.exec(version);
    if (match === null) throw new Error(`不是语义化版本：${version}`);
    return {core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] === undefined ? [] : match[4].split(".")};
}

function compareIdentifier(left: string, right: string): number {
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right));
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left < right ? -1 : left > right ? 1 : 0;
}

/** `left` 比 `right` 低、相同、高时分别返回 -1、0、1；不是语义化版本时抛出。可以带前缀 `v`。 */
export function compareVersions(left: string, right: string): -1 | 0 | 1 {
    const a = parse(left);
    const b = parse(right);
    for (let index = 0; index < 3; index += 1) {
        const difference = Math.sign(a.core[index]! - b.core[index]!);
        if (difference !== 0) return difference as -1 | 1;
    }
    // 有预发布段的低于同号的正式版本。
    if (a.prerelease.length === 0 || b.prerelease.length === 0) return Math.sign(b.prerelease.length - a.prerelease.length) as -1 | 0 | 1;
    for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
        const left = a.prerelease[index];
        const right = b.prerelease[index];
        if (left === undefined || right === undefined) return left === undefined ? -1 : 1;
        const difference = compareIdentifier(left, right);
        if (difference !== 0) return difference as -1 | 1;
    }
    return 0;
}
