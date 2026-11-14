-- 暂停：把尚未开始的子任务标记为 paused，排除当前正在执行的那一个
UPDATE batch_sub_task
SET
    status = 'paused',
    reason = '任务暂停'
WHERE
    batch_task_id = ?
    AND status IN ('pending', 'running')
    AND prompt_id <> ?;
