// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { useMemo, useState } from 'react';

import { Message } from '@arco-design/web-react';

import { I18n } from '@common/i18n';
import {
  ParamsConfigType,
  ParamsConfigTypeItem,
} from '@common/type/batch-task';
import { uuid } from '@common/utils/uuid';
import {
  cancelTask,
  CombineItem,
  deleteTask,
  getUnfinishedParams,
  pauseTask,
  removeTask,
  resumeTask,
  startTask,
  TaskInfo,
} from '@api/batch-task';
import { useContainerStore } from '@common/state/container';
import { useResultViewStore } from '@src/result-view/store';
import { useCreatorStore } from '@src/create-task/store';
import { parseJsonStr } from '@common/utils/json';
import { validateWorkflowParamsConfig } from '@src/create-task/utils/validate-workflow';
import { ContainerTypeEnum } from '@common/constant/container';
import {
  sendBatchToolsCancelTask,
  sendBatchToolsCopyParams,
  sendBatchToolsPreviewResult,
} from '../../../../data/points';
import { TaskStatusEnum } from '@src/task-list/constants';

type FlatCombine = Map<string, { item: CombineItem; value: any }>;

const leafKey = (item: CombineItem) =>
  `${item.nodeId ?? ''}::${item.internal_name ?? ''}`;

/** 把一个子任务组合摊平为「参数 key -> 当次取值」，group 内的子项也要展开 */
const flattenCombine = (combine: CombineItem[]): FlatCombine => {
  const map: FlatCombine = new Map();
  combine.forEach((item) => {
    if (!item || item.category === 'system') {
      return;
    }
    const push = (child: CombineItem) => {
      if (
        !child ||
        child.category === 'system' ||
        child.nodeId === undefined ||
        !child.internal_name
      ) {
        return;
      }
      map.set(leafKey(child), { item: child, value: child.value });
    };
    if (item.type === 'group' && Array.isArray(item.values)) {
      item.values.forEach(push);
    } else {
      push(item);
    }
  });
  return map;
};

/**
 * 把未完成组合还原为可直接提交的 paramsConfig：
 * 多个参数用 group 按组合下标对齐，保证只生成这些组合、不发生叉乘膨胀。
 */
const buildUnfinishedParamsConfig = (
  combines: CombineItem[][],
): ParamsConfigType => {
  const flatList = combines.map(flattenCombine);
  const keys: string[] = [];
  flatList.forEach((flat) =>
    flat.forEach((_, key) => {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }),
  );

  if (!keys.length) {
    return [];
  }

  const children: ParamsConfigType = keys.map((key) => {
    const sample = flatList
      .map((flat) => flat.get(key))
      .find((entry) => !!entry);
    const item = sample?.item ?? {};
    return {
      type: 'data',
      nodeId: item.nodeId,
      name: item.name ?? String(item.internal_name ?? ''),
      internal_name: item.internal_name,
      config_id: uuid(),
      values: flatList.map((flat) => flat.get(key)?.value ?? ''),
    } as ParamsConfigTypeItem;
  });

  if (children.length === 1) {
    return children;
  }
  return [
    {
      type: 'group',
      nodeId: undefined,
      name: '',
      internal_name: undefined,
      config_id: uuid(),
      values: children,
    } as ParamsConfigTypeItem,
  ];
};

export default function useHandler(task: TaskInfo) {
  const { changeType } = useContainerStore();
  const { setTask, openDrawer } = useResultViewStore();
  const { copy: copyTask } = useCreatorStore();
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [pauseLoading, setPauseLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [copyUnfinishedLoading, setCopyUnfinishedLoading] = useState(false);

  return useMemo(() => {
    const { id, name, status } = task;

    return {
      /** 准备 -> 执行：只有这一步才会把任务投递到 ComfyUI 队列 */
      async start() {
        try {
          setStartLoading(true);
          await startTask(id);
          Message.success(I18n.t('task_started', {}, '任务已开始执行'));
        } catch (error) {
          Message.error(I18n.t('task_start_failed', {}, '开始任务失败'));
        } finally {
          setStartLoading(false);
        }
      },
      /** 暂停：返回 requested（已请求）/ ignored（最后一项，无需暂停）/ failed */
      async pause(): Promise<'requested' | 'ignored' | 'failed'> {
        try {
          setPauseLoading(true);
          const res = await pauseTask(id);
          if (res?.data?.ignored) {
            Message.info(
              I18n.t(
                'task_pause_ignored_last',
                {},
                '当前已是最后一个子任务，无需暂停，任务将正常结束',
              ),
            );
            return 'ignored';
          }
          Message.success(
            I18n.t(
              'task_pause_requested',
              {},
              '已请求暂停，当前任务结束后将停止后续执行',
            ),
          );
          return 'requested';
        } catch (error) {
          Message.error(I18n.t('task_pause_failed', {}, '暂停任务失败'));
          return 'failed';
        } finally {
          setPauseLoading(false);
        }
      },
      /** 已暂停 -> 执行：继续跑剩余子任务 */
      async resume() {
        try {
          setResumeLoading(true);
          await resumeTask(id);
          Message.success(I18n.t('task_resumed', {}, '任务已继续执行'));
        } catch (error) {
          Message.error(I18n.t('task_resume_failed', {}, '继续任务失败'));
        } finally {
          setResumeLoading(false);
        }
      },
      /** 准备态编辑：把参数带回创建页，保存时更新原任务而不是新建 */
      async edit() {
        const paramsConfig = parseJsonStr<ParamsConfigType>(
          task.params_config,
          [],
        );
        if (
          await validateWorkflowParamsConfig(
            paramsConfig,
            I18n.t(
              'edit_task_workflow_incompatible',
              {},
              '此任务与当前工作流不兼容，无法编辑',
            ),
          )
        ) {
          useCreatorStore.setState({
            taskName: task.name,
            paramsConfig,
            editingTaskId: task.id,
          });
          changeType(ContainerTypeEnum.Creator);
        }
      },
      async cancel() {
        try {
          setCancelLoading(true);
          sendBatchToolsCancelTask();
          await cancelTask(id);
          Message.success(
            I18n.t('cancel_task_successfully', {}, '取消任务成功'),
          );
        } catch (error) {
          Message.error(I18n.t('cancel_task_failed', {}, '取消任务失败'));
        } finally {
          setCancelLoading(false);
        }
      },
      /**
       * @description 删除任务
       */
      async delete() {
        try {
          setDeleteLoading(true);
          // 先取消任务
          if (
            [TaskStatusEnum.Running, TaskStatusEnum.Waiting].includes(status)
          ) {
            await cancelTask(id);
          }
          await deleteTask(id);
          Message.success(
            I18n.t('delete_task_successfully', {}, '删除任务成功'),
          );
        } catch (error) {
          Message.error(I18n.t('delete_task_failed', {}, '删除任务失败'));
        } finally {
          setDeleteLoading(false);
        }
      },
      restart() {
        Message.error(I18n.t('pending', {}, '待处理'));
      },
      diffResult() {
        sendBatchToolsPreviewResult();
        setTask(id, name, task.params_config);
        openDrawer();
      },
      async copy() {
        sendBatchToolsCopyParams();
        const paramsConfig = parseJsonStr<ParamsConfigType>(
          task.params_config,
          [],
        );
        if (await validateWorkflowParamsConfig(paramsConfig)) {
          copyTask({
            taskName: task.name,
            paramsConfig,
          });
          changeType(ContainerTypeEnum.Creator);
          Message.success({
            content: I18n.t(
              'parameter_copied_successfully',
              {},
              '参数复制成功',
            ),
            duration: 2000,
          });
        }
      },
      /** 只复制未完成子任务的参数组合，精确还原后带入创建页重跑 */
      async copyUnfinished() {
        try {
          setCopyUnfinishedLoading(true);
          const data = await getUnfinishedParams(id);
          const combines = data?.combines ?? [];
          if (!combines.length) {
            Message.info(
              I18n.t('no_unfinished_params', {}, '该任务没有未完成的参数'),
            );
            return;
          }
          const paramsConfig = buildUnfinishedParamsConfig(combines);
          if (!paramsConfig.length) {
            Message.warning(
              I18n.t(
                'unfinished_params_empty',
                {},
                '未完成的参数组合为空，无法复制',
              ),
            );
            return;
          }
          if (
            await validateWorkflowParamsConfig(
              paramsConfig,
              I18n.t(
                'unfinished_params_incompatible',
                {},
                '未完成参数与当前工作流不兼容，无法复制',
              ),
            )
          ) {
            copyTask({
              taskName: `${name}[未完成]`,
              paramsConfig,
            });
            changeType(ContainerTypeEnum.Creator);
            Message.success({
              content: I18n.t(
                'unfinished_params_copied',
                { n: combines.length },
                `已复制 ${combines.length} 组未完成参数`,
              ),
              duration: 2000,
            });
          }
        } catch (error) {
          console.error('复制未完成参数失败', error);
          Message.error(
            I18n.t('copy_unfinished_params_failed', {}, '复制未完成参数失败'),
          );
        } finally {
          setCopyUnfinishedLoading(false);
        }
      },
      /**
       * @description 清除任务：仅移除任务记录，不删除结果文件
       */
      async remove() {
        try {
          setRemoveLoading(true);
          // 运行中/等待中的任务先取消，避免记录删除后队列仍在执行
          if (
            [TaskStatusEnum.Running, TaskStatusEnum.Waiting].includes(status)
          ) {
            await cancelTask(id);
          }
          await removeTask(id);
          Message.success(
            I18n.t('remove_task_successfully', {}, '清除任务成功'),
          );
        } catch (error) {
          Message.error(I18n.t('remove_task_failed', {}, '清除任务失败'));
        } finally {
          setRemoveLoading(false);
        }
      },
      deleteLoading,
      cancelLoading,
      removeLoading,
      startLoading,
      pauseLoading,
      resumeLoading,
      copyUnfinishedLoading,
    };
  }, [
    task,
    deleteLoading,
    cancelLoading,
    removeLoading,
    startLoading,
    pauseLoading,
    resumeLoading,
    copyUnfinishedLoading,
  ]);
}
