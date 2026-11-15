// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { TaskResultInfo, ResultOutputTypeEnum, ResultItem } from '@api/result';
import { PreviewTableCellValueType } from '@common/components/PreviewTable/type/table';
import { CommonParamValueType } from '@common/type/result';
import { processOutputUrl } from '../process-resource';

/** 回写数据里的分段标记，如「1段回写」「第2段回写」，可带冒号/逗号 */
const RE_WRITEBACK_ONLY = /^\s*(?:第)?\d+\s*段回写\s*[:：,，\-]?\s*$/i;
const RE_WRITEBACK_LABEL = /^\s*(?:第)?\d+\s*段回写\s*[:：,，\-]?\s*/i;

/** 生成结果列只展示结果文件，回写文本与耗时各自独立成列 */
const RESULT_FILE_TYPES = [
  ResultOutputTypeEnum.Image,
  ResultOutputTypeEnum.Video,
  ResultOutputTypeEnum.Audio,
];

// 处理结果数据转换成表格单元格数据（只含结果文件）
export const processResult = (
  info: TaskResultInfo,
): PreviewTableCellValueType => {
  const res: PreviewTableCellValueType = [];
  RESULT_FILE_TYPES.forEach((type) => {
    const temp = (info.list ?? []).filter((v) => v.type === type);
    if (temp.length > 0) {
      res.push({
        label: '',
        type: transferResultValueType(type),
        value: temp.map((v) => getValue(v)),
      });
    }
  });
  return res;
};

/**
 * 从 text 类型输出里提取最终提示词。
 * 回写数据可能是 JSON 数组或纯文本，最开头会有「N段回写」这类分段标记，
 * 它只是段落说明、不是提示词内容，去掉后剩下的才是要展示的提示词。
 */
export const extractResultPrompt = (info?: TaskResultInfo): string => {
  const parts: string[] = [];
  (info?.list ?? [])
    .filter((item) => item.type === ResultOutputTypeEnum.Text)
    .forEach((item) => {
      const raw = item.value ?? '';
      let chunks: string[];
      try {
        const parsed = JSON.parse(raw);
        chunks = Array.isArray(parsed)
          ? parsed.map((v) => String(v ?? ''))
          : [String(parsed)];
      } catch {
        chunks = [raw];
      }
      chunks.forEach((chunk) => {
        chunk.split(/\r?\n/).forEach((line) => {
          if (RE_WRITEBACK_ONLY.test(line)) {
            return;
          }
          const cleaned = line.replace(RE_WRITEBACK_LABEL, '').trim();
          if (cleaned) {
            parts.push(cleaned);
          }
        });
      });
    });
  return parts.join('\n').trim();
};

/**
 * 子任务执行时长的可读文本。
 * duration 是后端用 execution_start / task_done 两个时间戳算出的毫秒差值，
 * 不是时间戳，绝不能再当日期格式化（旧实现把毫秒又 ×1000，显示成 58840 年）。
 * 升级前的历史任务没有这两个时间点，显示 '-'。
 */
export const formatResultDuration = (duration?: number): string => {
  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration < 0
  ) {
    return '-';
  }
  // 脏数据兜底：单次执行不可能超过 7 天（排队 / 暂停时间不计入耗时），
  // 超了宁可显示 '-'，也不要出现「58840 年」这种离谱内容
  if (duration > 7 * 24 * 60 * 60 * 1000) {
    return '-';
  }
  const seconds = duration / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}分${String(Math.floor(seconds % 60)).padStart(2, '0')}秒`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}小时${String(minutes % 60).padStart(2, '0')}分`;
};

// 处理结果类型转换成表格类型
export const transferResultValueType = (
  type: ResultOutputTypeEnum,
): CommonParamValueType => {
  if (type === ResultOutputTypeEnum.Image) {
    return 'image';
  } else if (type === ResultOutputTypeEnum.Video) {
    return 'video';
  } else if (type === ResultOutputTypeEnum.Audio) {
    return 'audio';
  } else if (type === ResultOutputTypeEnum.Text) {
    return 'string';
  } else {
    return 'string';
  }
};

// 获取当前展示的值
export const getValue = (
  info: ResultItem,
  noProcessResource = false,
): string => {
  let res = '';
  try {
    if (
      info.type === ResultOutputTypeEnum.Image ||
      info.type === ResultOutputTypeEnum.Video ||
      info.type === ResultOutputTypeEnum.Audio
    ) {
      res = noProcessResource ? info.url : processOutputUrl(info.url);
    } else if (info.type === ResultOutputTypeEnum.Text) {
      res = info.value ? JSON.parse(info.value).join(',') : (info.value ?? '');
    } else {
      res = info.value ?? '';
    }
  } catch (error) {
    console.error(error);
    res = '';
  }
  return res;
};

// 获取源数据的值
export const getOriginValue = (info: ResultItem): string => {
  let res = '';
  try {
    if (
      info.type === ResultOutputTypeEnum.Image ||
      info.type === ResultOutputTypeEnum.Video
    ) {
      res = info.uri ?? '';
    } else if (info.type === ResultOutputTypeEnum.Text) {
      res = info.value ?? '';
    } else {
      res = info.value ?? '';
    }
  } catch (error) {
    console.error(error);
    res = '';
  }
  return res;
};
