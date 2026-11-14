SELECT
    id,
    prompt_id,
    status,
    params_config
FROM
    batch_sub_task
WHERE
    batch_task_id = ?
    AND status IN ('pending', 'running');
