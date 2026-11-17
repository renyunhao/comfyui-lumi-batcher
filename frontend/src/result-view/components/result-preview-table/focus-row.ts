// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { type PreviewTableDataType } from '@common/components/PreviewTable/type/table';

/**
 * 结果单元格为空 → 该参数组合还没有产出。
 * 结果接口只返回有输出的子任务、也不带 status，所以「有没有结果」
 * 是前端唯一可靠的进度口径（与结果对比表格的展示口径一致）。
 */
const isEmptyCell = (cell: unknown) =>
  !Array.isArray(cell) || cell.length === 0;

/**
 * 找出当前进度所在的行：显示顺序里第一个还没生成结果的行。
 * 子任务按参数组合顺序执行，所以它就是「正在执行」的位置；
 * 全部都有结果（或没有可比对的列）时返回 -1，由调用方回到表格最开始。
 */
export const findPendingRowIndex = (
  rows: PreviewTableDataType,
  resultKeys: string[],
): number => {
  if (!resultKeys.length) {
    return -1;
  }
  return rows.findIndex((row) =>
    resultKeys.some((key) => isEmptyCell((row as any)[key])),
  );
};

/** 属性选择器里只需转义引号与反斜杠 */
const escapeAttr = (value: string) => value.replace(/["\\]/g, '\\$&');

/** 表格的纵向滚动容器是 tbody 的某个祖先，向上找最近的可滚动节点 */
const findScroller = (
  node: HTMLElement | null,
  root: HTMLElement,
): HTMLElement | null => {
  let current = node;
  while (current) {
    const style = window.getComputedStyle(current);
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      current.scrollHeight > current.clientHeight + 1
    ) {
      return current;
    }
    if (current === root) {
      break;
    }
    current = current.parentElement;
  }
  return null;
};

/**
 * 把表格滚动到指定行（rowId / index 互相兜底），两者都拿不到时回到顶部。
 * 返回 false 表示此刻表格还没成型（行未渲染 / 还不可滚动），调用方可稍后重试。
 */
export const focusTableRow = (
  root: HTMLElement,
  rowId: string | null,
  index: number,
): boolean => {
  const trs = Array.from(root.querySelectorAll<HTMLElement>('tbody tr'));
  if (!trs.length) {
    return false;
  }
  const target =
    (rowId
      ? root.querySelector<HTMLElement>(
          `tbody tr[data-row-key="${escapeAttr(rowId)}"]`,
        )
      : null) ?? (index >= 0 ? (trs[index] ?? null) : null);
  const scroller = findScroller(target ?? trs[0], root);
  if (!scroller) {
    return false;
  }
  if (!target) {
    // 没有进行中的子任务（已全部完成），定位到最开始
    scroller.scrollTop = 0;
    return true;
  }
  const delta =
    target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  // 目标行贴着可视区顶部，留一点间距避免贴边
  scroller.scrollTop = Math.max(scroller.scrollTop + delta - 8, 0);
  return true;
};
