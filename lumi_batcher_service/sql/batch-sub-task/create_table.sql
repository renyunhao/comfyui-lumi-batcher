CREATE TABLE
  IF NOT EXISTS batch_sub_task (
    -- 父任务id
    batch_task_id TEXT NOT NULL,
    -- 子任务id
    id TEXT PRIMARY KEY,
    -- prompt id
    prompt_id TEXT NOT NULL,
    -- 创建时间
    create_time REAL NOT NULL,
    -- 更新时间
    update_time REAL NOT NULL,
    -- 开始执行时间（毫秒，由 execution_start 钩子写入）
    start_time REAL,
    -- 执行结束时间（毫秒，由 task_done 钩子写入）
    end_time REAL,
    -- 批量协议
    params_config TEXT NOT NULL,
    -- 子任务状态
    status TEXT NOT NULL,
    -- 存放错误信息
    reason TEXT NOT NULL,
    -- 存放输出文件结果
    output TEXT NOT NULL,
    -- 父任务id
    FOREIGN KEY (batch_task_id) REFERENCES batch_task (id)
  );