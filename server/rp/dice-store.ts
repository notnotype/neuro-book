import {randomInt} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * RP 模式掷骰存储：`rp/dice/rolls.jsonl`，每行一次掷骰。
 *
 * 信任模型：骰值由服务端 crypto RNG 在用户点击时生成（agent 无法自造，前端无法挑数），
 * 文件是唯一真相源。agent 读取最新行并校验 seq 大于其发起请求时记下的序号，防止错配旧骰。
 */

export const RP_DICE_RELATIVE_PATH = "rp/dice/rolls.jsonl";

export type DiceRoll = {
    /** 从 1 递增的掷骰序号。 */
    seq: number;
    /** 两个六面骰。 */
    d1: number;
    d2: number;
    total: number;
    /** ISO 时间戳（服务端盖章）。 */
    at: string;
};

/** 读取全部掷骰记录（文件缺失返回空）。坏行跳过不阻断。 */
export async function listDiceRolls(projectRoot: string): Promise<DiceRoll[]> {
    const filePath = path.join(projectRoot, RP_DICE_RELATIVE_PATH);
    let raw: string;
    try {
        raw = await fs.readFile(filePath, "utf-8");
    } catch (error) {
        if (isNotFound(error)) return [];
        throw error;
    }
    const rolls: DiceRoll[] = [];
    for (const line of raw.split(/\r?\n/u)) {
        if (!line.trim()) continue;
        try {
            const parsed = JSON.parse(line) as Partial<DiceRoll>;
            if (typeof parsed.seq === "number" && typeof parsed.d1 === "number" && typeof parsed.d2 === "number") {
                rolls.push({
                    seq: parsed.seq,
                    d1: parsed.d1,
                    d2: parsed.d2,
                    total: parsed.total ?? parsed.d1 + parsed.d2,
                    at: parsed.at ?? "",
                });
            }
        } catch {
            // 坏行跳过
        }
    }
    return rolls;
}

/** 掷一次 2d6（服务端 crypto RNG）并追加到 rolls.jsonl，返回本次记录。 */
export async function rollDice(projectRoot: string): Promise<DiceRoll> {
    const existing = await listDiceRolls(projectRoot);
    const d1 = randomInt(1, 7);
    const d2 = randomInt(1, 7);
    const roll: DiceRoll = {
        seq: (existing.at(-1)?.seq ?? 0) + 1,
        d1,
        d2,
        total: d1 + d2,
        at: new Date().toISOString(),
    };
    const filePath = path.join(projectRoot, RP_DICE_RELATIVE_PATH);
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.appendFile(filePath, `${JSON.stringify(roll)}\n`, "utf-8");
    return roll;
}

function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}
