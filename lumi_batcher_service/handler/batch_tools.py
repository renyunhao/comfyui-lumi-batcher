# Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
# SPDX-License-Identifier: GPL-3.0-or-later
import asyncio
import copy
import json
import mimetypes
import os
import time
import traceback
import uuid
import aiofiles
import folder_paths
import server
import execution
from aiohttp import web
import itertools
from lumi_batcher_service.common.workspace import WorkSpaceManager
from lumi_batcher_service.dao.batch_task import BatchTaskDao
from lumi_batcher_service.dao.batch_sub_task import (
    BatchSubTaskDao,
    SubTaskActionType,
    SubTaskStatus,
)
from lumi_batcher_service.dao.resources import ResourcesDao
from lumi_batcher_service.constant.task import (
    CommonTaskStatus,
    StatusCounts,
    PackageInfo,
)
from lumi_batcher_service.common.file_path import (
    get_safe_upload_filename,
    is_path_under_directory,
    is_under_delete_white_dir,
    is_under_lumi_batcher,
)

# from lumi_batcher_service.controller.homeless.save_image import getSaveImageConfig
import mimetypes
from urllib.parse import unquote
from lumi_batcher_service.common.file import (
    get_file_absolute_path,
    get_file_info,
)
from lumi_batcher_service.thread.task_scheduler_manager import RunInThread
from lumi_batcher_service.common.error import getErrorResponse
from lumi_batcher_service.common.file import (
    get_file_absolute_path,
)
from lumi_batcher_service.controller.task.cancel_queue import (
    cancel_queue,
    deleteQueue,
    getRunningQueue,
)
from lumi_batcher_service.common.resolve_file import resolveFileManager
from lumi_batcher_service.controller.task.update_prompt import (
    updatePrompt,
    generateSimpleConfigDefault,
    apply_magic_expressions,
)
from lumi_batcher_service.controller.task.update_workflow import (
    update_workflow,
)
from lumi_batcher_service.controller.output.nodes import process_output_nodes
from lumi_batcher_service.controller.output.process import process_output
from lumi_batcher_service.common.delete_file import batch_delete_files
from lumi_batcher_service.common.validate_prompt import handle_validate_prompt


class BatchToolsHandler:
    instance = None
    workSpaceManager = WorkSpaceManager("comfyui_lumi_batcher_workspace")
    api_prefix = "/api/comfyui-lumi-batcher"

    resources_path = "resources"
    download_path = "download"
    db_path = "db"
    upload_path = "upload"
    snapshot_path = "task_snapshots"

    batchTaskDao: BatchTaskDao
    batchSubTaskDao: BatchSubTaskDao
    resourcesDao: ResourcesDao

    batch_tools_db_name = "batch_tools.db"

    def __init__(self):
        # 暴露运行时的当前实例
        BatchToolsHandler.instance = self
        self.customData = {}
        # 添加资源文件夹，未来可以将批量任务涉及的资源统一放到这里
        self.workSpaceManager.addDirectory(self.resources_path)
        # 添加数据存储文件夹，未来可以将数据统一放到这里
        self.workSpaceManager.addDirectory(self.db_path)
        # 添加下载文件夹，未来可以将下载的文件统一放到这里
        self.workSpaceManager.addDirectory(self.download_path)
        # 添加上传文件夹，未来可以将上传的文件统一放到这里
        self.workSpaceManager.addDirectory(self.upload_path)
        # 准备态任务的工作流 / 请求快照，避免大对象进入列表轮询的响应
        self.workSpaceManager.addDirectory(self.snapshot_path)

        db_path = self.workSpaceManager.getFilePath(
            self.db_path, self.batch_tools_db_name
        )

        # 关联本地数据库
        self.batchTaskDao = BatchTaskDao(db_path)
        self.batchSubTaskDao = BatchSubTaskDao(db_path)
        self.resourcesDao = ResourcesDao(db_path)

        # 创建资源上传控制实例
        from lumi_batcher_service.controller.resources.resource import (
            ResourceController,
        )

        self.resourceController = ResourceController(self)

        # 重启恢复：ComfyUI 异常关闭时任务会停在 waiting/running，
        # 把被中断的子任务统一收敛为 paused，供用户点「继续」重跑
        self.recover_interrupted_tasks()
        # 兜底：父任务已结束、但仍残留在 running/pending 的子任务标记失败
        self.batchSubTaskDao.update_on_reboot_room()

        def getApiPath(path):
            return "{}{}".format(self.api_prefix, path)

        @server.PromptServer.instance.routes.post(getApiPath("/batch-task/create"))
        async def createBatchTask(request):
            """
            提交任务：只创建并保存任务，进入「准备」状态。
            不生成叉乘、不建立子任务、不向 ComfyUI 队列投递任何 prompt。
            """
            try:
                json_data = await request.json()
                params_config = json_data["params_config"]
                prompt = json_data["prompt"]
                workflow = json_data["workflow"]
                task_name = json_data["task_name"]

                number = None
                if "number" in json_data:
                    number = float(json_data["number"])

                queue_count = self.getQueueCount(params_config)
                batch_task_id = str(uuid.uuid4())

                # 大对象存快照文件，extra 里只留完成钩子需要的轻量字段
                self.save_task_snapshot(
                    batch_task_id,
                    self.build_snapshot(json_data, prompt, workflow, number),
                )
                extra = {
                    "output_nodes": process_output_nodes(prompt),
                    "prompt": prompt,
                    "pause_requested": False,
                }

                self.batchTaskDao.insert_task(
                    batch_task_id,
                    task_name,
                    queue_count,
                    CommonTaskStatus.PREPARED.value,
                    json.dumps(params_config),
                    StatusCounts().to_json(),
                    PackageInfo().to_json(),
                    json.dumps([]),
                    json.dumps(extra),
                )

                return web.json_response(
                    {
                        "code": 200,
                        "message": "创建批量任务成功",
                        "data": {
                            "batch_task_id": batch_task_id,
                            "queue_count": queue_count,
                            "status": CommonTaskStatus.PREPARED.value,
                        },
                    }
                )
            except Exception as e:
                print("----create batch task error-----", e)
                traceback.print_exc()
                return web.json_response(getErrorResponse(str(e), "创建批量任务失败"))

        @server.PromptServer.instance.routes.post(getApiPath("/batch-task/update"))
        async def updatePreparedTask(request):
            """
            准备态反复编辑：只覆盖名称 / 参数 / 数量 / 快照，
            status、status_counts、package_info、messages 一律保留。
            """
            try:
                json_data = await request.json()
                batch_task_id = json_data["batch_task_id"]
                task = self.batchTaskDao.get_task_by_id(batch_task_id)
                if task is None:
                    return web.json_response(
                        getErrorResponse("", "任务不存在")
                    )
                if task.get("status") != CommonTaskStatus.PREPARED.value:
                    return web.json_response(
                        getErrorResponse("", "只有准备状态的任务可以编辑")
                    )

                params_config = json_data["params_config"]
                prompt = json_data["prompt"]
                workflow = json_data["workflow"]
                task_name = json_data["task_name"]
                number = None
                if "number" in json_data:
                    number = float(json_data["number"])

                queue_count = self.getQueueCount(params_config)
                self.save_task_snapshot(
                    batch_task_id,
                    self.build_snapshot(json_data, prompt, workflow, number),
                )

                extra = json.loads(task.get("extra", "{}"))
                extra["output_nodes"] = process_output_nodes(prompt)
                extra["prompt"] = prompt
                extra.setdefault("pause_requested", False)

                res = self.batchTaskDao.update_task_content(
                    batch_task_id,
                    task_name,
                    queue_count,
                    json.dumps(params_config),
                    json.dumps(extra),
                )
                if res is None:
                    raise Exception("update task content failed")

                return web.json_response(
                    {
                        "code": 200,
                        "message": "保存任务成功",
                        "data": {"queue_count": queue_count},
                    }
                )
            except Exception as e:
                return web.json_response(getErrorResponse(str(e), "保存任务失败"))

        @server.PromptServer.instance.routes.post(getApiPath("/batch-task/start"))
        async def startTask(request):
            """准备 -> 执行：此刻才生成叉乘并投递到 ComfyUI 队列"""
            try:
                json_data = await request.json()
                batch_task_id = json_data["batch_task_id"]
                task = self.batchTaskDao.get_task_by_id(batch_task_id)
                if task is None:
                    return web.json_response(getErrorResponse("", "任务不存在"))
                if task.get("status") != CommonTaskStatus.PREPARED.value:
                    return web.json_response(
                        getErrorResponse("", "只有准备状态的任务可以开始")
                    )

                # 准备态理论上没有子任务，这里兜底清一次，避免重复开始产生脏数据
                self.batchSubTaskDao.delete(batch_task_id)
                count = await self.submit_batch(batch_task_id)

                return web.json_response(
                    {
                        "code": 200,
                        "message": "任务已开始",
                        "data": {
                            "queue_count": count,
                            "status": CommonTaskStatus.WAITING.value,
                        },
                    }
                )
            except Exception as e:
                return web.json_response(getErrorResponse(str(e), "开始任务失败"))

        @server.PromptServer.instance.routes.post(getApiPath("/batch-task/pause"))
        async def pauseTask(request):
            """
            暂停：不打断当前正在执行的子任务，只移除该任务剩余的排队项。
            当前项执行结束后由 task_done 钩子把任务收敛为 paused。
            """
            try:
                json_data = await request.json()
                batch_task_id = json_data["batch_task_id"]
                task = self.batchTaskDao.get_task_by_id(batch_task_id)
                if task is None:
                    return web.json_response(getErrorResponse("", "任务不存在"))
                if task.get("status") not in (
                    CommonTaskStatus.WAITING.value,
                    CommonTaskStatus.RUNNING.value,
                ):
                    return web.json_response(
                        getErrorResponse("", "只有执行中的任务可以暂停")
                    )

                unfinished = self.batchSubTaskDao.get_unfinished(batch_task_id)
                unfinished_ids = [row["prompt_id"] for row in unfinished]
                running = getRunningQueue()
                running_id = running if running in unfinished_ids else None

                # 当前正在执行的已经是最后一项时，暂停没有意义：没有后续子任务
                # 可停，要求用户再点一次「继续」反而是多余操作。此时不写暂停
                # 标记，让 task_done 钩子按正常流程收敛终态并打包结果。
                paused_todo = [
                    sub
                    for sub in (self.batchSubTaskDao.get_paused(batch_task_id) or [])
                    if not self.sub_task_has_output(sub)
                ]
                others_active = [pid for pid in unfinished_ids if pid != running_id]
                if running_id and not others_active and not paused_todo:
                    return web.json_response(
                        {
                            "code": 200,
                            "message": "当前已是最后一个子任务，无需暂停，任务将正常结束",
                            "data": {"status": task.get("status"), "ignored": True},
                        }
                    )

                extra = json.loads(task.get("extra", "{}"))
                extra["pause_requested"] = True
                # 供列表轮询的收敛兜底判断时长，避开「刚点暂停」的竞态窗口
                extra["pause_requested_at"] = time.time()
                self.batchTaskDao.update_property(
                    batch_task_id, "extra", json.dumps(extra)
                )

                # 只删排队项，绝不调用 interruptQueue / 不传当前 running
                to_delete = [pid for pid in unfinished_ids if pid != running]
                if to_delete:
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(None, deleteQueue, to_delete)
                self.batchSubTaskDao.mark_paused(batch_task_id, running or "")

                if running and running in unfinished_ids:
                    # 当前项继续跑完，完成钩子负责切成 paused
                    status = task.get("status")
                else:
                    # 没有正在执行的项，直接停下
                    status = CommonTaskStatus.PAUSED.value
                    self.batchTaskDao.update_property(batch_task_id, "status", status)
                    extra["pause_requested"] = False
                    self.batchTaskDao.update_property(
                        batch_task_id, "extra", json.dumps(extra)
                    )

                return web.json_response(
                    {
                        "code": 200,
                        "message": "任务暂停中",
                        "data": {"status": status},
                    }
                )
            except Exception as e:
                return web.json_response(getErrorResponse(str(e), "暂停任务失败"))

        @server.PromptServer.instance.routes.post(getApiPath("/batch-task/resume"))
        async def resumeTask(request):
            """已暂停 -> 执行：按各子任务记录的参数组合重建 prompt 继续跑"""
            try:
                json_data = await request.json()
                batch_task_id = json_data["batch_task_id"]
                task = self.batchTaskDao.get_task_by_id(batch_task_id)
                if task is None:
                    return web.json_response(getErrorResponse("", "任务不存在"))
                if task.get("status") != CommonTaskStatus.PAUSED.value:
                    return web.json_response(
                        getErrorResponse("", "只有已暂停的任务可以继续")
                    )

                snapshot = self.load_task_snapshot(batch_task_id)
                extra = json.loads(task.get("extra", "{}"))
                prompt = snapshot.get("prompt") or extra.get("prompt", {})
                workflow = snapshot.get("workflow", {})
                number = snapshot.get("number", None)
                params_config = json.loads(task.get("params_config", "[]"))
                paused_subs = self.batchSubTaskDao.get_paused(batch_task_id)
                status_counts = json.loads(task.get("status_counts", "{}"))
                resumed = 0

                for sub in paused_subs:
                    # 已经生成过结果的子任务绝不重跑：暂停时完成钩子可能没
                    # 及时把状态从 running 改成 success，被一并标成 paused。
                    # 这里按实际输出兜底，并修正状态，避免下次继续时又重建。
                    if self.sub_task_has_output(sub):
                        self.batchSubTaskDao.update_property(
                            sub["id"], "status", SubTaskStatus.SUCCESS.value
                        )
                        continue
                    try:
                        params_combine = json.loads(sub.get("params_config", "[]"))
                        item = self.build_batch_item(
                            params_combine, params_config, prompt, workflow
                        )
                        queue_response = await self.post_prompt(
                            self.build_queue_request(item, snapshot, number)
                        )
                        if "error" in queue_response:
                            raise Exception(queue_response.get("error"))
                        new_prompt_id = queue_response.get(
                            "prompt_id", str(uuid.uuid4())
                        )
                        self.batchSubTaskDao.requeue(sub["id"], new_prompt_id)
                        resumed += 1
                    except Exception:
                        # 重建失败的子任务直接记为失败，避免任务永远卡在排队中
                        traceback.print_exc()
                        self.batchSubTaskDao.update_property(
                            sub["id"], "status", CommonTaskStatus.FAILED.value
                        )
                        failed_key = CommonTaskStatus.FAILED.value
                        status_counts[failed_key] = (
                            status_counts.get(failed_key, 0) + 1
                        )

                self.batchTaskDao.update_property(
                    batch_task_id, "status_counts", json.dumps(status_counts)
                )
                extra["pause_requested"] = False
                self.batchTaskDao.update_property(
                    batch_task_id, "extra", json.dumps(extra)
                )

                if self.batchSubTaskDao.count_active(batch_task_id) == 0:
                    # 没有可继续的子任务时，按「实际有输出的子任务数」收敛终态，
                    # 不依赖可能被漏写或重复累计的 status_counts
                    queue_count = task.get("queue_count", 0)
                    all_subs = self.batchSubTaskDao.get_result(batch_task_id) or []
                    done_count = sum(
                        1 for sub in all_subs if self.sub_task_has_output(sub)
                    )
                    if done_count == queue_count and queue_count > 0:
                        status = CommonTaskStatus.SUCCESS.value
                    elif done_count > 0:
                        status = CommonTaskStatus.PARTIAL_SUCCESS.value
                    else:
                        status = CommonTaskStatus.FAILED.value
                else:
                    status = CommonTaskStatus.WAITING.value
                self.batchTaskDao.update_property(batch_task_id, "status", status)

                return web.json_response(
                    {
                        "code": 200,
                        "message": "任务已继续",
                        "data": {
                            "resumed_count": resumed,
                            "status": status,
                        },
                    }
                )
            except Exception as e:
                return web.json_response(getErrorResponse(str(e), "继续任务失败"))

        @server.PromptServer.instance.routes.get(getApiPath("/batch-task/list"))
        async def getTaskList(request):
            try:
                resp_code = 200

                query = request.rel_url.query
                page_size = int(query.get("page_size", 10))
                page_num = int(query.get("page_num", 1))
                name = query.get("name", "")
                status = query.get("status", None)

                # 暂停收敛兜底：task_done 钩子漏触发时，列表轮询这里按实际
                # 队列状态收尾，避免任务永远停在「已请求暂停」
                self.settle_pause_requested_tasks()

                data, count = self.batchTaskDao.get_task_list(
                    name, status, page_size, (page_num - 1) * page_size
                )

                # results = [
                #     {**d, "params_config": json.loads(d["params_config"])} for d in data
                # ]

                response = {
                    "code": resp_code,
                    "message": "获取所有历史任务列表成功",
                    "data": {"data": data, "total": count},
                }

                return web.json_response(response)
            except Exception as e:
                return web.json_response(
                    getErrorResponse(e, "获取所有历史任务列表失败")
                )

        @server.PromptServer.instance.routes.get(getApiPath("/batch-task/detail"))
        async def getTaskDetail(request):
            try:
                resp_code = 200
                # 解析请求参数
                query = request.rel_url.query
                batch_task_id = str(query.get("batch_task_id", ""))

                # 读取数据库
                batch_task = self.batchTaskDao.get_task_by_id(batch_task_id)

                if batch_task is None:
                    return web.json_response(
                        getErrorResponse("", "获取任务详情失败, 任务Id不存在")
                    )

                return web.json_response(
                    {
                        "code": resp_code,
                        "message": "获取任务详情成功",
                        "data": {
                            **batch_task,
                            "package_info": json.loads(
                                batch_task.get("package_info", "{}")
                            ),
                            "resources_map": self.resourceController.get_resources_map(
                                batch_task_id
                            ),
                        },
                    }
                )
            except Exception as e:
                return web.json_response(getErrorResponse(e, "获取任务详情失败"))

        @server.PromptServer.instance.routes.post(getApiPath("/batch-task/update-name"))
        async def update_task_name(request):
            try:
                resp_code = 200
                json_data = await request.json()
                # 解析请求参数
                batch_task_id = json_data["batch_task_id"]

                task_name = json_data["name"]

                res = self.batchTaskDao.update_task_name(task_name, batch_task_id)

                if res is None:
                    raise Exception("task name update failed")

                response = {
                    "code": resp_code,
                    "message": "更新任务名称成功",
                    "data": res,
                }

                return web.json_response(response)
            except Exception as e:
                return web.json_response(getErrorResponse(e, "更新任务名称失败"))

        @server.PromptServer.instance.routes.get(
            getApiPath("/download-batch-task-result")
        )
        async def getBatchTaskResultDownload(request):
            try:
                # TODO 提供一个新的接口，入参为任务id，返回文件流
                query = request.rel_url.query
                # 解析请求参数
                batch_task_id = query.get("batch_task_id", "")

                if batch_task_id is None:
                    return web.json_response(
                        getErrorResponse("", "下载压缩包失败, 任务Id不能为空")
                    )

                batch_task = self.batchTaskDao.get_task_by_id(batch_task_id)
                file_name = batch_task.get("name", "results")
                # 可以考虑package_info中直接存可下载路径 + result_id + 状态
                package_info = batch_task.get(
                    "package_info",
                    {"file_path": "", "result_id": "", "status": "success"},
                )

                file_path = package_info.get("file_path", "")
                if file_path == "":
                    return web.json_response(
                        getErrorResponse("", "下载压缩包失败, 压缩包不存在")
                    )
                file_size = os.path.getsize(file_path)
                # 使用aiofiles打开文件进行异步读取
                async with aiofiles.open(file_path, "rb") as f:
                    # 创建响应对象，设置响应头
                    response = web.StreamResponse()
                    response.headers["CONTENT-DISPOSITION"] = (
                        f'attachment; filename="{file_name}.zip"'
                    )
                    response.headers["CONTENT-TYPE"] = "application/octet-stream"
                    response.headers["CONTENT-LENGTH"] = str(file_size)

                    # 准备发送响应
                    await response.prepare(request)

                    # 异步读取文件内容并发送
                    chunk = await f.read(1024)
                    while chunk:
                        await response.write(chunk)
                        chunk = await f.read(1024)

                    # 结束响应
                    await response.write_eof()

                    return response

            except Exception as e:
                return web.json_response(getErrorResponse(e, "下载压缩包失败"))

        @server.PromptServer.instance.routes.get(getApiPath("/batch-task/result"))
        async def getRoomResults(request):
            try:
                resp_code = 200
                # 解析请求参数
                query = request.rel_url.query
                batch_task_id = str(query.get("batch_task_id", ""))

                result = self.batchSubTaskDao.get_result(batch_task_id)

                results = process_output(result)

                response = {
                    "code": resp_code,
                    "message": "获取所有任务结果列表成功",
                    "data": {
                        "results": results,
                        "resourcesMap": self.resourceController.get_resources_map(
                            batch_task_id
                        ),
                    },
                }

                return web.json_response(response)
            except Exception as e:
                return web.json_response(getErrorResponse(e, "获取结果列表失败"))

        @server.PromptServer.instance.routes.get(
            getApiPath("/batch-task/unfinished-params")
        )
        async def get_unfinished_params(request):
            """返回所有非成功子任务的参数组合，供「复制未完成参数」重跑使用。"""
            try:
                batch_task_id = str(
                    request.rel_url.query.get("batch_task_id", "")
                )
                if not batch_task_id:
                    return web.json_response(
                        getErrorResponse(
                            ValueError("batch_task_id"), "缺少 batch_task_id"
                        )
                    )

                combines = []
                for sub in self.batchSubTaskDao.get_result(batch_task_id) or []:
                    # 以「有没有生成结果」为准，而不是子任务 status：
                    # 暂停、重启、完成钩子漏写都可能让 status 不准；已经出图的
                    # 组合不该被复制重跑，而 status=success 却没有输出的组合
                    # 恰恰是用户想补跑的。
                    if self.sub_task_has_output(sub):
                        continue
                    try:
                        combine = json.loads(sub.get("params_config", "[]"))
                    except (TypeError, ValueError):
                        continue
                    if isinstance(combine, list) and combine:
                        combines.append(combine)

                task = self.batchTaskDao.get_task_by_id(batch_task_id)
                params_config = []
                if task is not None:
                    try:
                        params_config = json.loads(task.get("params_config", "[]"))
                    except (TypeError, ValueError):
                        params_config = []

                return web.json_response(
                    {
                        "code": 200,
                        "message": "获取未完成参数成功",
                        "data": {
                            "combines": combines,
                            "params_config": params_config,
                        },
                    }
                )
            except Exception as e:
                return web.json_response(
                    getErrorResponse(e, "获取未完成参数失败")
                )

        @server.PromptServer.instance.routes.get(getApiPath("/view-image"))
        async def view_image(request):
            view_type = request.rel_url.query.get("type", "output")
            file_name = request.rel_url.query.get("file_name")

            if not file_name:
                return web.Response(status=400, text="Missing file_name parameter")

            # 自动解码已编码的参数
            try:
                file_name = unquote(file_name)
            except Exception:
                file_name = file_name

            if view_type == "output":
                base_dir = folder_paths.get_output_directory()
            elif view_type == "input":
                base_dir = folder_paths.get_input_directory()
            elif view_type == "resource":
                base_dir = self.workSpaceManager.getDirectory(self.resources_path)
            elif view_type == "download":
                base_dir = self.workSpaceManager.getDirectory(self.download_path)
            else:
                return web.Response(status=400, text="Invalid type parameter")

            file_path = os.path.join(base_dir, file_name)

            if not is_path_under_directory(file_path, base_dir):
                return web.Response(
                    status=400,
                    text="file path is not under allowed directory",
                )

            # 检查文件是否存在
            if not os.path.exists(file_path):
                new_file_path = get_file_absolute_path(file_path)

                if os.path.exists(new_file_path) and is_path_under_directory(
                    new_file_path, base_dir
                ):
                    file_path = new_file_path
                else:
                    return web.Response(status=404, text="Image not found")

            # 获取文件信息
            file_info = get_file_info(file_path)
            file_type = file_info.get("type")

            # 异步打开文件
            async with aiofiles.open(file_path, "rb") as file:
                file_data = await file.read()
                mime_type, _ = mimetypes.guess_type(file_path)

                headers = {
                    "Cache-Control": "public, max-age=2592000",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(len(file_data)),
                }

                if file_type == "video":
                    headers.update(
                        {
                            "Content-Disposition": "inline",
                            "X-Content-Type-Options": "nosniff",
                        }
                    )

                # 只通过content_type参数设置MIME类型
                return web.Response(
                    body=file_data,
                    content_type=mime_type,  # 移除了headers中的Content-Type
                    headers=headers,
                )

        @server.PromptServer.instance.routes.get(getApiPath("/input-files"))
        async def list_input_files(request):
            try:
                resp_code = 200
                content_type = request.rel_url.query.get("type", "image")
                allowed_types = {"image", "video", "audio"}
                if content_type not in allowed_types:
                    return web.json_response(
                        getErrorResponse(
                            ValueError(content_type), "type 参数不合法"
                        )
                    )

                input_dir = folder_paths.get_input_directory()
                files, _ = folder_paths.recursive_search(
                    input_dir, excluded_dir_names=[".git"]
                )
                files = folder_paths.filter_files_content_types(
                    files, [content_type]
                )
                # 统一返回相对 input 目录、以 / 分隔的路径
                data = sorted(f.replace(os.sep, "/") for f in files)

                response = {"code": resp_code, "message": "获取输入文件列表成功", "data": data}
                return web.json_response(response)
            except Exception as e:
                return web.json_response(
                    getErrorResponse(e, "获取输入文件列表失败")
                )

        @server.PromptServer.instance.routes.post(getApiPath("/batch-task/cancel"))
        async def cancelTask(request):
            try:
                resp_code = 200
                json_data = await request.json()
                # 解析请求参数
                batch_task_id = json_data["batch_task_id"]

                response = {"code": resp_code, "message": "取消任务成功", "data": True}

                # 取消时同步清掉暂停标记，避免完成钩子在收尾时又判成暂停
                current_task = self.batchTaskDao.get_task_by_id(batch_task_id)
                if current_task is not None:
                    task_extra = json.loads(current_task.get("extra", "{}"))
                    if task_extra.get("pause_requested"):
                        task_extra["pause_requested"] = False
                        self.batchTaskDao.update_property(
                            batch_task_id, "extra", json.dumps(task_extra)
                        )

                self.batchSubTaskDao.execute_action(
                    SubTaskActionType.CANCEL, batch_task_id
                )

                self.batchTaskDao.update_property(
                    batch_task_id, "status", CommonTaskStatus.CANCELLED.value
                )

                await cancel_queue(self.batchSubTaskDao.get_prompt_ids(batch_task_id))

                from lumi_batcher_service.controller.package.package import (
                    execute_package_batch_task,
                )

                asyncio.create_task(execute_package_batch_task(self, batch_task_id))

                return web.json_response(response)
            except Exception as e:
                return web.json_response(getErrorResponse(e, "取消任务失败"))

        @server.PromptServer.instance.routes.post(getApiPath("/batch-task/delete"))
        async def deleteTask(request):
            try:
                resp_code = 200
                json_data = await request.json()
                # 解析请求参数
                batch_task_id = json_data["batch_task_id"]
                output_directory = folder_paths.get_output_directory()

                response = {"code": resp_code, "message": "删除任务成功", "data": True}

                result = self.batchSubTaskDao.get_result(batch_task_id)

                results = process_output(result)

                need_delete_paths: list[str] = []

                for r in results:
                    l = r.get("list", [])
                    for i in l:
                        t = i.get("type", "")
                        v = i.get("value", "")
                        if t == "image" or t == "video" or t == "audio":
                            file_path = f"{output_directory}/{v}"
                            # 检查文件是否存在
                            if not os.path.exists(file_path):
                                new_file_path = get_file_absolute_path(file_path)

                                if os.path.exists(new_file_path):
                                    file_path = new_file_path

                            need_delete_paths.append(file_path)

                resourcesMap = self.resourceController.get_resources_map(batch_task_id)

                for r in resourcesMap.values():
                    need_delete_paths.append(
                        self.workSpaceManager.getFilePath(self.resources_path, r)
                    )

                need_delete_paths = list(set(need_delete_paths))

                # 过滤掉不在白名单目录下的路径
                need_delete_paths = [
                    p for p in need_delete_paths if is_under_delete_white_dir(p)
                ]

                # 清除批量任务产生的结果、依赖资源
                await batch_delete_files(need_delete_paths, concurrency=10)
                # 清除批量任务结果压缩包
                self.workSpaceManager.delete_file(
                    os.path.join(
                        self.workSpaceManager.getDirectory(self.download_path),
                        batch_task_id + ".tar",
                    )
                )
                # 清除批量任务
                self.batchTaskDao.delete(batch_task_id)
                # 清除准备态工作流快照
                self.delete_task_snapshot(batch_task_id)
                # 清除子任务
                self.batchSubTaskDao.delete(batch_task_id)
                # 清除批量任务涉及资源
                self.resourcesDao.delete(batch_task_id)

                return web.json_response(response)
            except Exception as e:
                return web.json_response(getErrorResponse(e, "删除任务失败"))

        @server.PromptServer.instance.routes.post(getApiPath("/batch-task/remove"))
        async def removeTask(request):
            try:
                resp_code = 200
                json_data = await request.json()
                # 解析请求参数
                batch_task_id = json_data["batch_task_id"]

                response = {"code": resp_code, "message": "清除任务成功", "data": True}

                # 仅移除任务记录，保留结果文件、依赖资源与压缩包
                self.batchTaskDao.delete(batch_task_id)
                self.batchSubTaskDao.delete(batch_task_id)
                self.resourcesDao.delete(batch_task_id)
                self.delete_task_snapshot(batch_task_id)

                return web.json_response(response)
            except Exception as e:
                return web.json_response(getErrorResponse(e, "清除任务失败"))

        @server.PromptServer.instance.routes.post(getApiPath("/resolve-file"))
        async def resolve_file(request):
            try:
                reader = await request.multipart()
                file_extension = ""
                file_path = ""

                while True:
                    field = await reader.next()
                    if not field:
                        break
                    if field.name == "file":
                        # 获取上传文件的名称
                        filename = get_safe_upload_filename(field.filename)
                        if filename is None:
                            return web.Response(status=400, text="Invalid filename")

                        # 指定服务器上的保存路径
                        directory = self.workSpaceManager.getDirectory(self.upload_path)
                        file_path = os.path.join(directory, filename)

                        if not is_path_under_directory(file_path, directory):
                            return web.Response(
                                status=400,
                                text="file path is not under upload directory",
                            )

                        size = 0
                        # 异步写入文件
                        async with aiofiles.open(file_path, "wb") as f:
                            while True:
                                chunk = await field.read_chunk()
                                if not chunk:
                                    break
                                size += len(chunk)
                                await f.write(chunk)
                    elif field.name == "file_extension":
                        file_extension = await field.text()

                if file_extension == "":
                    return web.Response(
                        status=400, text="No file_extension field in POST request"
                    )

                # 返回文件路径作为响应
                return web.json_response(
                    {
                        "code": 200,
                        "message": "上传文件成功",
                        "data": resolveFileManager.resolve_file(
                            file_path, file_extension
                        ),
                    }
                )
            except Exception as e:
                return web.json_response(getErrorResponse(e, "上传文件失败"))

        @server.PromptServer.instance.routes.get(getApiPath("/get-static-file"))
        async def get_static_file(request):
            file_path = request.rel_url.query.get("path")  # 从外部传入完整文件路径

            if not file_path:
                return web.Response(status=400, text="Missing path parameter")

            # 安全检查：确保路径在允许的目录范围内
            if not is_under_lumi_batcher(file_path):
                return web.Response(status=403, text="Access denied")

            # 检查文件是否存在
            if not os.path.exists(file_path):
                new_file_path = get_file_absolute_path(file_path)

                if os.path.exists(new_file_path):
                    file_path = new_file_path
                else:
                    return web.Response(status=404, text="File not found")

            # 异步读取文件
            async with aiofiles.open(file_path, "rb") as f:
                file_data = await f.read()

            # 自动检测MIME类型
            mime_type, _ = mimetypes.guess_type(file_path)

            # 设置缓存头
            return web.Response(
                body=file_data,
                headers={
                    "Content-Type": f"{mime_type}; charset=utf-8",
                    # "Cache-Control": "public, max-age=2592000",
                },
            )

        @server.PromptServer.instance.routes.get(getApiPath("/sw.js"))
        async def get_sw_js(request):
            # 获取当前文件的目录
            current_dir = os.path.dirname(os.path.abspath(__file__))
            # 拼接 sw.js 文件的路径
            sw_file_path = os.path.join(current_dir, "sw.js")
            # 读取 sw.js 文件的内容
            try:
                with open(sw_file_path, "r") as f:
                    sw_script = f.read()
                return web.Response(
                    text=sw_script, content_type="application/javascript"
                )
            except FileNotFoundError:
                return web.Response(status=404, text="Service Worker file not found")

    # ---------- 准备态 / 开始 / 暂停 状态机辅助 ----------

    def recover_interrupted_tasks(self):
        """
        启动时恢复被异常中断的任务。

        ComfyUI 被异常关闭时不会触发 task_done 钩子，任务会停在
        waiting/running，子任务停在 running/pending。这里冻结现场：把未完成
        的子任务统一转为 paused、任务收敛为 paused，与主动暂停的状态一致；
        用户点「继续」时再按各自的参数组合重建 prompt 重跑。
        若中断前实际已全部产出结果，则直接收敛为终态，省掉多余的一次「继续」。
        """
        tasks = self.batchTaskDao.get_unfinished_tasks() or []
        recovered = 0
        for task in tasks:
            task_id = task.get("id")
            if not task_id:
                continue
            try:
                self.batchSubTaskDao.pause_all_unfinished(task_id)
                self.finish_pause(task_id, task)
                recovered += 1
            except Exception as e:
                print(f"recover interrupted task {task_id} failed: {e}")
                traceback.print_exc()
        if recovered:
            print(f"recover {recovered} interrupted task(s) after reboot")
        return recovered

    def get_queue_prompt_ids(self):
        """取 ComfyUI 队列里仍在 running / pending 的 prompt_id；取不到返回 None"""
        try:
            current_queue = server.PromptServer.instance.prompt_queue.get_current_queue()
            result = set()
            for bucket in current_queue[:2]:
                for item in bucket:
                    result.add(item[1])
            return result
        except Exception as e:
            print("get queue prompt ids error", e)
            return None

    @staticmethod
    def sub_task_has_output(sub: dict) -> bool:
        """子任务是否已经有生成结果（与结果对比的输出判定保持一致）"""
        try:
            output = json.loads(sub.get("output") or "[]")
        except (TypeError, ValueError):
            return False
        if not isinstance(output, list):
            return False
        return any(
            isinstance(item, dict) and bool(item.get("values"))
            for item in output
        )

    def finish_pause(self, task_id: str, task: dict):
        """
        收敛暂停请求并清除标记：
        还有需要继续的子任务 -> paused；已经全部跑完 -> 直接收敛为终态。
        后者覆盖「当前项就是最后一项」以及钩子漏写状态的情况，避免任务
        停在「已暂停」还要用户多点一次「继续」。
        """
        try:
            extra = json.loads(task.get("extra") or "{}")
        except (ValueError, TypeError):
            extra = {}
        extra["pause_requested"] = False
        self.batchTaskDao.update_property(task_id, "extra", json.dumps(extra))

        need_resume = self.batchSubTaskDao.count_active(task_id) > 0 or any(
            not self.sub_task_has_output(sub)
            for sub in (self.batchSubTaskDao.get_paused(task_id) or [])
        )
        if need_resume:
            status = CommonTaskStatus.PAUSED.value
        else:
            # 与 resume 的终态判定口径一致：按实际有输出的子任务数，
            # 不依赖可能漏写 / 重复累计的 status_counts
            queue_count = task.get("queue_count", 0)
            all_subs = self.batchSubTaskDao.get_result(task_id) or []
            done_count = sum(
                1 for sub in all_subs if self.sub_task_has_output(sub)
            )
            if done_count == queue_count and queue_count > 0:
                status = CommonTaskStatus.SUCCESS.value
            elif done_count > 0:
                status = CommonTaskStatus.PARTIAL_SUCCESS.value
            else:
                status = CommonTaskStatus.FAILED.value
        self.batchTaskDao.update_property(task_id, "status", status)
        return status

    def settle_pause_requested_tasks(self):
        """
        暂停收敛兜底，由列表轮询触发。

        正常路径是 task_done 钩子在最后一个子任务跑完后把任务置为 paused；
        但「当前项已经是最后一个子任务」等边界下，钩子可能漏触发，或没把
        子任务状态从 running 改掉，导致 count_active 永远不为 0，任务就一直
        停在 running + pause_requested，前端始终显示「已请求暂停」。
        这里按 ComfyUI 队列的实际状态再兜一次，不依赖钩子时机。
        """
        tasks = self.batchTaskDao.get_pause_requested_unfinished() or []
        for task in tasks:
            task_id = task.get("id")
            if not task_id:
                continue
            if self.batchSubTaskDao.count_active(task_id) == 0:
                self.finish_pause(task_id, task)
                continue

            # 子任务状态可能没被钩子更新：队列里已经没有本任务的 active 项，
            # 说明它们实际都已执行结束，把残留项标为 paused 供「继续」重建。
            # 请求至少经过 3 秒才启用这个判断，避开「刚点暂停、当前项还没
            # 从队列移除」的瞬间；老数据没有时间戳则立即生效，便于自愈。
            try:
                requested_at = float(
                    json.loads(task.get("extra") or "{}").get(
                        "pause_requested_at", 0
                    )
                    or 0
                )
            except (ValueError, TypeError):
                requested_at = 0
            if requested_at and time.time() - requested_at < 3:
                continue

            queue_ids = self.get_queue_prompt_ids()
            if queue_ids is None:
                continue
            active_subs = self.batchSubTaskDao.get_unfinished(task_id) or []
            if not any(row.get("prompt_id") in queue_ids for row in active_subs):
                self.batchSubTaskDao.pause_all_unfinished(task_id)
                self.finish_pause(task_id, task)

    @staticmethod
    def build_snapshot(json_data, prompt, workflow, number):
        """提交请求里需要延迟到「开始」时才用的大对象"""
        return {
            "workflow": workflow,
            "prompt": prompt,
            "client_id": json_data.get("client_id", ""),
            "auth_token_comfy_org": json_data.get("auth_token_comfy_org", ""),
            "api_key_comfy_org": json_data.get("api_key_comfy_org", ""),
            "number": number,
        }

    def _snapshot_file(self, batch_task_id):
        return self.workSpaceManager.getFilePath(
            self.snapshot_path, f"{batch_task_id}.json"
        )

    def save_task_snapshot(self, batch_task_id, payload):
        try:
            with open(self._snapshot_file(batch_task_id), "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"save task snapshot failed: {e}")
            return False

    def load_task_snapshot(self, batch_task_id):
        path = self._snapshot_file(batch_task_id)
        if not os.path.exists(path):
            return {}
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"load task snapshot failed: {e}")
            return {}

    def delete_task_snapshot(self, batch_task_id):
        try:
            path = self._snapshot_file(batch_task_id)
            if os.path.exists(path):
                os.remove(path)
        except Exception as e:
            print(f"delete task snapshot failed: {e}")

    @staticmethod
    def build_queue_request(item, snapshot, number):
        body = {
            "client_id": snapshot.get("client_id", ""),
            "prompt": item["prompt"],
            "extra_data": {
                "auth_token_comfy_org": snapshot.get("auth_token_comfy_org", ""),
                "api_key_comfy_org": snapshot.get("api_key_comfy_org", ""),
                "extra_pnginfo": {"workflow": item["workflow"]},
            },
        }
        if number == -1:
            body["front"] = True
        elif number is not None:
            body["number"] = number
        return body

    def build_batch_item(self, params_combine, params_config, prompt, workflow):
        """按单个参数组合重建 prompt/workflow，暂停后继续执行时使用"""
        temp_prompt = copy.deepcopy(prompt)
        temp_workflow = copy.deepcopy(workflow)
        simple_config = generateSimpleConfigDefault(params_config)
        for config_item in params_combine:
            updatePrompt(temp_prompt, config_item, simple_config)
            update_workflow(temp_workflow, temp_prompt, config_item)
        apply_magic_expressions(temp_prompt, temp_workflow, prompt)
        return {
            "prompt": temp_prompt,
            "workflow": {
                **temp_workflow,
                "ba_batch_tools_prompt_combine": list(params_combine),
                "ba_batch_tools_params_config": simple_config,
            },
        }

    async def submit_batch(self, batch_task_id):
        """把准备态任务的全部叉乘组合投递到 ComfyUI 队列"""
        task = self.batchTaskDao.get_task_by_id(batch_task_id)
        snapshot = self.load_task_snapshot(batch_task_id)
        extra = json.loads(task.get("extra", "{}"))
        params_config = json.loads(task.get("params_config", "[]"))
        prompt = snapshot.get("prompt") or extra.get("prompt", {})
        workflow = snapshot.get("workflow", {})
        number = snapshot.get("number", None)

        loop = asyncio.get_running_loop()
        functionRes = await loop.run_in_executor(
            None, self.generateBatchParams, params_config, prompt, workflow
        )
        if not functionRes:
            # 没有可生成的组合时直接收敛为失败，避免永远停在排队中
            self.batchTaskDao.update_property(
                batch_task_id, "status", CommonTaskStatus.FAILED.value
            )
            self.batchTaskDao.update_property(
                batch_task_id, "messages", json.dumps(["没有可生成的任务"])
            )
            return 0

        statusCounts = StatusCounts()
        errorMessages = []
        queue_count = task.get("queue_count", len(functionRes))

        async def process_item(item):
            params_config_str = json.dumps(
                item["workflow"].get("ba_batch_tools_prompt_combine", [])
            )
            try:
                queue_response = await self.post_prompt(
                    self.build_queue_request(item, snapshot, number)
                )
                prompt_id = queue_response.get("prompt_id", str(uuid.uuid4()))
                error = queue_response.get("error", "创建任务失败，请检查工作流！")
                if "error" in queue_response:
                    self.batchSubTaskDao.insert_task(
                        batch_task_id,
                        prompt_id,
                        params_config_str,
                        SubTaskStatus.FAILED.value,
                        json.dumps(error),
                        json.dumps([]),
                    )
                    statusCounts.create_failed += 1
                    errorMessages.append(error)
                else:
                    self.batchSubTaskDao.insert_task(
                        batch_task_id,
                        prompt_id,
                        params_config_str,
                        SubTaskStatus.PENDING.value,
                        json.dumps(error),
                        json.dumps([]),
                    )
            except Exception:
                self.batchSubTaskDao.insert_task(
                    batch_task_id,
                    str(uuid.uuid4()),
                    params_config_str,
                    SubTaskStatus.FAILED.value,
                    json.dumps("创建任务失败，请检查工作流！"),
                    json.dumps([]),
                )
                statusCounts.create_failed += 1
                traceback.print_exc()

        await asyncio.gather(*[process_item(item) for item in functionRes])

        if statusCounts.create_failed == queue_count and queue_count > 0:
            self.batchTaskDao.update_property(
                batch_task_id, "status", CommonTaskStatus.FAILED.value
            )
            self.batchTaskDao.update_property(
                batch_task_id, "messages", json.dumps(errorMessages)
            )
        else:
            self.batchTaskDao.update_property(
                batch_task_id, "status", CommonTaskStatus.WAITING.value
            )
            if statusCounts.create_failed > 0:
                self.batchTaskDao.update_property(
                    batch_task_id, "status_counts", statusCounts.to_json()
                )

        def dataUploadToRoom():
            try:
                self.resourceController.resourceUpload.createUploadTask(
                    batch_task_id, params_config
                )
            except Exception as e:
                print(f"Exception in createFileUpload: {e}")
                traceback.print_exc()

        RunInThread(dataUploadToRoom)
        return len(functionRes)

    def generateBatchParams(self, params_config, prompt, workflow):
        try:
            resultList = []
            paramsValuesList = []

            def pushParamsValues(index: int, value: dict):
                # 使用条件判断来确保 i 在合理的范围内
                if index >= 0 and index < len(paramsValuesList):
                    paramsValuesList[i].append(
                        {
                            **value,
                        }
                    )
                # 如果 i 不在列表中，则推入一个新的列表
                else:
                    paramsValuesList.append(
                        [
                            {
                                **value,
                            }
                        ]
                    )

            for i, config in enumerate(params_config):
                if "type" in config:
                    type = config["type"]
                    if type == "group":
                        max_item_length = len(
                            max(config["values"], key=lambda x: len(x["values"]))[
                                "values"
                            ]
                        )

                        for cur_ind in range(max_item_length):
                            group_value_config = {"type": "group", "values": []}

                            for subConfig in config["values"]:
                                if cur_ind < len(subConfig["values"]):
                                    group_value_config["values"].append(
                                        {
                                            **subConfig,
                                            "value": subConfig["values"][cur_ind],
                                        }
                                    )
                                else:
                                    # index匹配不上时，默认取第0个
                                    group_value_config["values"].append(
                                        {**subConfig, "value": subConfig["values"][0]}
                                    )

                            pushParamsValues(i, group_value_config)
                    else:
                        for value in config["values"]:
                            pushParamsValues(i, {**config, "value": value})
                else:
                    # TODO: 处理参数错误场景
                    print("Invalid params")

            product = list(itertools.product(*paramsValuesList))

            def getSortedParam(obj):
                if "type" in obj:
                    if obj["type"] == "group":
                        return obj["values"][0]["internal_name"]
                    else:
                        return obj["internal_name"]
                else:
                    return ""

            productSorted = sorted(product, key=getSortedParam)

            for paramsCombine in productSorted:
                temp_prompt = copy.deepcopy(prompt)
                temp_workflow = copy.deepcopy(workflow)
                ba_batch_tools_params_config = generateSimpleConfigDefault(
                    params_config
                )
                for config_item in paramsCombine:
                    updatePrompt(temp_prompt, config_item, ba_batch_tools_params_config)
                    update_workflow(temp_workflow, temp_prompt, config_item)

                # 重新解析 %节点标题.参数名% 魔法表达式，使其跟随子任务参数值
                apply_magic_expressions(temp_prompt, temp_workflow, prompt)

                resultList.append(
                    {
                        "prompt": temp_prompt,
                        "workflow": {
                            **temp_workflow,
                            "ba_batch_tools_prompt_combine": list(paramsCombine),
                            "ba_batch_tools_params_config": ba_batch_tools_params_config,
                        },
                    }
                )

            # print('----product-----', json.dumps(product))
            # print('----resultList-----', json.dumps(resultList))

            return resultList
        except Exception:
            traceback.print_exc()
            return []

    def getQueueCount(self, params_config):
        count = 1

        if len(params_config) == 0:
            return 0
        else:
            for _, config in enumerate(params_config):
                if "type" in config:
                    type = config["type"]
                    if type == "group":
                        max_item_length = len(
                            max(config["values"], key=lambda x: len(x["values"]))[
                                "values"
                            ]
                        )
                        count *= max_item_length
                    else:
                        count *= len(config["values"])

        return count

    async def post_prompt(self, json_data):
        json_data = server.PromptServer.instance.trigger_on_prompt(json_data)

        if "number" in json_data:
            number = float(json_data["number"])
        else:
            number = server.PromptServer.instance.number
            if "front" in json_data:
                if json_data["front"]:
                    number = -number

            server.PromptServer.instance.number += 1

        if "prompt" in json_data:
            prompt = json_data["prompt"]
            prompt_id = str(uuid.uuid4())
            valid = await handle_validate_prompt(prompt_id, prompt)
            extra_data = {}
            if "extra_data" in json_data:
                extra_data = json_data["extra_data"]

            if "client_id" in json_data:
                extra_data["client_id"] = json_data["client_id"]
            if valid[0]:
                outputs_to_execute = valid[2]
                sensitive = {}
                for sensitive_val in execution.SENSITIVE_EXTRA_DATA_KEYS:
                    if sensitive_val in extra_data:
                        sensitive[sensitive_val] = extra_data.pop(sensitive_val)
                server.PromptServer.instance.prompt_queue.put(
                    (
                        number,
                        prompt_id,
                        prompt,
                        extra_data,
                        outputs_to_execute,
                        sensitive,
                    )
                )
                response = {
                    "prompt_id": prompt_id,
                    "number": number,
                    "node_errors": valid[3],
                }
                return response
            else:
                return {"error": valid[1], "node_errors": valid[3]}
        else:
            return {"error": "no prompt", "node_errors": []}
