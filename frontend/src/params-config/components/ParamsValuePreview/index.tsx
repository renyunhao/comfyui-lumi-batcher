// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import type React from 'react';
import { useMemo, useState } from 'react';

import { Image, Typography } from '@arco-design/web-react';

import './index.scss';
import { getImageUrlV2 } from '@common/utils/image';
import BlobVideo from '@common/components/PreviewTable/components/BlobVideo';
import { checkParamType } from '@src/params-config/utils/check-task-param-type';
import { AudioValuePreview } from '@common/components/AudioValuePreview';

export const ParamsValuePreview: React.FC<{
  value: any;
  width?: number | string;
  height?: number | string;
  maxWidth?: number | string;
  maxHeight?: number | string;
  isError?: boolean;
}> = ({
  value,
  width,
  height,
  maxWidth = 'unset',
  maxHeight = 'unset',
  isError = false,
}) => {
  /** 记住加载失败的是哪个值；值变了就恢复按真实类型预览 */
  const [failedValue, setFailedValue] = useState<any>(() => Symbol('none'));
  // 类型由当前 value 派生：卡片复用时编辑了值也能立刻切到正确的预览形态，
  // 不能只在首次 mount 时算一次
  const type = useMemo(
    () => (failedValue === value ? 'text' : checkParamType(value)),
    [failedValue, value],
  );

  const Content = useMemo(() => {
    const url = getImageUrlV2(String(value), 'input', false);
    const border = isError
      ? '1px solid #ff453a'
      : '1px solid var(--border-color-border-1, rgba(255, 255, 255, 0.12))';
    const boxStyle = {
      maxWidth,
      maxHeight,
      border,
      borderRadius: 4,
      boxSizing: 'border-box' as const,
      ...{ width: width ?? undefined, height: height ?? undefined },
    };
    if (type === 'image') {
      return (
        <Image
          onError={() => setFailedValue(value)}
          className="param-value-preview-image"
          src={url}
          // 卡片数量可能很多，交给浏览器按可视区域加载
          loading="lazy"
          style={boxStyle}
          {...{ width: width ?? undefined, height: height ?? undefined }}
        />
      );
    } else if (type === 'video') {
      return (
        <BlobVideo
          src={url}
          preload="none"
          style={boxStyle}
          clickToFullScreen
          className="param-value-preview-video"
          hoverPlay
          controls={false}
        />
      );
    } else if (type === 'audio') {
      return (
        <AudioValuePreview
          audioProps={{
            src: url,
            preload: 'none',
            style: boxStyle,
            className: 'param-value-preview-audio',
          }}
          wrapperStyle={{
            color: isError ? '#ff453a' : '',
          }}
          isError={isError}
          value={value}
        ></AudioValuePreview>
      );
    } else {
      return (
        <Typography.Paragraph
          className="clear-arco-typography-margin-bottom"
          ellipsis={{
            rows: 1,
            showTooltip: true,
            wrapper: 'div',
          }}
          style={{ color: isError ? '#ff453a' : '' }}
        >
          {value}
        </Typography.Paragraph>
      );
    }
  }, [height, isError, maxHeight, maxWidth, type, value, width]);

  if (value === undefined) {
    return null;
  }

  return Content;
};
