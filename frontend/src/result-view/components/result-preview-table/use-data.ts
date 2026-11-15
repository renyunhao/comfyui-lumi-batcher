// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { useMemo } from 'react';

import { useShallow } from 'zustand/react/shallow';

import { useResultViewStore } from '../../store';
import { processTasks } from './process-tasks';
import {
  CommonSeparator,
  getImageKey,
  getKey,
  getRenderCellType,
  getRenderCellValue,
  ResultPromptKey,
  ResultRowLabelKey,
  ResultTimeKey,
  SingleParamResultKey,
} from './utils';
import { PreviewTableDataType } from '@common/components/PreviewTable/type/table';
import { I18n } from '@common/i18n';
import { ConfigOption, ConfigOptionSimple } from '@common/type/result';
import { GetRoomResultsResponse, TaskResultInfo } from '@api/result';
import {
  extractResultPrompt,
  formatResultDuration,
  processResult,
} from '@common/utils/transfer/task-result';

const CustomParamsConfigFilters = 'custom_params_config_filters';

/** 计算当前对比维度涉及的所有列 key（参数值 / 参数值组合） */
const getCases = (s: ConfigOption): string[] => {
  if (s.type === 'group') {
    const c = s as { type: string; values: ConfigOptionSimple[] };
    const maxLength = Math.max(...c.values.map((v) => v.values.length));
    return Array.from({ length: maxLength }).map((_, index) =>
      c.values
        .map((v) => getKey(v, String(v.values[index])))
        .join(CommonSeparator),
    );
  }
  const c = s as ConfigOptionSimple;
  return c.values.map((i) => getKey(c, String(i)));
};

export const useData = () => {
  const [detail, tableConfigOptions, selectedConfigOptionIndex, orientation] =
    useResultViewStore(
      useShallow((s) => [
        s.detail,
        s.tableConfigOptions,
        s.selectedConfigOptionIndex,
        s.singleParamOrientation,
      ]),
    );
  const tableData = useMemo(() => {
    if (!detail || selectedConfigOptionIndex === undefined) {
      return [];
    }
    // 仅有一个参数且选择"以行展示"时，将参数值作为行、生成结果作为唯一列
    if (tableConfigOptions.length === 1 && orientation === 'rows') {
      const rows = processConfigToData(tableConfigOptions[0], detail);
      const { resultMap, configMap } = processTasks(detail.results);
      return rows.map((item) => {
        const filters = (
          (item[CustomParamsConfigFilters] ?? []) as any as Array<string>
        ).filter((v) => v);
        const key = Object.keys(configMap).find((k) =>
          filters.every((f) => configMap[k].includes(f)),
        );
        if (key) {
          const result = resultMap[key];
          (item as any)[SingleParamResultKey] = processResult(result);
          (item as any)[ResultPromptKey] = extractResultPrompt(result);
          (item as any)[ResultTimeKey] = formatResultDuration(result?.duration);
        }
        return item;
      }) as any;
    }

    // 仅有一个参数且选择「以列展示」时：参数值是列、结果维度是行，
    // 因此生成结果 / 提示词 / 耗时各占一行，而不是追加成列
    if (tableConfigOptions.length === 1 && orientation === 'columns') {
      const s = tableConfigOptions[selectedConfigOptionIndex] as ConfigOption;
      const { resultMap, configMap } = processTasks(detail.results);
      const cases = getCases(s);
      const findResult = (caseKey: string) => {
        const key = Object.keys(configMap).find((k) =>
          configMap[k].includes(caseKey),
        );
        return key ? resultMap[key] : undefined;
      };
      const buildRow = (
        id: string,
        label: string,
        fill: (result?: TaskResultInfo) => any,
      ) => {
        const row: any = {
          id,
          [CustomParamsConfigFilters]: [],
          // 表格单元格与「自定义行」筛选项都用 RenderCell 渲染，
          // 必须是 PreviewTableCellValueType（对象数组），不能是纯字符串
          [ResultRowLabelKey]: [{ type: 'string', value: [label], label: '' }],
        };
        cases.forEach((caseKey) => {
          row[caseKey] = fill(findResult(caseKey));
        });
        return row;
      };
      return [
        buildRow(
          SingleParamResultKey,
          I18n.t('generated_results', {}, '生成结果'),
          (r) => (r ? processResult(r) : []),
        ),
        buildRow(ResultPromptKey, I18n.t('result_prompt', {}, '提示词'), (r) =>
          extractResultPrompt(r),
        ),
        buildRow(ResultTimeKey, I18n.t('result_time', {}, '耗时'), (r) =>
          formatResultDuration(r?.duration),
        ),
      ] as any;
    }

    let res: PreviewTableDataType = [];
    // 构建表格，填充批量参数配置涉及的行数据
    tableConfigOptions.forEach((item, index) => {
      if (index === selectedConfigOptionIndex) {
        return;
      }
      if (res.length === 0) {
        res.push(...processConfigToData(item, detail));
      } else {
        const resNew = processConfigToData(item, detail);
        const finalRes: PreviewTableDataType = [];
        res.forEach((item) => {
          resNew.forEach((itemNew) => {
            finalRes.push({
              ...item,
              ...itemNew,
              id: `${item.id}${CommonSeparator}${itemNew.id}`,
              [CustomParamsConfigFilters]: [
                ...item[CustomParamsConfigFilters],
                ...itemNew[CustomParamsConfigFilters],
              ],
            } as any);
          });
        });

        res = finalRes;
      }
    });

    // 填充当前所选对比维度涉及的列数据
    const s = tableConfigOptions[selectedConfigOptionIndex] as ConfigOption;
    // 根据当前res数据，涉及到的id索引，通过序列化的任务key找到每个单元格对应的数据，同时构建表格所需数据
    const cases = getCases(s);
    // 不存在res时，且有数据时，需要手动创建一个空行
    if (!res.length && detail.results && detail.results.length > 0) {
      const id =
        s.type === 'group'
          ? (s.values as ConfigOptionSimple[])
              .map((v) => getKey(v))
              .join(CommonSeparator)
          : getKey(s as ConfigOptionSimple);
      res = [{ id }] as any;
    }

    res = processTasksToData(res, cases, detail);

    return res;
  }, [detail, tableConfigOptions, selectedConfigOptionIndex, orientation]);

  return tableData;
};

const processConfigToData = (
  item: ConfigOption,
  detail: GetRoomResultsResponse,
) => {
  const res: PreviewTableDataType = [];

  if (item.type === 'group') {
    const c = item as {
      type: string;
      values: ConfigOptionSimple[];
    };
    // 参数值数量，用于计算行数
    const maxLength = Math.max(...c.values.map((v) => v.values.length));

    //   由参数节点组成的唯一key，暂时不带value
    const key = c.values.map((v) => getKey(v)).join(CommonSeparator);

    // 根据规则获取每行的行数据
    for (let i = 0; i < maxLength; i++) {
      const uniqueKey = c.values
        .map((v) => getKey(v, String(v.values[i])))
        .join(CommonSeparator);

      res.push({
        id: uniqueKey,
        [CustomParamsConfigFilters]: [uniqueKey],
        [key]: Array.from({ length: item.values.length }).map((_, ind) => {
          const cc = c.values[ind];
          const v = String(cc.values[i]);
          const imageKey = getImageKey(v);
          const imageSrc = detail.resourcesMap[imageKey] ?? '';
          const t = getRenderCellType(imageKey);
          const cell: any[] = [
            {
              type: t,
              value: [getRenderCellValue(t, v, imageSrc)],
              label: t === 'audio' ? v : getKey(cc),
            },
          ];
          // 图像参数值在单元格内附带显示文件名
          if (t === 'image') {
            cell.push({ type: 'string', value: [imageKey], label: '' });
          }
          return cell;
        }),
      } as any);
    }
  } else {
    const c = item as ConfigOptionSimple;
    c.values.forEach((v) => {
      const value = String(v);
      const key = getKey(c);
      const imageKey = getImageKey(value);
      const imageSrc = detail.resourcesMap[imageKey] ?? '';
      const t = getRenderCellType(imageKey);
      const uniqueKey = getKey(c, value);
      const cell: any[] = [
        {
          type: t,
          value: [getRenderCellValue(t, v, imageSrc)],
          label: t === 'audio' ? value : getKey(c),
        },
      ];
      // 图像参数值在单元格内附带显示文件名
      if (t === 'image') {
        cell.push({ type: 'string', value: [imageKey], label: '' });
      }
      res.push({
        id: uniqueKey,
        [CustomParamsConfigFilters]: [uniqueKey],
        [key]: cell,
      } as any);
    });
  }

  return res;
};

const processTasksToData = (
  res: PreviewTableDataType,
  cases: Array<string>,
  detail: GetRoomResultsResponse,
): PreviewTableDataType => {
  const { resultMap, configMap } = processTasks(detail.results);
  const result = res;

  return result.map((item) => {
    const matched: TaskResultInfo[] = [];
    cases.forEach((c) => {
      const filters = (
        (item[CustomParamsConfigFilters] ?? []) as any as Array<string>
      )
        .concat(c)
        .filter((item) => item);
      const key = Object.keys(configMap).find((k) =>
        filters.every((f) => configMap[k].includes(f)),
      );
      if (key) {
        const value = resultMap[key];
        matched.push(value);
        (item as any)[c] = processResult(value);
      }
    });
    // 矩阵模式下一行对应多个子任务，两个元信息列做聚合：
    // 耗时按数值取最短 ~ 最长（只有一个有效值时显示单值），提示词取第一个非空值
    const durations = matched
      .map((r) => r?.duration)
      .filter(
        (d): d is number =>
          typeof d === 'number' && Number.isFinite(d) && d >= 0,
      );
    (item as any)[ResultTimeKey] = durations.length
      ? durations.length > 1
        ? `${formatResultDuration(Math.min(...durations))} ~ ${formatResultDuration(Math.max(...durations))}`
        : formatResultDuration(durations[0])
      : '-';
    (item as any)[ResultPromptKey] =
      matched.map(extractResultPrompt).find(Boolean) || '';
    return item;
  }) as any;
};
