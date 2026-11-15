// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { ConfigOptionSimple } from '@common/type/result';
import { getImageUrlV2 } from '@common/utils/image';
import {
  RE_AUDIO_SUFFIX,
  RE_IMAGE_SUFFIX,
  RE_VIDEO_SUFFIX,
} from '@common/utils/value-type';

// 通用参数配置分隔符
export const CommonSeparator = '+';

// 单参数以行展示时，生成结果所在列的固定 key
export const SingleParamResultKey = '@result';

// 生成结果的元信息列：回写提示词与执行耗时各自独立成列
export const ResultPromptKey = '@prompt';
// 列 key 沿用旧名，单元格内容现在是耗时文本而非完成时刻
export const ResultTimeKey = '@time';
// 单参数「以列展示」时，用来标注每行是结果 / 提示词 / 耗时的固定首列
export const ResultRowLabelKey = '@row_label';

// 从参数配置中获取key
export const getKey = (c: ConfigOptionSimple, v = '') =>
  `#${c.nodeId}:${c.internal_name}${v !== '' ? `=${v}` : ''}`;

// 从参数配置中获取label for preview
export const getLabel = (c: ConfigOptionSimple, v = '') =>
  `#${c.nodeId}:${c.name}${v !== '' ? `=${v}` : ''}`;

// 从数据集图片路径中取文件key
export const getImageKey = (s: string): string => s.split('/').pop() ?? '';

export const getRenderCellType = (s: string) => {
  const lower = s.toLowerCase();
  if (RE_VIDEO_SUFFIX.test(lower)) {
    return 'video';
  } else if (RE_IMAGE_SUFFIX.test(lower)) {
    return 'image';
  } else if (RE_AUDIO_SUFFIX.test(lower)) {
    return 'audio';
  } else {
    return 'string';
  }
};

export const getRenderCellValue = (
  t: string,
  o: string | number,
  rs: string,
) => {
  if (['image', 'video', 'audio'].includes(t)) {
    if (rs) {
      return rs;
    }
    // 资源库缺失该文件（如旧任务上传失败）时，回退按 input 相对路径预览，
    // 与参数选择界面保持一致，避免缩略图无法显示
    if (typeof o === 'string' && o && !o.includes(':')) {
      return getImageUrlV2(o, 'input');
    }
  }
  return o;
};
