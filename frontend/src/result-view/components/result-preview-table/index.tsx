// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useMemo, useRef, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';

import { useResultViewStore } from '../../store';
import { calcPercentSize } from '../../util';
import { processColumns, processRows } from '../../util/process_filter';
import styles from './index.module.scss';
import { useColumns } from './use-columns';
import { getCases, useData } from './use-data';
import { findPendingRowIndex, focusTableRow } from './focus-row';
import { SingleParamResultKey } from './utils';
import { customCompare } from '@common/components/PreviewTable/utils/compare';
import { PreviewTable } from '@common/components/PreviewTable';
import { type PreviewTableDataType } from '@common/components/PreviewTable/type/table';
import { memoryMap } from '@common/utils/advanced-map';
import { orderColumns, orderRows } from './order';
import { ResultRowLabelKey } from './utils';

/** 定位滚动的时间点（毫秒）：覆盖抽屉入场动画、表格重挂载与可视高度重算 */
const FocusDelays = [0, 60, 140, 240, 360, 520, 700, 900];

export const ResultPreviewTable = () => {
  const contentRef = useRef<HTMLDivElement>(null);
  // 显示区域高度，初始用视口估算值，挂载后由 ResizeObserver 实时校正
  const [renderHeight, setRenderHeight] = useState(
    () => window.innerHeight - 60 - 76,
  );
  const [previewPercent, customColumns, customRows] = useResultViewStore(
    useShallow((s) => [s.previewPercent, s.customColumns, s.customRows]),
  );
  const focusToken = useResultViewStore(useShallow((s) => s.focusToken));
  // 同一次打开只定位一次，之后用户切筛选 / 排序不再改变滚动位置
  const handledFocusTokenRef = useRef(0);
  // 定位用的定时器与最新行数据：不放进 effect 依赖，避免被 cleanup 清掉
  const focusTimersRef = useRef<number[]>([]);
  const finalDataRef = useRef<PreviewTableDataType>([]);

  const data = useData();
  const columns = useColumns();
  const cellSize = calcPercentSize(300, 100, previewPercent);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const { height } = entry.contentRect;
      setRenderHeight((prev) => (prev === height ? prev : height));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    // 处理高级筛选中的行
    const r = processRows(data, columns);
    const c = processColumns(columns);
    useResultViewStore.setState({
      customRows: r,
      originRows: r,
      customColumns: c,
      originColumns: c,
    });
  }, [data, columns]);

  const finalColumns = useMemo(() => {
    // 创建配置映射表
    const configMap = new Map();
    // 自增序号
    let count = 1;

    const { set: configMapSet } = memoryMap(configMap);

    customColumns.forEach((cc) => {
      if (cc.options?.length > 1) {
        cc.options?.forEach((opt) => {
          configMapSet(opt.id, { ...opt, order: count++ });
        });
      } else {
        configMapSet(cc.id, { ...cc, order: count++ });
      }
    });

    const { get: filterConfigGet } = memoryMap(configMap);
    const { get: orderConfigGet } = memoryMap(configMap);

    const orderedColumns = orderColumns(columns, orderConfigGet).filter((c) => {
      const config = filterConfigGet(c.dataIndex || '');
      return config?.selected !== false;
    });

    // 「以列展示」的行标题列是结构列，必须始终在最前。
    // orderColumns 在某个值列没有排序配置时会走 result[i] = col 保留原位，
    // 恰好覆盖掉按 order 放在 result[1] 的首列，导致行名列整个消失。
    const rowLabelColumn = columns.find(
      (c) => c.dataIndex === ResultRowLabelKey,
    );
    if (!rowLabelColumn) {
      return orderedColumns;
    }
    return [
      rowLabelColumn,
      ...orderedColumns.filter((c) => c !== rowLabelColumn),
    ];
  }, [columns, customColumns]);

  const finalData = useMemo(() => {
    // 创建配置映射表
    const configMap = new Map();
    let count = 0;
    const { set: configMapSet } = memoryMap(configMap);
    customRows.forEach((cc) => {
      configMapSet(cc.id, { ...cc, order: count++ });
      cc.options?.forEach((opt) => {
        configMapSet(opt.id, { ...opt, order: count++ });
      });
    });

    const { get: filterConfigGet } = memoryMap(configMap);
    const { get: orderConfigGet } = memoryMap(configMap);

    return orderRows(data, orderConfigGet).filter((d) => {
      const config = filterConfigGet(d.id);
      return config?.selected !== false;
    });
  }, [data, customRows]);

  // 定位时读最新行数据（含自定义筛选 / 排序的结果）
  finalDataRef.current = finalData;

  useEffect(() => {
    useResultViewStore.setState({
      customColumnsChanged: !customCompare(columns, finalColumns),
      customRowsChanged: !customCompare(data, finalData),
    });
  }, [finalColumns, finalData, data, columns]);

  // 打开结果对比时定位到正在执行的任务；全部完成则回到表格最开始。
  // 只依赖 focusToken 触发：finalData 会在挂载后因自定义筛选的初始化再变一次，
  // 若把它写进依赖，cleanup 会把已排好的定时器清掉，定位就永远不生效。
  useEffect(() => {
    if (!focusToken || handledFocusTokenRef.current === focusToken) {
      return;
    }
    const element = contentRef.current;
    if (!element) {
      return;
    }
    handledFocusTokenRef.current = focusToken;
    const {
      tableConfigOptions,
      selectedConfigOptionIndex,
      singleParamOrientation,
    } = useResultViewStore.getState();
    // 单参数「以行展示」时结果列是固定 key，其余情况的每一列都是对比维度的某个值
    const isTransposed =
      tableConfigOptions.length === 1 && singleParamOrientation === 'rows';
    const currentOption = tableConfigOptions[selectedConfigOptionIndex ?? -1];
    const resultKeys = isTransposed
      ? [SingleParamResultKey]
      : currentOption
        ? getCases(currentOption)
        : [];
    // 表格会在数据变化后重挂载、并重新计算可视高度，抖动结束前多次校正，
    // 保证最终停在进行中的那行（没有进行中的任务则回到最开始）
    FocusDelays.forEach((delay) => {
      focusTimersRef.current.push(
        window.setTimeout(() => {
          // 抽屉已关闭就不再干预
          if (!element.isConnected) {
            return;
          }
          const rows = finalDataRef.current;
          if (!rows.length) {
            return;
          }
          // 第一个还没出结果的行就是正在执行的位置；全都出完则为 -1
          const index = findPendingRowIndex(rows, resultKeys);
          focusTableRow(
            element,
            index >= 0 ? (rows[index]?.id ?? null) : null,
            index,
          );
        }, delay),
      );
    });
  }, [focusToken]);

  // 定时器不跟随依赖清理，只在组件卸载时兜底
  useEffect(
    () => () => {
      focusTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      focusTimersRef.current = [];
    },
    [],
  );

  return (
    <div
      ref={contentRef}
      className={styles.content}
      style={{ flex: 1, minHeight: 0, width: '100%', overflow: 'hidden' }}
    >
      <PreviewTable
        data={finalData}
        cellSize={cellSize}
        columnList={finalColumns}
        cellValue2UrlMap={undefined}
        renderRect={{ height: renderHeight }}
      />
    </div>
  );
};
