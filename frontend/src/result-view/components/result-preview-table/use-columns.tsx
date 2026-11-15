// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { useMemo } from 'react';

import { Modal, Tooltip } from '@arco-design/web-react';
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
  ResultPromptKey,
  ResultRowLabelKey,
  ResultTimeKey,
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

/** 提示词列：单元格内截断，点击弹窗展示完整提示词 */
const PromptCell = ({ text }: { text?: string }) => {
  if (!text) {
    return <span style={{ color: 'var(--color-text-3)' }}>-</span>;
  }
  return (
    <Tooltip
      content={I18n.t('click_view_full_prompt', {}, '点击查看完整提示词')}
    >
      <div
        style={{
          width: '100%',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 3,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          textAlign: 'left',
          lineHeight: 1.5,
          cursor: 'pointer',
        }}
        onClick={() => {
          Modal.info({
            title: I18n.t('full_prompt', {}, '完整提示词'),
            // 结果对比是 z-index 1001 的 Drawer，弹窗必须盖在它上面
            wrapStyle: { zIndex: 1002 },
            style: { width: 720, maxWidth: '90vw' },
            content: (
              <pre
                style={{
                  margin: 0,
                  maxHeight: '60vh',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  font: 'inherit',
                  lineHeight: 1.6,
                }}
              >
                {text}
              </pre>
            ),
          });
        }}
      >
        {text}
      </div>
    </Tooltip>
  );
};

/** 生成结果的两个元信息列：回写提示词、执行耗时 */
const buildMetaColumns = (): ColumnProps<PreviewTableRowDataType>[] => {
  const promptTitle = I18n.t('result_prompt', {}, '提示词');
  const timeTitle = I18n.t('result_time', {}, '耗时');
  // 高级筛选会把所有非参数列归入「生成结果」分组，这里补上 valueList
  // 保证筛选项有可读内容、列排序也能拿到对应的 id
  const metaExtra = (title: string) => ({
    isParams: false,
    label: title,
    valueList: [
      { type: 'string', value: [title], label: '' },
    ] as PreviewTableCellValueType,
  });

  return [
    {
      title: promptTitle,
      dataIndex: ResultPromptKey,
      width: 220,
      extra: metaExtra(promptTitle),
      render(_col, record) {
        return <PromptCell text={(record as any)[ResultPromptKey]} />;
      },
    },
    {
      title: timeTitle,
      dataIndex: ResultTimeKey,
      width: 170,
      extra: metaExtra(timeTitle),
      render(_col, record) {
        const text = (record as any)[ResultTimeKey] || '-';
        return (
          <span title={text} style={{ whiteSpace: 'nowrap' }}>
            {text}
          </span>
        );
      },
    },
  ];
};

/**
 * 结果值单元格：单参数「以列展示」时结果维度是行，
 * 同一列里可能放结果文件、提示词或时间，按行 id 分派渲染。
 * 其它模式下行 id 是参数组合 key，走默认的 RenderCell。
 */
const ResultCell = ({ col, rowId }: { col: any; rowId?: string }) => {
  if (rowId === ResultPromptKey) {
    return <PromptCell text={typeof col === 'string' ? col : ''} />;
  }
  if (rowId === ResultTimeKey) {
    const text = typeof col === 'string' && col ? col : '-';
    return (
      <span title={text} style={{ whiteSpace: 'nowrap' }}>
        {text}
      </span>
    );
  }
  return <RenderCell cell={col as PreviewTableCellValueType} />;
};

/** 「以列展示」时固定首列：标注当前行是生成结果 / 提示词 / 时间 */
const buildRowLabelColumn = (): ColumnProps<PreviewTableRowDataType> => {
  const title = I18n.t('result_row_label', {}, '类型');
  return {
    title,
    dataIndex: ResultRowLabelKey,
    fixed: 'left',
    width: 110,
    extra: {
      isParams: true,
      label: title,
      valueList: [
        { type: 'string', value: [title], label: '' },
      ] as PreviewTableCellValueType,
    },
    render(col) {
      return <RenderCell cell={col as PreviewTableCellValueType} />;
    },
  };
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

    const isSingleParamColumns =
      tableConfigOptions.length === 1 && orientation === 'columns';
    if (isSingleParamColumns) {
      // 参数值是列，结果维度是行：固定首列标注每行是什么
      res.push(buildRowLabelColumn());
    }

    // 仅有一个参数且选择"以行展示"时：参数值作为行、生成结果作为唯一列
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
      // 生成结果之后紧跟提示词、时间两个独立列
      res.push(...buildMetaColumns());
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
          render(col, record) {
            return <ResultCell col={col} rowId={(record as any)?.id} />;
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
          render(col, record) {
            return <ResultCell col={col} rowId={(record as any)?.id} />;
          },
        });
      });
    }

    // 单参数「以列展示」时提示词 / 时间已由 useData 展开成行，不能再加成列；
    // 其余矩阵模式才把两个元信息列追加到最后，数据由 useData 按行聚合
    if (!isSingleParamColumns) {
      res.push(...buildMetaColumns());
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
