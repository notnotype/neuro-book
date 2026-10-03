import {openSqliteVecDatabase} from "nbook/server/rag/sqlite-vec-database";

/**
 * 验证当前运行环境能加载 sqlite-vec，并能完成最小向量召回。
 */
async function main(): Promise<void> {
    const db = await openSqliteVecDatabase({path: ":memory:", loadExtension: true});
    try {
        db.run("CREATE VIRTUAL TABLE subject_rag_vec_smoke USING vec0(embedding float[2])");
        db.run("INSERT INTO subject_rag_vec_smoke(rowid, embedding) VALUES (?, ?)", 1, new Float32Array([1, 0]));
        const rows = db.query("SELECT rowid FROM subject_rag_vec_smoke WHERE embedding MATCH ? ORDER BY distance LIMIT 1")
            .all(new Float32Array([1, 0])) as Array<{rowid: number | bigint}>;
        if (Number(rows[0]?.rowid) !== 1) {
            throw new Error(`sqlite-vec smoke 查询结果异常：${JSON.stringify(rows)}`);
        }
        console.log("sqlite-vec smoke ok");
    } finally {
        db.close();
    }
}

await main();
