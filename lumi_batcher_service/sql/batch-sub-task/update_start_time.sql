-- execution_start 钩子：记录子任务真正开始执行的时间（毫秒）
UPDATE batch_sub_task
SET
    start_time = ?
WHERE
    id = ?;
