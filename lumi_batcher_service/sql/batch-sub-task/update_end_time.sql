-- task_done 钩子：记录子任务执行结束的时间（毫秒）
UPDATE batch_sub_task
SET
    end_time = ?
WHERE
    id = ?;
