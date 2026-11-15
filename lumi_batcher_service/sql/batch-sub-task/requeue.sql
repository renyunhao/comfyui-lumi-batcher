-- 继续执行：用新 prompt_id 重新入队。
-- 必须同步更新主键 id：task_done / task_start 钩子用 prompt_id 调用
-- update_property(..., WHERE id = ?)，若 id 仍是旧值，重跑后的状态与输出
-- 都写不进子任务，结果对比里就会显示空。
UPDATE batch_sub_task
SET
    id = ?,
    prompt_id = ?,
    status = 'pending',
    reason = '',
    -- 重跑要重新计时，否则耗时会把暂停等待时间一起算进去
    start_time = NULL,
    end_time = NULL
WHERE
    id = ?;
