// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { Message } from '@arco-design/web-react';

import { useCreatorStore } from './store';
import { createBatchTask, updateBatchTask } from '@api/batch-task';
import { languageUtils, TranslateKeys } from '@common/language';
import { ParamsConfigType } from '@common/type/batch-task';
import { uuid } from '@common/utils/uuid';
import { I18n } from '@common/i18n';
import { getCurrentApiKey, getCurrentToken } from '@common/utils/auth';

export const createBatchTaskFunc = async () => {
  const { paramsConfig, taskName, editingTaskId } = useCreatorStore.getState();
  try {
    let output: any, workflow: any;
    if (window.app?.ue_modified_prompt) {
      const res = await window.app.ue_modified_prompt();
      output = res.output;
      workflow = res.workflow;
    } else {
      output = await window.app.graphToPrompt();
      workflow = output.workflow;
      output = output.output;
    }
    const payload = {
      client_id: sessionStorage.getItem('clientId') ?? '',
      prompt: output,
      workflow,
      auth_token_comfy_org: getCurrentToken(),
      api_key_comfy_org: getCurrentApiKey(),
      extra_data: {
        extra_pnginfo: { workflow },
      },
      task_name: taskName,
      params_config: paramsConfig,
      // number: 1,
    };

    if (editingTaskId) {
      // 准备态反复编辑：更新原任务，后端会保留状态字段
      await updateBatchTask({ ...payload, batch_task_id: editingTaskId });
      Message.success(
        I18n.t(
          'save_prepared_task_successfully',
          {},
          '任务已保存，仍处于准备状态',
        ),
      );
    } else {
      // 提交只创建并保存，不自动开始执行，状态为「准备」
      await createBatchTask(payload);
      Message.success(
        I18n.t(
          'create_batch_task_successfully',
          {},
          '任务已创建，处于准备状态',
        ),
      );
    }
  } catch (error) {
    const defaultText = editingTaskId ? '保存任务失败' : '创建批量任务失败';
    console.log(defaultText, error);
    Message.error(
      I18n.t(
        editingTaskId ? 'failed_to_save_task' : 'failed_to_create_batch_task',
        {},
        defaultText,
      ),
    );
    // 抛出让调用方留在创建页，避免保存失败时 reset 掉尚未保存的编辑内容
    throw error;
  }
};

export const NumberDom = (number: number, suffix = '') => (
  <div key={uuid()} className="batch-tools-count-label">
    <span key={uuid()} className="batch-tools-count-number">
      {number}
    </span>
    {suffix ? <span key={uuid()}>{suffix}</span> : null}
  </div>
);

export const paramsConfigAnalysis = (
  paramsConfig: ParamsConfigType,
): {
  domList: any[];
  count: number;
} => {
  let count = 1;
  const domList: any[] = [];
  paramsConfig.forEach((item, index) => {
    let currentCount = 0;

    if (item.type === 'group') {
      currentCount = item.values?.[0]?.values?.length;
    } else {
      currentCount = item.values?.length;
    }

    const finaleName =
      item.name.length > 10 ? `${item.name.slice(0, 10)}...` : item.name;

    domList.push(
      NumberDom(
        currentCount,
        index !== paramsConfig.length - 1
          ? `${languageUtils.getText(
              TranslateKeys.PARAM_VALUES_COUNT_UNIT,
            )}(${finaleName}) x `
          : `${languageUtils.getText(
              TranslateKeys.PARAM_VALUES_COUNT_UNIT,
            )}(${finaleName})`,
      ),
    );

    count *= currentCount;
  });

  return {
    domList,
    count: paramsConfig.length ? count : 0,
  };
};

export const getParamsConfigNodeInfoString = (
  paramsConfig: ParamsConfigType,
): string => {
  let res = '';
  const getNodeTitle = (nodeId: number) =>
    window.app.graph.getNodeById(nodeId)?.title ?? '';
  paramsConfig.forEach((item, index) => {
    if (item.type === 'group') {
      item.values.forEach((value, ind) => {
        res += `${getNodeTitle(value.nodeId as number)}`;

        if (ind < item.values.length - 1) {
          res += ' + ';
        }
      });
    } else {
      res += `${getNodeTitle(item.nodeId as number)}`;
    }

    if (index < paramsConfig.length - 1) {
      res += ', ';
    }
  });

  return res;
};

/** 获取批量任务预期出图数量 */
export const getQueueCount = (paramsConfig: ParamsConfigType): number => {
  let count = 1;
  paramsConfig.forEach((item) => {
    let currentCount = 0;

    if (item.type === 'group') {
      currentCount = item.values?.[0]?.values?.length;
    } else {
      currentCount = item.values?.length;
    }

    count *= currentCount;
  });

  return paramsConfig.length ? count : 0;
};
