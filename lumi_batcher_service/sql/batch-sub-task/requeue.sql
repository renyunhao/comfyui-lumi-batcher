-- 继续执行：用新 prompt_id 重新入队，主键 id 保持不变
UPDATE batch_sub_task
SET
    prompt_id = ?,
    status = 'pending',
    reason = ''
WHERE
    id = ?;
