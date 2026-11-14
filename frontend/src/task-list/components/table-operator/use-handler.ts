// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { useMemo, useState } from 'react';

import { Message } from '@arco-design/web-react';

import { I18n } from '@common/i18n';
import { ParamsConfigType } from '@common/type/batch-task';
import {
  cancelTask,
  deleteTask,
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
      /** 暂停：不打断当前执行项，跑完后由后端收敛为已暂停 */
      async pause() {
        try {
          setPauseLoading(true);
          await pauseTask(id);
          Message.success(
            I18n.t(
              'task_pause_requested',
              {},
              '已请求暂停，当前任务结束后将停止后续执行',
            ),
          );
        } catch (error) {
          Message.error(I18n.t('task_pause_failed', {}, '暂停任务失败'));
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
    };
  }, [
    task,
    deleteLoading,
    cancelLoading,
    removeLoading,
    startLoading,
    pauseLoading,
    resumeLoading,
  ]);
}
