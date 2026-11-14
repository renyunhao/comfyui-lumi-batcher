SELECT
    COUNT(*) AS cnt
FROM
    batch_sub_task
WHERE
    batch_task_id = ?
    AND status IN ('pending', 'running');
