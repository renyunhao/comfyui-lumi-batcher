// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useMemo, useState } from 'react';

import { Popconfirm } from '@arco-design/web-react';
import {
  IconClockCircle,
  IconCloseCircle,
  IconEdit,
  IconPause,
  IconPlayArrow,
  IconRedo,
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
  /** 点击后先乐观置位，避免等列表刷新回来这段时间按钮看起来「没反应」 */
  const [pauseRequestedLocal, setPauseRequestedLocal] = useState(false);

  const isPrepared = statusType === TaskStatusEnum.Prepared;
  const isPaused = statusType === TaskStatusEnum.Paused;
  const isActive =
    statusType === TaskStatusEnum.Waiting ||
    statusType === TaskStatusEnum.Running;

  // 真值以后端 extra.pause_requested 为准：刷新页面、多端操作都能保持一致；
  // 任务收敛为 paused（后端会清标记）或取消暂停后，撤销本地乐观状态
  useEffect(() => {
    if (!isActive || !task.extra?.pause_requested) {
      setPauseRequestedLocal(false);
    }
  }, [isActive, task.status, task.extra?.pause_requested]);

  const isPauseRequested =
    isActive && (!!task.extra?.pause_requested || pauseRequestedLocal);

  /*
   * 各状态的操作矩阵：
   *   准备    编辑 / 开始 / 复制 / 清除 / 删除（还没有子任务，不提供复制未完成）
   *   执行中  暂停 / 取消 / 结果对比 / 复制 / 复制未完成 / 清除 / 删除
   *   已暂停  继续 / 取消 / 结果对比 / 复制 / 复制未完成 / 清除 / 删除
   *   终态    结果对比 / 下载 / 复制 / 复制未完成 / 清除 / 删除
   *
   * 注：点了暂停但当前项还没跑完时，暂停按钮变成「已请求暂停」（时钟图标 +
   * 警告色 + 呼吸动画、不可再点）；后端收敛为 paused 后自动切成「继续」。
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

  // 准备态还没有子任务，无所谓「未完成」；本地导入任务同样不适用
  const showCopyUnfinishedOperation = useMemo(
    () =>
      uiConfig.showCopy &&
      !isPrepared &&
      task.scene !== BatchTaskSceneEnum.LocalTask,
    [isPrepared, task.scene, uiConfig.showCopy],
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
        isPauseRequested ? (
          // 已请求暂停：换图标 + 警告色，且不再响应点击，避免忘记是否点过
          <IconButtonTooltip
            className="task-operator-pause-pending"
            status="warning"
            icon={<IconClockCircle />}
            tooltip={I18n.t(
              'pause_task_pending',
              {},
              '已请求暂停：当前任务结束后将停止后续执行',
            )}
          />
        ) : (
          <IconButtonTooltip
            loading={handler.pauseLoading}
            icon={<IconPause />}
            tooltip={I18n.t(
              'pause_task',
              {},
              '暂停（当前任务跑完后停止后续执行）',
            )}
            onClick={async () => {
              const result = await handler.pause();
              // 后端判定「当前已是最后一项」时不会进入暂停流程，
              // 此时不要显示「已请求暂停」的时钟图标
              if (result === 'requested') {
                setPauseRequestedLocal(true);
              }
              refresh();
            }}
          />
        )
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
      {showCopyUnfinishedOperation ? (
        <IconButtonTooltip
          loading={handler.copyUnfinishedLoading}
          icon={<IconRedo />}
          tooltip={I18n.t('copy_unfinished_params', {}, '复制未完成的参数')}
          onClick={handler.copyUnfinished}
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
