-- 重启恢复「暂停请求中」的任务：把被中断的当前项一并回到 paused，
-- 交给「继续」重建 prompt 重新执行，避免它变成 failed 后永远凑不齐计数
UPDATE batch_sub_task
SET
    status = 'paused',
    reason = '任务暂停'
WHERE
    batch_task_id = ?
    AND status IN ('running', 'pending', 'paused');
