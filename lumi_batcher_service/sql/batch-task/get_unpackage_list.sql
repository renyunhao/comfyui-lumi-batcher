SELECT
    *
FROM
    batch_task
WHERE
    json_extract ("package_info", '$.status') IN ('waiting', 'packing')
    -- 准备 / 已暂停的任务还没跑完（甚至没开始），重启时不应产出空结果包
    AND status NOT IN ('prepared', 'paused')