// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
// 通用的预览表格

import { useEffect, useMemo, useRef, useState } from 'react';

import { Table, type TableInstance } from '@arco-design/web-react';
import { type ColumnProps } from '@arco-design/web-react/es/Table';

import {
  type PreviewTableDataType,
  type PreviewTableRowDataType,
} from './type/table';

export interface PreviewTableProps {
  data: PreviewTableDataType;
  cellSize: number;
  columnList: ColumnProps<PreviewTableRowDataType>[];
  cellValue2UrlMap: any;
  renderRect: {
    /** 显示区域高度（实时跟随容器变化） */
    height: number;
  };
}

import styles from './index.module.scss';
import { usePreviewTableStore } from './store';
import { uuid } from '@common/utils/uuid';
import { I18n } from '@common/i18n';

export const PreviewTable: React.FC<PreviewTableProps> = ({
  data,
  cellSize,
  columnList,
  renderRect,
}) => {
  const tableContainerRef = useRef<TableInstance>(null);
  const [height, setHeight] = useState(0);
  // 仅在数据或列结构变化时重挂载表格（序列化 key 方案），
  // 避免每次渲染都重挂载导致表头高度观察器绑定到已脱离 DOM 的节点
  const tableKey = useMemo(() => uuid(), [data, columnList]);

  useEffect(() => {
    usePreviewTableStore.setState({
      cellSize,
    });
  }, [cellSize]);

  const rowEventConfig = (record: any, index: number) => ({
    onClick: () => {
      // 表头不允许左右切换
      const isHeaderRow = record instanceof Array;
      usePreviewTableStore.setState({
        currentRow: isHeaderRow ? -1 : index,
      });
    },
    onMouseEnter: (e: any) => {
      const tr = e.target?.closest('tr');
      if (!tr) {
        console.error('init video row autoplay failed');
        return;
      }
      const siblingVideos = tr.querySelectorAll('video');
      siblingVideos.forEach((siblingVideo: any) => {
        siblingVideo.currentTime = 0;
        siblingVideo.loop = true;
        // 添加悬浮播放控制
        siblingVideo.play();
      });
    },
    onMouseLeave: (e: any) => {
      const tr = e.target?.closest('tr');
      if (!tr) {
        console.error('init video row autoplay failed');
        return;
      }
      const siblingVideos = tr.querySelectorAll('video');
      siblingVideos.forEach((siblingVideo: any) => {
        siblingVideo.loop = false;
        // 添加悬浮暂停控制
        siblingVideo.pause();
        siblingVideo.currentTime = 0;
      });
    },
  });

  useEffect(() => {
    usePreviewTableStore.setState({
      data,
      columnList,
    });
  }, [columnList, data]);

  const columns = useMemo(
    () =>
      columnList.map((column, index) => ({
        ...column,
        onCell(r: any, i: any) {
          return {
            ...(column?.onCell ? column.onCell(r, i) : {}),
            onClick: (e: any) => {
              if (column?.onCell?.(r, i).onClick) {
                column.onCell(r, i).onClick?.(e);
              }
              usePreviewTableStore.setState({
                currentCol: index,
              });
            },
          };
        },
        onHeaderCell: () => ({
          onClick: () => {
            usePreviewTableStore.setState({
              currentCol: index,
              currentRow: -1,
            });
          },
        }),
      })),
    [columnList],
  );

  useEffect(() => {
    const element = tableContainerRef.current
      ?.getRootDomElement()
      ?.querySelector('.arco-table-tr') as HTMLElement | null;

    if (!element) {
      return;
    }

    const syncHeight = () => {
      setHeight(element.offsetHeight);
    };

    // 表头行高度会随单元格尺寸变化，用 ResizeObserver 持续同步
    const observer = new ResizeObserver(syncHeight);
    observer.observe(element);
    syncHeight();

    return () => {
      observer.disconnect();
    };
  }, [tableKey]);

  // 矩阵自然宽度 = 各列声明宽度之和
  const naturalWidth = useMemo(
    () =>
      columnList.reduce(
        (sum, c) => sum + (typeof c.width === 'number' ? c.width : 0),
        0,
      ),
    [columnList],
  );

  const TableContent = useMemo(
    () => (
      // 最佳方案是通过columns或data序列化出一个唯一key来实现重绘
      <Table
        ref={tableContainerRef}
        className={styles.table}
        rowKey="id"
        columns={columns}
        key={tableKey}
        data={data}
        style={{ width: '100%' }}
        scroll={{
          // 矩阵以各列声明宽度之和为自然宽度显示（保证滑块调节生效），
          // 超出显示区域时由 content-inner 产生横向滚动条
          x: naturalWidth || true,
          y: Math.max(renderRect.height - height - 2, 100),
        }}
        border={{
          wrapper: true,
          cell: true,
        }}
        noDataElement={I18n.t('no_data_yet', {}, '暂无数据')}
        pagination={false}
        onHeaderRow={rowEventConfig}
        onRow={rowEventConfig}
      />
    ),
    [
      tableKey,
      columns,
      data,
      naturalWidth,
      renderRect.height,
      height,
    ],
  );

  return TableContent;
};
