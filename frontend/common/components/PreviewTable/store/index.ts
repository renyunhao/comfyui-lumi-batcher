// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { type ColumnProps } from '@arco-design/web-react/es/Table';

import {
  type PreviewTableCellValueType,
  type PreviewTableDataType,
  type PreviewTableRowDataType,
} from '../type/table';
import { ResultItem, ResultOutputTypeEnum } from '@api/result';
import { create } from '@common/zustand';

export interface PreviewTableState {
  data: PreviewTableDataType;
  columnList: ColumnProps<PreviewTableRowDataType>[];
  currentRow: number;
  currentCol: number;
  preview: ResultItem[] | undefined;
  cellSize: number;
  observer: IntersectionObserver;
  lazyImgVisibleMap: Record<string, boolean>;
}

export interface PreviewTableAction {
  getCellValue: (row: number, col: number) => PreviewTableCellValueType;
  onCellPreview: (col: number, row: number) => void;
}

export const PreviewTableDefaultState = {
  data: [],
  columnList: [],
  currentRow: 0,
  currentCol: 0,
  preview: [],
  cellSize: 0,
  observer: new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const src = entry.target.getAttribute('data-src') ?? '';
          usePreviewTableStore.setState({
            lazyImgVisibleMap: {
              ...usePreviewTableStore.getState().lazyImgVisibleMap,
              [src]: true,
            },
          });
        }
      });
    },
    {
      root: null,
      rootMargin: '0px',
      threshold: 0.1,
    },
  ),
  lazyImgVisibleMap: {},
};

export const usePreviewTableStore = create<
  PreviewTableState,
  PreviewTableAction
>(PreviewTableDefaultState, (set: Function, get: Function) => ({
  getCellValue(row: number, col: number): PreviewTableCellValueType {
    const { data, columnList } = get();
    if (row >= 0 && row < data.length && col >= 0 && col < columnList.length) {
      const rowData = data[row];
      const column = columnList[col];
      const value = rowData[column.dataIndex as string];
      // 结果对比里的「提示词」「耗时」等列存的是纯文本，
      // 统一在这里兜底成数组，避免调用方（相邻单元格预览 / 方向键切换）直接 .filter 崩掉
      return Array.isArray(value) ? value : [];
    }
    return [];
  },
  onCellPreview: (col: number, row: number) => {
    const { data, columnList } = get();
    if (row >= 0 && row < data.length && col >= 0 && col < columnList.length) {
      const rowData = data[row];
      const column = columnList[col];
      const value = rowData[column.dataIndex as string];
      // 纯文本列没有可预览的资源，直接忽略
      if (!Array.isArray(value)) {
        return;
      }
      const previewList: ResultItem[] = [];
      (value as PreviewTableCellValueType)
        .filter((i) => ['image', 'video', 'audio'].includes(i.type))
        .forEach((value) =>
          value.value.forEach((i) =>
            previewList.push({
              type: value.type as ResultOutputTypeEnum,
              url: i,
            }),
          ),
        );

      if (previewList.length > 0) {
        set({
          preview: previewList,
          currentCol: col,
          currentRow: row,
        });
      }
    }
  },
}));
