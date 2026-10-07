// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { useMemo } from 'react';

import { type ColumnProps } from '@arco-design/web-react/es/Table';
import { useShallow } from 'zustand/react/shallow';

import { useResultViewStore } from '../../store';
import { calcPercentSize } from '../../util';
import {
  CommonSeparator,
  getImageKey,
  getKey,
  getLabel,
  getRenderCellType,
  getRenderCellValue,
  SingleParamResultKey,
} from './utils';
import { RenderCell } from '@common/components/PreviewTable/components/RenderCell';
import {
  PreviewTableRowDataType,
  PreviewTableCellValueType,
} from '@common/components/PreviewTable/type/table';
import { ConfigOption, ConfigOptionSimple } from '@common/type/result';
import { I18n } from '@common/i18n';

const findOrderIndex = (array: number[], num: number): number => {
  let left = 0;
  let right = array.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (array[mid] === num) {
      return mid;
    } else if (array[mid] < num) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return left;
};

export const useColumns = () => {
  const [
    detail,
    tableConfigOptions,
    selectedConfigOptionIndex,
    previewPercent,
    orientation,
  ] = useResultViewStore(
    useShallow((s) => [
      s.detail,
      s.tableConfigOptions,
      s.selectedConfigOptionIndex,
      s.previewPercent,
      s.singleParamOrientation,
    ]),
  );

  const cellSize = calcPercentSize(300, 100, previewPercent);

  const columns: ColumnProps<PreviewTableRowDataType>[] = useMemo(() => {
    const res: ColumnProps<PreviewTableRowDataType>[] = [];
    const weights: number[] = [];

    if (selectedConfigOptionIndex === undefined) {
      return res;
    }

    // 仅有一个参数且选择"以行展示"时：参数值作为行，生成结果作为唯一列
    if (tableConfigOptions.length === 1 && orientation === 'rows') {
      const item = tableConfigOptions[0];
      if (item.type === 'group') {
        const c = item as {
          type: string;
          values: ConfigOptionSimple[];
        };
        const nodeKey = c.values.map((v) => getKey(v)).join(CommonSeparator);
        const valueList: PreviewTableCellValueType = [
          {
            type: 'string',
            value: [nodeKey],
            label: '',
          },
        ];
        res.push({
          title: <RenderCell cell={valueList} />,
          extra: {
            valueList,
            isParams: true,
            label: nodeKey,
          },
          dataIndex: nodeKey,
          fixed: 'left',
          width: Math.min(cellSize, 300),
          render(col: PreviewTableCellValueType, record) {
            return (
              <RenderCell
                cell={col}
                defaultText={(record.batchTaskName as any) || '-'}
              />
            );
          },
        });
      } else {
        const c = item as ConfigOptionSimple;
        const nodeKey = getKey(c);
        const valueList: PreviewTableCellValueType = [
          {
            type: 'string',
            value: [nodeKey],
            label: '',
          },
        ];
        res.push({
          title: <RenderCell cell={valueList} />,
          extra: {
            valueList,
            isParams: true,
            label: nodeKey,
          },
          dataIndex: nodeKey,
          fixed: 'left',
          width: Math.min(cellSize, 300),
          render(col: PreviewTableCellValueType, record) {
            return (
              <RenderCell
                cell={col}
                defaultText={(record.batchTaskName as any) || '-'}
              />
            );
          },
        });
      }
      const resultValueList: PreviewTableCellValueType = [
        {
          type: 'string',
          value: [I18n.t('generated_results', {}, '生成结果')],
          label: '',
        },
      ];
      res.push({
        title: I18n.t('generated_results', {}, '生成结果'),
        extra: {
          valueList: resultValueList,
          isParams: false,
          label: SingleParamResultKey,
        },
        dataIndex: SingleParamResultKey,
        width: cellSize,
        render(col: PreviewTableCellValueType) {
          return <RenderCell cell={col} />;
        },
      });
      return res;
    }

    // 处理列
    tableConfigOptions.forEach((item: ConfigOption, index) => {
      if (index === selectedConfigOptionIndex) {
        return;
      }
      if (item.type === 'group') {
        const c = item as {
          type: string;
          values: ConfigOptionSimple[];
        };
        const w = Math.max(...c.values.map((v) => v.values.length));
        const orderIndex = findOrderIndex(weights, w);
        weights.splice(orderIndex, 0, w);
        const nodeKey = c.values.map((v) => getKey(v)).join(CommonSeparator);
        const valueList: PreviewTableCellValueType = [
          {
            type: 'string',
            value: [nodeKey],
            label: '',
          },
        ];
        res.splice(orderIndex, 0, {
          title: <RenderCell cell={valueList} />,
          extra: {
            valueList,
            isParams: true,
            label: nodeKey,
          },
          dataIndex: nodeKey,
          fixed: 'left',
          width: Math.min(cellSize, 300),
          render(col: PreviewTableCellValueType, item) {
            // 定制渲染内容
            return (
              <RenderCell
                cell={col}
                defaultText={(item.batchTaskName as any) || '-'}
              />
            );
          },
        });
      } else {
        const c = item as ConfigOptionSimple;
        const w = c.values.length;
        const orderIndex = findOrderIndex(weights, w);
        weights.splice(orderIndex, 0, w);
        const nodeKey = getKey(c);
        const valueList: PreviewTableCellValueType = [
          {
            type: 'string',
            value: [nodeKey],
            label: '',
          },
        ];
        res.splice(orderIndex, 0, {
          title: <RenderCell cell={valueList} />,
          dataIndex: nodeKey,
          extra: {
            valueList,
            isParams: true,
            label: nodeKey,
          },
          fixed: 'left',
          width: Math.min(cellSize, 300),
          render(col: PreviewTableCellValueType, item) {
            // 定制渲染内容
            return (
              <RenderCell
                cell={col}
                defaultText={(item.batchTaskName as any) || '-'}
              />
            );
          },
        });
      }
    });

    // 处理选中的列
    const s = tableConfigOptions[selectedConfigOptionIndex as number];
    if (s.type === 'group') {
      const c = s as {
        type: string;
        values: ConfigOptionSimple[];
      };
      // 处理参数值组合数量，用于计算列数
      const maxLength = Math.max(...c.values.map((v) => v.values.length));
      const paramsConfigLength = c.values.length;
      const paramsTempArr = Array.from({ length: paramsConfigLength });
      for (let i = 0; i < maxLength; i++) {
        // 序列化key，用于列的dataIndex
        const dataIndex = paramsTempArr
          .map((_, index) => {
            const cc = c.values[index];
            return getKey(cc, String(cc.values[i]));
          })
          .join(CommonSeparator);
        const valueList: PreviewTableCellValueType = paramsTempArr
          .map((_, ind) => {
            const cc = c.values[ind];
            const v = String(cc.values[i]);
            const imageKey = getImageKey(v);
            const imageSrc = detail?.resourcesMap[imageKey] ?? '';
            const t = getRenderCellType(imageKey);
            const cell: PreviewTableCellValueType = [
              {
                type: t,
                value: [getRenderCellValue(t, v, imageSrc) as string],
                label: t === 'audio' ? v : getKey(cc),
              },
            ];
            // 图像参数值在列头内附带显示文件名
            if (t === 'image') {
              cell.push({ type: 'string', value: [imageKey], label: '' });
            }
            return cell;
          })
          .flat();
        res.push({
          title: <RenderCell cell={valueList} />,
          extra: {
            valueList,
            isParams: false,
            label: dataIndex,
          },
          width: cellSize,
          dataIndex,
          render(col) {
            return <RenderCell cell={col} />;
          },
        });
      }
    } else {
      const c = s as ConfigOptionSimple;
      c.values.forEach((item) => {
        const v = String(item);
        const imageKey = getImageKey(v);
        const imageSrc = detail?.resourcesMap[imageKey] ?? '';
        const t = getRenderCellType(imageKey);
        const valueList: PreviewTableCellValueType = [
          {
            type: t,
            value: [getRenderCellValue(t, v, imageSrc) as string],
            label: t === 'audio' ? v : getLabel(c),
          },
        ];
        // 图像参数值在列头内附带显示文件名
        if (t === 'image') {
          valueList.push({ type: 'string', value: [imageKey], label: '' });
        }
        const dataIndex = getKey(c, v);
        res.push({
          title: <RenderCell cell={valueList} />,
          extra: {
            valueList,
            isParams: false,
            label: dataIndex,
          },
          width: cellSize,
          dataIndex,
          render(col) {
            return <RenderCell cell={col} />;
          },
        });
      });
    }

    return res;
  }, [
    cellSize,
    detail?.resourcesMap,
    selectedConfigOptionIndex,
    tableConfigOptions,
    orientation,
  ]);

  return columns;
};
