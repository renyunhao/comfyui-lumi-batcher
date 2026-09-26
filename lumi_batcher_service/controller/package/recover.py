# Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
# SPDX-License-Identifier: GPL-3.0-or-later
import asyncio
import threading
import traceback
from lumi_batcher_service.handler.batch_tools import BatchToolsHandler
from .package import execute_package_batch_task


def _run_coro_in_new_loop(coro_factory):
    """在独立线程的事件循环中运行协程。

    新版 ComfyUI 导入插件时主线程已存在运行中的事件循环，直接
    run_until_complete 会抛出 "Cannot run the event loop while another
    loop is running"，因此这里在专用线程内创建并运行独立的事件循环。
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(coro_factory())
    except Exception as e:
        print("recover_package task error", e)
        traceback.print_exc()
    finally:
        loop.close()


def recover_package(batchToolsHandler: BatchToolsHandler):
    try:
        # 查询所有打包未完成的任务
        batchTaskList = batchToolsHandler.batchTaskDao.get_unpackage_list()
        for batchTask in batchTaskList:
            batch_task_id = batchTask.get("id", "")
            if batch_task_id == "":
                continue
            # 每个任务在独立线程的事件循环中执行，避免与主线程事件循环冲突，
            # 同时通过 join 保持启动时同步恢复的语义
            worker = threading.Thread(
                target=_run_coro_in_new_loop,
                args=(
                    lambda task_id=batch_task_id: execute_package_batch_task(
                        batchToolsHandler, task_id
                    ),
                ),
                daemon=True,
            )
            worker.start()
            worker.join()
    except Exception as e:
        print(e)
        traceback.print_exc()
        pass
