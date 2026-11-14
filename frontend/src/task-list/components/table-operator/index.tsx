// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { useMemo } from 'react';

import { Popconfirm } from '@arco-design/web-react';
import {
  IconCloseCircle,
  IconEdit,
  IconPause,
  IconPlayArrow,
} from '@arco-design/web-react/icon';
import { useShallow } from 'zustand/react/shallow';

import { ReactComponent as IconCopy } from '@static/icons/copy.svg';
import { ReactComponent as IconLayout } from '@static/icons/layout-alt.svg';
import { ReactComponent as IconDelete } from '@static/icons/task-list/delete-icon.svg';
import { ReactComponent as IconRemove } from '@static/icons/task-list/remove-icon.svg';

import { TaskStatusEnum } from '../../constants';
import useHandler from './use-handler';
import { useBatchToolsStore } from '@src/batch-tools/state';
import { TaskInfo } from '@api/batch-task';
import { BatchTaskSceneEnum } from '@common/constant/batch';
import { I18n } from '@common/i18n';
import IconButtonTooltip from '@common/components/IconButtonTooltip';
import Flex from '@common/components/Flex';
import { languageUtils, TranslateKeys } from '@common/language';
import ResultDownload from '@src/result-download';

export default function TableOperator({
  task,
  refresh,
}: {
  task: TaskInfo;
  refresh: Function;
}) {
  const [uiConfig] = useBatchToolsStore(useShallow((s) => [s.uiConfig]));
  const statusType = task.status;
  const handler = useHandler(task);

  const isPrepared = statusType === TaskStatusEnum.Prepared;
  const isPaused = statusType === TaskStatusEnum.Paused;
  const isActive =
    statusType === TaskStatusEnum.Waiting ||
    statusType === TaskStatusEnum.Running;

  /*
   * 各状态的操作矩阵：
   *   准备    编辑 / 开始 / 复制 / 清除 / 删除（还没有结果，不提供取消与结果对比）
   *   执行中  暂停 / 取消 / 结果对比 / 复制 / 清除 / 删除
   *   已暂停  继续 / 取消 / 结果对比 / 复制 / 清除 / 删除
   *   终态    结果对比 / 下载 / 复制 / 清除 / 删除
   */
  const showEditBtn = isPrepared;
  const showStartBtn = isPrepared;
  const showResumeBtn = isPaused;
  const showPauseBtn = isActive;
  const showCancelBtn = isActive || isPaused;
  const showResultDiffBtn = [
    TaskStatusEnum.Waiting,
    TaskStatusEnum.Running,
    TaskStatusEnum.Paused,
    TaskStatusEnum.Canceled,
    TaskStatusEnum.Succeed,
    TaskStatusEnum.PartiallySucceeded,
    TaskStatusEnum.Dirty,
  ].includes(statusType);
  const showCopyBtn = true;

  const showCancelOperation = useMemo(
    () => uiConfig.showCancel && showCancelBtn,
    [showCancelBtn, uiConfig.showCancel],
  );

  const showCopyOperation = useMemo(
    () =>
      uiConfig.showCopy &&
      showCopyBtn &&
      task.scene !== BatchTaskSceneEnum.LocalTask,
    [showCopyBtn, task.scene, uiConfig.showCopy],
  );

  return (
    <Flex align="center" gap={8}>
      {showEditBtn ? (
        <IconButtonTooltip
          icon={<IconEdit />}
          tooltip={I18n.t('edit_task', {}, '编辑任务')}
          onClick={handler.edit}
        />
      ) : null}

      {showStartBtn ? (
        <Popconfirm
          title={I18n.t(
            'confirm_to_start_the_task',
            {},
            '确认开始执行该任务吗？',
          )}
          onOk={async () => {
            await handler.start();
            refresh();
          }}
        >
          <IconButtonTooltip
            loading={handler.startLoading}
            icon={<IconPlayArrow />}
            tooltip={I18n.t('start_task', {}, '开始执行')}
          />
        </Popconfirm>
      ) : null}

      {showResumeBtn ? (
        <Popconfirm
          title={I18n.t(
            'confirm_to_resume_the_task',
            {},
            '确认继续执行剩余任务吗？',
          )}
          onOk={async () => {
            await handler.resume();
            refresh();
          }}
        >
          <IconButtonTooltip
            loading={handler.resumeLoading}
            icon={<IconPlayArrow />}
            tooltip={I18n.t('resume_task', {}, '继续执行')}
          />
        </Popconfirm>
      ) : null}

      {showPauseBtn ? (
        <IconButtonTooltip
          loading={handler.pauseLoading}
          icon={<IconPause />}
          tooltip={I18n.t(
            'pause_task',
            {},
            '暂停（当前任务跑完后停止后续执行）',
          )}
          onClick={async () => {
            await handler.pause();
            refresh();
          }}
        />
      ) : null}

      {showCancelOperation ? (
        <Popconfirm
          title={I18n.t('confirm_to_cancel_the_task?', {}, '确认取消任务吗？')}
          onOk={async () => {
            await handler.cancel();
            refresh();
          }}
        >
          <IconButtonTooltip
            loading={handler.cancelLoading}
            // 关闭/取消语义，避免原先的返回箭头被误认为「返回上一页」
            icon={<IconCloseCircle />}
            tooltip={languageUtils.getText(TranslateKeys.CANCEL_TASK)}
          />
        </Popconfirm>
      ) : null}

      <ResultDownload
        taskId={task.id}
        statusInfo={{
          status: task.status,
          packageStatus: task.package_info.status,
        }}
      />
      {showResultDiffBtn ? (
        <IconButtonTooltip
          icon={<IconLayout />}
          tooltip={languageUtils.getText(TranslateKeys.RESULT_DIFF_CHECK)}
          onClick={handler.diffResult}
        />
      ) : null}
      {showCopyOperation ? (
        <IconButtonTooltip
          icon={<IconCopy />}
          tooltip={languageUtils.getText(TranslateKeys.COPY_PARAMS)}
          onClick={handler.copy}
        />
      ) : null}
      <Popconfirm
        title={I18n.t(
          'confirm_to_remove_the_task',
          {},
          '清除任务仅移除任务记录，结果文件会保留，确定清除吗？',
        )}
        onOk={async () => {
          await handler.remove();
          refresh();
        }}
      >
        <IconButtonTooltip
          icon={<IconRemove />}
          loading={handler.removeLoading}
          tooltip={I18n.t('remove_task', {}, '清除任务')}
        />
      </Popconfirm>
      <Popconfirm
        title={I18n.t('confirm_to_delete_the_task', {}, '确认删除任务吗？')}
        onOk={async () => {
          await handler.delete();
          refresh();
        }}
      >
        <IconButtonTooltip
          icon={<IconDelete />}
          loading={handler.deleteLoading}
          tooltip={I18n.t('delete_task', {}, '删除任务')}
        />
      </Popconfirm>
    </Flex>
  );
}
