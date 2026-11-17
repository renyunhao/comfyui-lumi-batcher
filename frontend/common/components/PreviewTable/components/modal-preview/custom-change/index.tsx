// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useMemo } from 'react';

import { useShallow } from 'zustand/react/shallow';

import { ReactComponent as ArrowLeft } from '@static/icons/arrow-left.svg';
import { ReactComponent as ArrowRight } from '@static/icons/arrow-right.svg';

import { usePreviewTableStore } from '../../../store';
import { type PreviewTableCellValueType } from '../../../type/table';
import {
  AcceptKeyCodeList,
  changePreview,
} from '../../../utils/change-preview';
import styles from './index.module.scss';
import { I18n } from '@common/i18n';

export const CustomChange: React.FC<{
  isMulti?: boolean;
}> = ({ isMulti = false }) => {
  const [currentCol, currentRow, columnList] = usePreviewTableStore(
    useShallow((s) => [s.currentCol, s.currentRow, s.columnList]),
  );

  const { getCellValue } = usePreviewTableStore.action;

  const imgInfo = useMemo(() => {
    const maxCol = columnList.length - 1;
    let leftCell, rightCell: PreviewTableCellValueType | undefined;

    if (currentCol - 1 < 0) {
      leftCell = undefined;
    } else {
      leftCell = getCellValue(currentRow, currentCol - 1);
    }

    if (currentCol + 1 > maxCol) {
      rightCell = undefined;
    } else {
      rightCell = getCellValue(currentRow, currentCol + 1);
    }

    let leftImg = '';
    let rightImg = '';

    if (leftCell) {
      const leftImages = leftCell.filter((item) => item.type === 'image');
      if (leftImages.length > 0) {
        leftImg = leftImages[0].value[0];
      }
    }

    // 右侧与左侧相互独立：第一列没有左邻时，右侧预览仍要显示
    if (rightCell) {
      const rightImages = rightCell.filter((item) => item.type === 'image');
      if (rightImages.length > 0) {
        rightImg = rightImages[0].value[0];
      }
    }

    return {
      leftImg,
      rightImg,
    };
  }, [columnList.length, currentCol, currentRow, getCellValue]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (AcceptKeyCodeList.includes(e.code)) {
        changePreview(e.code);
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', fn, { capture: !isMulti });

    return () => {
      window.removeEventListener('keydown', fn, { capture: !isMulti });
    };
  }, [isMulti]);

  return (
    <div className={styles.container}>
      {imgInfo.leftImg ? (
        <div className={styles.left} onClick={() => changePreview('ArrowLeft')}>
          <div className={styles.imgContainer}>
            <img className={styles.img} src={imgInfo.leftImg} alt="" />
          </div>
          <span>{I18n.t('previous_cell', {}, '前一个单元格')}</span>
          <ArrowLeft className={styles.icon} />
        </div>
      ) : null}
      {imgInfo.rightImg ? (
        <div
          className={styles.right}
          onClick={() => changePreview('ArrowRight')}
        >
          <div className={styles.imgContainer}>
            <img className={styles.img} src={imgInfo.rightImg} alt="" />
          </div>
          <span>{I18n.t('next_cell', {}, '后一个单元格')}</span>
          <ArrowRight className={styles.icon} />
        </div>
      ) : null}
    </div>
  );
};
