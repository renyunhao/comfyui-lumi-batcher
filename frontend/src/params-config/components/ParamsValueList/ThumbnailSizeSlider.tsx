// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import type { RefObject } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { Slider, Tooltip } from '@arco-design/web-react';

import { ReactComponent as IconGridBig } from '@static/icons/grid-big.svg';
import { ReactComponent as IconGridSmall } from '@static/icons/grid-small.svg';

import './index.scss';
import { I18n } from '@common/i18n';

export const MIN_THUMB_SIZE = 96;
export const MAX_THUMB_SIZE = 400;
export const DEFAULT_THUMB_SIZE = 160;
export const THUMB_SIZE_STORAGE_KEY = 'comfyui-lumi-batcher:params-thumb-size';

/** 读取上次保存的缩略图尺寸，非法值回落到默认值 */
export const readThumbSize = (): number => {
  try {
    const saved = Number(window.localStorage.getItem(THUMB_SIZE_STORAGE_KEY));
    if (
      Number.isFinite(saved) &&
      saved >= MIN_THUMB_SIZE &&
      saved <= MAX_THUMB_SIZE
    ) {
      return saved;
    }
  } catch {
    // 隐私模式等场景下 localStorage 不可用，直接用默认值
  }
  return DEFAULT_THUMB_SIZE;
};

const asNumber = (value: number | number[]) =>
  Array.isArray(value) ? value[0] : value;

/**
 * 缩略图尺寸滑块。
 *
 * 尺寸通过 CSS 变量写到卡片列表容器上，由浏览器直接重排：拖动过程中
 * 参数列表（可能有几百张预览）完全不参与 React 重渲染。数值文案用 rAF
 * 合并，且 state 只存在于这个轻量子组件内部，不会向上冒泡。
 */
export const ThumbnailSizeSlider = memo<{
  /** 卡片列表容器 */
  targetRef: RefObject<HTMLDivElement>;
  defaultValue: number;
}>(({ targetRef, defaultValue }) => {
  const [size, setSize] = useState(defaultValue);
  const frameRef = useRef(0);

  useEffect(
    () => () => {
      window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const handleChange = useCallback(
    (value: number | number[]) => {
      const next = asNumber(value);
      targetRef.current?.style.setProperty('--params-thumb-size', `${next}px`);
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = window.requestAnimationFrame(() => setSize(next));
    },
    [targetRef],
  );

  const handleAfterChange = useCallback((value: number | number[]) => {
    try {
      window.localStorage.setItem(
        THUMB_SIZE_STORAGE_KEY,
        String(asNumber(value)),
      );
    } catch {
      // 存储失败不影响当前会话
    }
  }, []);

  return (
    <div className="params-values-size-control">
      <Tooltip content={I18n.t('thumbnail_size_smaller', {}, '缩小缩略图')}>
        <span className="params-values-size-icon">
          <IconGridSmall />
        </span>
      </Tooltip>
      <Slider
        className="params-values-size-slider"
        min={MIN_THUMB_SIZE}
        max={MAX_THUMB_SIZE}
        step={8}
        range={false}
        defaultValue={defaultValue}
        onChange={handleChange}
        onAfterChange={handleAfterChange}
        formatTooltip={(value) => `${value}px`}
        getTooltipContainer={() => document.body}
      />
      <Tooltip content={I18n.t('thumbnail_size_larger', {}, '放大缩略图')}>
        <span className="params-values-size-icon">
          <IconGridBig />
        </span>
      </Tooltip>
      <span className="params-values-size-value">{size}px</span>
    </div>
  );
});
