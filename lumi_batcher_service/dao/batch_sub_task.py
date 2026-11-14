# Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
# SPDX-License-Identifier: GPL-3.0-or-later
from enum import Enum
import os
import sqlite3
import time
from ..common.read_sql_file import read_sql_file
from ..common.homeless import timing_decorator


class SubTaskStatus(Enum):
    RUNNING = "running"
    """
  正在执行中
  """
    PENDING = "pending"
    """
  正在队列排队中
  """
    CANCELLED = "cancelled"
    """
  已取消
  """
    PAUSED = "paused"
    """
  已暂停
  """
    SUCCESS = "success"
    """
  已成功
  """
    FAILED = "failed"
    """
  已失败
  """


class SubTaskActionType(Enum):
    CANCEL = "cancel"
    """
    取消
    """
    RESTART = "restart"
    """
    重启
    """
    PAUSED = "paused"
    """
    暂停
    """
    CONTINUE = "continue"
    """
    恢复
    """


class BatchSubTaskDao:
    db_file = ""
    sql_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "sql",
        "batch-sub-task",
    )
    queuing_status = [SubTaskStatus.RUNNING.value, SubTaskStatus.PENDING.value]

    def __init__(self, db_file):
        self.db_file = db_file
        self.create_table()

    def create_table(self):
        with sqlite3.connect(self.db_file) as conn:
            try:
                cursor = conn.cursor()
                sql = read_sql_file(os.path.join(self.sql_dir, "create_table.sql"))
                cursor.execute(sql)
                # 开启WAL模式
                conn.execute("PRAGMA journal_mode=WAL;")
                conn.commit()
                return
            except sqlite3.Error as e:
                print(f"An error occurred on create batch sub task table: {e.args[0]}")

    def insert_task(
        self, batch_task_id, prompt_id, params_config, status, reason, output
    ):
        max_retries = 5
        retry_delay = 1

        for attempt in range(max_retries):
            with sqlite3.connect(self.db_file) as conn:
                try:
                    cursor = conn.cursor()
                    sql = read_sql_file(os.path.join(self.sql_dir, "insert.sql"))
                    now = int(time.time()) * 1000
                    cursor.execute(
                        sql,
                        (
                            batch_task_id,
                            prompt_id,
                            prompt_id,
                            now,
                            now,
                            params_config,
                            status,
                            reason,
                            output,
                        ),
                    )
                    conn.commit()
                    return cursor.lastrowid
                except sqlite3.OperationalError as e:
                    if "database is locked" in str(e):
                        print(
                            f"Database is locked, retrying in {retry_delay} seconds..."
                        )
                        time.sleep(retry_delay)
                    else:
                        print(f"An operational error occurred on insert sub task: {e}")
                        raise
                except sqlite3.Error as e:
                    print(f"An error occurred on insert sub task: {e.args[0]}")
                    return None
        print("Failed to insert sub task after multiple retries")
        return False

    def delete(self, batch_task_id: str):
        with sqlite3.connect(self.db_file) as conn:
            try:
                cursor = conn.cursor()
                sql = read_sql_file(os.path.join(self.sql_dir, "delete.sql"))
                cursor.execute(sql, (batch_task_id,))
                conn.commit()
                return True
            except sqlite3.Error as e:
                print(f"An error occurred on delete sub task: {e.args[0]}")
                return False

    def get_result(self, batch_task_id: str):
        with sqlite3.connect(self.db_file) as conn:
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                sql = read_sql_file(os.path.join(self.sql_dir, "get_result.sql"))
                cursor.execute(sql, (batch_task_id,))
                # 获取查询结果
                rows = cursor.fetchall()
                conn.commit()
                # 将查询结果转换为字典的列表
                dicts = [dict(row) for row in rows]
                return dicts
            except sqlite3.Error as e:
                print(f"An error occurred on get sub tasks: {e.args[0]}")
                return None

    def update_property(self, task_id: str, property_name: str, property_value: str):
        try:
            with sqlite3.connect(self.db_file) as conn:
                cursor = conn.cursor()

                sql = ""

                if property_name == "status":
                    sql = read_sql_file(os.path.join(self.sql_dir, "update_status.sql"))
                elif property_name == "output":
                    sql = read_sql_file(os.path.join(self.sql_dir, "update_output.sql"))
                elif property_name == "reason":
                    sql = read_sql_file(os.path.join(self.sql_dir, "update_reason.sql"))
                else:
                    raise Exception("Invalid property name")

                cursor.execute(sql, (property_value, task_id))

                conn.commit()

                return cursor.lastrowid
        except sqlite3.Error as e:
            print(f"An error occurred on update task property: {e.args[0]}")

    @timing_decorator
    def execute_action(self, actionType: SubTaskActionType, batch_task_id: str):
        with sqlite3.connect(self.db_file) as conn:
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                if actionType == SubTaskActionType.CANCEL:
                    sql = read_sql_file(os.path.join(self.sql_dir, "cancel.sql"))
                    cursor.execute(sql, (batch_task_id,))

                conn.commit()
            except sqlite3.Error as e:
                print(f"An error occurred on update sub task status: {e.args[0]}")

    def update_on_reboot_room(self):
        with sqlite3.connect(self.db_file) as conn:
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                sql = read_sql_file(os.path.join(self.sql_dir, "update_on_reboot.sql"))

                cursor.execute(sql)

                conn.commit()

                # 返回受影响的行数
                return cursor.rowcount
            except sqlite3.Error as e:
                print(f"An error occurred on update on reboot room: {e.args[0]}")

    def get_prompt_ids(self, batch_task_id: str):
        with sqlite3.connect(self.db_file) as conn:
            try:
                cursor = conn.cursor()

                sql = read_sql_file(os.path.join(self.sql_dir, "get_prompt_ids.sql"))
                cursor.execute(sql, (batch_task_id,))
                # 获取查询结果
                rows = cursor.fetchall()

                return [row[0] for row in rows]
            except sqlite3.Error as e:
                print(f"An error occurred on update sub task status: {e.args[0]}")

    def get_task_by_prompt_id(self, prompt_id: str):
        with sqlite3.connect(self.db_file) as conn:
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                sql = read_sql_file(
                    os.path.join(self.sql_dir, "get_task_by_prompt_id.sql")
                )
                cursor.execute(sql, (prompt_id,))
                # 获取查询结果
                row = cursor.fetchone()

                return dict(row) if row else None
            except sqlite3.Error as e:
                print(f"An error occurred on get task by prompt id: {e.args[0]}")

    def get_unfinished(self, batch_task_id: str):
        """取该任务下所有未开始/正在执行的子任务，用于暂停时精确移除排队项"""
        with sqlite3.connect(self.db_file) as conn:
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                sql = read_sql_file(os.path.join(self.sql_dir, "get_unfinished.sql"))
                cursor.execute(sql, (batch_task_id,))
                return [dict(row) for row in cursor.fetchall()]
            except sqlite3.Error as e:
                print(f"An error occurred on get unfinished sub tasks: {e.args[0]}")
                return []

    def mark_paused(self, batch_task_id: str, exclude_prompt_id: str):
        """把排队中的子任务标为暂停；当前正在执行的那一个要排除"""
        with sqlite3.connect(self.db_file) as conn:
            try:
                cursor = conn.cursor()
                sql = read_sql_file(os.path.join(self.sql_dir, "mark_paused.sql"))
                cursor.execute(sql, (batch_task_id, exclude_prompt_id or ""))
                conn.commit()
                return cursor.rowcount
            except sqlite3.Error as e:
                print(f"An error occurred on mark paused sub tasks: {e.args[0]}")
                return 0

    def get_paused(self, batch_task_id: str):
        """取暂停的子任务，继续执行时按它们各自的参数组合重建 prompt"""
        with sqlite3.connect(self.db_file) as conn:
            try:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                sql = read_sql_file(os.path.join(self.sql_dir, "get_paused.sql"))
                cursor.execute(sql, (batch_task_id,))
                return [dict(row) for row in cursor.fetchall()]
            except sqlite3.Error as e:
                print(f"An error occurred on get paused sub tasks: {e.args[0]}")
                return []

    def requeue(self, sub_task_id: str, prompt_id: str):
        """继续执行：给子任务换上新的 prompt_id 并回到排队状态"""
        with sqlite3.connect(self.db_file) as conn:
            try:
                cursor = conn.cursor()
                sql = read_sql_file(os.path.join(self.sql_dir, "requeue.sql"))
                cursor.execute(sql, (prompt_id, sub_task_id))
                conn.commit()
                return cursor.rowcount
            except sqlite3.Error as e:
                print(f"An error occurred on requeue sub task: {e.args[0]}")
                return 0

    def pause_all_unfinished(self, batch_task_id: str):
        """重启恢复暂停任务：未完成的子任务统一回到 paused 等待继续"""
        with sqlite3.connect(self.db_file) as conn:
            try:
                cursor = conn.cursor()
                sql = read_sql_file(
                    os.path.join(self.sql_dir, "pause_all_unfinished.sql")
                )
                cursor.execute(sql, (batch_task_id,))
                conn.commit()
                return cursor.rowcount
            except sqlite3.Error as e:
                print(f"An error occurred on pause all unfinished: {e.args[0]}")
                return 0

    def count_active(self, batch_task_id: str):
        """还有多少个 running / pending 子任务；为 0 时暂停才真正生效"""
        with sqlite3.connect(self.db_file) as conn:
            try:
                cursor = conn.cursor()
                sql = read_sql_file(os.path.join(self.sql_dir, "count_active.sql"))
                cursor.execute(sql, (batch_task_id,))
                row = cursor.fetchone()
                return int(row[0]) if row else 0
            except sqlite3.Error as e:
                print(f"An error occurred on count active sub tasks: {e.args[0]}")
                return 0
