PRAGMA integrity_check;
SELECT 'Text', COUNT(*) FROM Text;
SELECT 'Revision', COUNT(*) FROM Revision;
SELECT 'MachineScan', COUNT(*) FROM MachineScan;
SELECT 'MachineDetect', COUNT(*) FROM MachineDetect;
SELECT 'DocJudgment', COUNT(*) FROM DocJudgment;
SELECT 'revealedAtNull', COUNT(*) FROM Revision WHERE revealedAt IS NULL;
SELECT 'distinctRevisionJudgment', COUNT(DISTINCT revisionId) FROM DocJudgment;
