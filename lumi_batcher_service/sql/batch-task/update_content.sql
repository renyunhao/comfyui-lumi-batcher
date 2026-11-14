-- 准备态反复编辑：只更新内容字段，状态字段（status / status_counts /
-- package_info / messages）一律保留，避免保存编辑内容时丢失任务状态
UPDATE batch_task
SET
    name = ?,
    queue_count = ?,
    params_config = ?,
    extra = ?,
    update_time = ?
WHERE
    id = ?;
