// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { Comfy } from '@typings/comfy';
import { ParamsConfigType } from '@common/type/batch-task';
import requestClient, { apiPrefix } from './request-instance';
import { PackageStatusEnum, TaskStatusEnum } from '@src/task-list/constants';
import { BatchTaskSceneEnum } from '@common/constant/batch';

export interface CreateBatchTaskRequest {
  client_id: string;
  prompt: Comfy.WorkflowOutput;
  workflow: any;
  auth_token_comfy_org: string;
  api_key_comfy_org: string;
  extra_data: {
    extra_pnginfo: {
      workflow: Comfy.GraphPrompt['workflow'];
    };
  };
  task_name: string;
  params_config: ParamsConfigType;
  number?: number;
}

/**
 * @description 创建批量任务
 */
export async function createBatchTask(data: CreateBatchTaskRequest) {
  const res = await requestClient.post<any>(
    `${apiPrefix}/batch-task/create`,
    data,
  );
  return res.data;
}

export interface TaskInfo {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  status_counts: {
    create_failed: number;
    waiting: number;
    failed: number;
    success: number;
    uploading: number;
    uploading_failed: number;
  };
  queue_count: number;
  params_config: string;
  extra: Record<string, any>;
  package_info: {
    result: string;
    status: PackageStatusEnum;
    message: string;
  };
  messages: string[];
  created_by: string;
  status: TaskStatusEnum;
  // 支持本地批量任务导入新增
  scene: BatchTaskSceneEnum;
  resources_map: Record<string, string>;
}

/**
 * @description 获取房间内任务列表（未来会支持筛选和分页）
 */
export async function getTaskList(
  taskName = '',
  pageSize = 10,
  offset = 0,
  status: TaskStatusEnum[] = [],
) {
  const res = await requestClient.get<{
    data: {
      data: Array<TaskInfo>;
      total: number;
    };
  }>(
    `${apiPrefix}/batch-task/list?` +
      `name=${taskName}&` +
      `page_size=${pageSize}&` +
      `page_num=${offset}&` +
      `status=${status}&` +
      'order_by=created_at desc',
  );
  return res.data;
}

export type UpdateBatchTaskRequest = CreateBatchTaskRequest & {
  batch_task_id: string;
};

/** 保存准备状态任务的编辑内容（状态字段由后端保留） */
export async function updateBatchTask(data: UpdateBatchTaskRequest) {
  const res = await requestClient.post<any>(
    `${apiPrefix}/batch-task/update`,
    data,
  );
  return res.data;
}

/** 开始执行：只有准备状态的任务可以调用 */
export async function startTask(id: string) {
  const res = await requestClient.post<any>(`${apiPrefix}/batch-task/start`, {
    batch_task_id: id,
  });
  return res.data;
}

/** 暂停：不打断当前执行项，等它跑完后停止后续执行 */
export async function pauseTask(id: string) {
  const res = await requestClient.post<any>(`${apiPrefix}/batch-task/pause`, {
    batch_task_id: id,
  });
  return res.data;
}

/** 继续：从已暂停状态恢复剩余子任务 */
export async function resumeTask(id: string) {
  const res = await requestClient.post<any>(`${apiPrefix}/batch-task/resume`, {
    batch_task_id: id,
  });
  return res.data;
}

export interface CombineItem {
  type?: string;
  nodeId?: string | number;
  name?: string;
  internal_name?: string;
  config_id?: string;
  category?: string;
  value?: any;
  values?: CombineItem[];
}

export interface UnfinishedParamsResponse {
  /** 每个未完成子任务对应的参数组合（每项带当次使用的 value） */
  combines: CombineItem[][];
  /** 原任务的参数配置，供前端比对参考 */
  params_config: ParamsConfigType;
}

/** 获取任务中所有非成功子任务的参数组合，用于复制后重跑 */
export async function getUnfinishedParams(taskId: string) {
  const res = await requestClient.get<ApiResWrap<UnfinishedParamsResponse>>(
    `${apiPrefix}/batch-task/unfinished-params`,
    { params: { batch_task_id: taskId } },
  );
  return res.data.data;
}

/**
 * @description 取消任务
 */
export async function cancelTask(id: string) {
  const res = await requestClient.post<any>(`${apiPrefix}/batch-task/cancel`, {
    batch_task_id: id,
  });
  return res.data;
}

/**
 * @description 删除任务
 */
export async function deleteTask(id: string) {
  const res = await requestClient.post<any>(`${apiPrefix}/batch-task/delete`, {
    batch_task_id: id,
  });
  return res.data;
}

/**
 * @description 清除任务（仅移除任务记录，不删除结果文件）
 */
export async function removeTask(id: string) {
  const res = await requestClient.post<any>(`${apiPrefix}/batch-task/remove`, {
    batch_task_id: id,
  });
  return res.data;
}

export const queuePrompt = async (
  number: number,
  output: any,
  workflow: any,
) => {
  const body: {
    client_id: string;
    prompt: string;
    extra_data: {
      extra_pnginfo: {
        workflow: any;
      };
    };
    front?: boolean;
    number?: number;
  } = {
    client_id: sessionStorage.getItem('clientId') ?? '',
    prompt: output,
    extra_data: { extra_pnginfo: { workflow } },
  };

  if (number === -1) {
    body.front = true;
  } else if (number !== 0) {
    body.number = number;
  }

  const res = await requestClient.post('/prompt', body);

  return res.data;
};

/**
 * @desc 更新任务名称接口
 * @param taskId 任务id
 * @param taskName 任务最新名称
 * @returns 接口执行结果
 */
export const updateTaskName = async (taskId: string, taskName: string) =>
  await requestClient.post(`${apiPrefix}/batch-task/update-name`, {
    batch_task_id: taskId,
    name: taskName,
  });

/** 获取任务详情 */
export const getTaskDetail = async (taskId: string) =>
  await requestClient.get<ApiResWrap<TaskInfo>>(
    `${apiPrefix}/batch-task/detail`,
    {
      params: { batch_task_id: taskId },
    },
  );
