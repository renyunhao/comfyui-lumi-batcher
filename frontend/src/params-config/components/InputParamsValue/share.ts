// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { ColumnTypeEnum } from '@common/constant/creator';
import { I18n } from '@common/i18n';
import { getExpressionValue } from '@common/utils/expression';
import { ValueTypeEnum } from '@common/utils/value-type';
import { ValueBaseType, NodeInfo } from '@src/create-task/utils/get-node-info';

/**
 * @description 处理单个数据转化
 * @param value 数据值
 * @param type 数据类型
 * @returns
 */
export const dataTransferSingle = (
  value: ValueBaseType,
  type: ValueTypeEnum,
): ValueBaseType => {
  let resValue = value;

  switch (type) {
    case ValueTypeEnum.NUMBER:
    case ValueTypeEnum.INT:
    case ValueTypeEnum.FLOAT:
      try {
        resValue = Number(resValue);
        if (isNaN(resValue)) {
          resValue = value;
        }
      } catch {
        resValue = value;
      }
      break;
    case ValueTypeEnum.STRING:
      resValue = String(value ?? '').trim();
      break;
    default:
      break;
  }

  return resValue;
};

/** 数字范围输入（如 1-100 / 100-1），匹配起止均为整数或小数 */
const RE_NUMBER_RANGE = /^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * @description 数字类型参数值范围展开：如 "1-100" 展开为 1~100 共 100 个值
 * @param raw 输入文本
 * @param type 参数值类型
 * @returns 展开后的数值数组；非数字类型或格式不匹配时返回 null
 */
export const expandNumberRange = (
  raw: string,
  type?: ValueTypeEnum,
): number[] | null => {
  if (
    ![ValueTypeEnum.NUMBER, ValueTypeEnum.INT, ValueTypeEnum.FLOAT].includes(
      type as ValueTypeEnum,
    )
  ) {
    return null;
  }
  const match = RE_NUMBER_RANGE.exec(String(raw));
  if (!match) {
    return null;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const step = end >= start ? 1 : -1;
  const result: number[] = [];
  // 1e-9 容差，避免浮点误差导致少生成最后一个值
  for (
    let v = start;
    step > 0 ? v <= end + 1e-9 : v >= end - 1e-9;
    v += step
  ) {
    result.push(Number(v.toFixed(6)));
  }
  return result;
};

/**
 * @description 对以分号分隔的多段输入逐段做数字范围展开
 * @param items 分段字符串数组
 * @param type 参数值类型
 * @returns 展开并展平后的值数组
 */
export const expandNumberRangeList = (
  items: string[],
  type?: ValueTypeEnum,
): (string | number)[] => {
  const result: (string | number)[] = [];
  items.forEach((item) => {
    const range = expandNumberRange(item, type);
    if (range) {
      result.push(...range);
    } else {
      result.push(item);
    }
  });
  return result;
};

/**
 * @description 处理数据转化
 * @param value 数据值
 * @param type 数据类型
 * @returns
 */
export const dataTransfer = (
  value: NodeInfo['paramValue'],
  type: ValueTypeEnum = ValueTypeEnum.STRING,
): ValueBaseType[] => {
  if (value instanceof Array) {
    const temp = value
      .filter((item) => item !== '')
      .map((item) => getExpressionValue(String(item)))
      .flat(1);
    return temp.map((item) => dataTransferSingle(item, type));
  } else {
    if (value) {
      return getExpressionValue(String(value))
        .map((item) => dataTransferSingle(item, type))
        .flat(1);
    }
    return [dataTransferSingle(value, type)];
  }
};

export const getPlaceholderText = (type: ColumnTypeEnum): string => {
  switch (type) {
    case ColumnTypeEnum.Image:
      return I18n.t(
        'support_multi_select_upload_or_zip_archive',
        {},
        '支持多选上传或Zip压缩包',
      );
    case ColumnTypeEnum.Text:
      return I18n.t(
        'you_can_add_or_upload_excel_in_batches_through__;_',
        {},
        '可通过“；”批量添加或上传Excel',
      );
    case ColumnTypeEnum.Number:
      return I18n.t(
        'you_can_add_or_upload_excel_in_batches_through__;__2',
        {},
        '可通过“；”批量添加或上传ExceL',
      );
    default:
      return I18n.t(
        'it_can_be_added_in_batches_through__;_',
        {},
        '可通过“；”批量添加',
      );
  }
};
