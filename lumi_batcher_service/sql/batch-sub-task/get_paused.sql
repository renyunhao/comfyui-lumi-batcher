SELECT
    id,
    prompt_id,
    params_config,
    output
FROM
    batch_sub_task
WHERE
    batch_task_id = ?
    AND status = 'paused';
