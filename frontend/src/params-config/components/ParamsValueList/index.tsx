// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import type { CSSProperties } from 'react';
import { useMemo, useRef, useState } from 'react';

import { Button, Popconfirm, Tooltip } from '@arco-design/web-react';
import { IconClose, IconDelete, IconEdit } from '@arco-design/web-react/icon';
import cn from 'classnames';
import _ from 'lodash';
import { useShallow } from 'zustand/react/shallow';

import valuesEmptyGuide from '../../../../static/img/values-empty-guide.png';
import valuesEmptyGuideEn from '../../../../static/img/values-empty-guide-en.png';

import { InputParamsValue } from '../InputParamsValue';
import { ParamsValuePreview } from '../ParamsValuePreview';
import { readThumbSize, ThumbnailSizeSlider } from './ThumbnailSizeSlider';

import './index.scss';
import { useCreatorStore } from '@src/create-task/store';
import {
  NodeInfo,
  validateValueType,
} from '@src/create-task/utils/get-node-info';
import { checkParamType } from '../../utils/check-task-param-type';
import type { ValueType } from '../../utils/check-task-param-type';
import { I18n } from '@common/i18n';
import { LanguagesEnum, languageUtils, TranslateKeys } from '@common/language';
import { formatSerialNumber } from '@common/utils/text';
import { BrandName } from '@common/constant/batch';
import { createWithPrefix } from '@common/utils/create-with-prefix';

const withPrefix = createWithPrefix(BrandName);

/** 只有这些类型有缩略图可看，滑块也只在它们出现时才有意义 */
const PREVIEWABLE_TYPES: ValueType[] = ['image', 'video', 'audio'];

interface ValueItem {
  /** 稳定 key：编辑态依赖它，不能像原来那样每次重算 uuid */
  key: string;
  value: string;
  configId: string;
  internalName: string;
  nodeId?: string | number;
  /** 当前值在参数值数组中的下标 */
  index: number;
  /** group 模式下所属子参数下标，单参数为 -1 */
  subIndex: number;
  previewType: ValueType;
  /** 内联编辑配置：随 rows 一起缓存，保证传给输入框的对象引用稳定 */
  editConfig: any;
}

interface ValueRow {
  id: string;
  index: number;
  items: ValueItem[];
}

export const ParamsValueList = () => {
  const [
    currentParamsConfig,
    currentNodeInfoMap,
    isShowValuesError,
    updateCurrentConfig,
  ] = useCreatorStore(
    useShallow((state) => [
      state.currentParamsConfig,
      state.currentNodeInfoMap,
      state.isShowValuesError,
      state.updateCurrentConfig,
    ]),
  );

  const [editStatusMap, setEditStatusMap] = useState<Record<string, boolean>>(
    {},
  );
  const cardsRef = useRef<HTMLDivElement>(null);
  // 只在挂载时读取一次，之后尺寸完全由滑块自己维护
  const initialThumbSize = useMemo(() => readThumbSize(), []);

  const { type } = currentParamsConfig;

  /** 把 group / 单参数两种数据形状收敛成统一的「一行 = 一张横向卡片」 */
  const rows = useMemo<ValueRow[]>(() => {
    const result: ValueRow[] = [];
    if (type === 'group') {
      const subConfigs = currentParamsConfig.values ?? [];
      const count = Math.max(
        0,
        ...subConfigs.map((config) => config.values?.length ?? 0),
      );
      for (let index = 0; index < count; index += 1) {
        result.push({
          id: `row-${index}`,
          index,
          items: subConfigs.map((config, subIndex) => {
            const value = config.values?.[index];
            const key = `${index}-${config.config_id}`;
            const text = String(value ?? '');
            return {
              key,
              value: text,
              configId: config.config_id,
              internalName: config.internal_name ?? '',
              nodeId: config.nodeId,
              index,
              subIndex,
              previewType: checkParamType(value),
              editConfig: {
                ...currentParamsConfig,
                id: key,
                config_id: config.config_id,
                nodeId: config.nodeId,
                internal_name: config.internal_name,
                index,
                value: text,
              },
            };
          }),
        });
      }
    } else {
      const config = currentParamsConfig;
      config.values?.forEach((value, index) => {
        const key = `${index}-${config.config_id}`;
        const text = String(value ?? '');
        result.push({
          id: `row-${index}`,
          index,
          items: [
            {
              key,
              value: text,
              configId: config.config_id,
              internalName: config.internal_name ?? '',
              nodeId: config.nodeId,
              index,
              subIndex: -1,
              previewType: checkParamType(value),
              editConfig: {
                ...config,
                id: key,
                config_id: config.config_id,
                nodeId: config.nodeId,
                internal_name: config.internal_name,
                index,
                value: text,
              },
            },
          ],
        });
      });
    }
    return result;
  }, [currentParamsConfig, type]);

  const hasValues = rows.length > 0;
  const hasPreviewable = useMemo(
    () =>
      rows.some((row) =>
        row.items.some((item) => PREVIEWABLE_TYPES.includes(item.previewType)),
      ),
    [rows],
  );

  const updateEditStatus = (key: string, status: boolean) => {
    setEditStatusMap((data) => ({ ...data, [key]: status }));
  };

  const getNodeInfoForItem = (item: ValueItem): NodeInfo => {
    if (!item.nodeId) {
      return {} as NodeInfo;
    }
    // 与 getNodeInfoKey 保持一致： `${nodeId}_${internal_name}`
    return (
      currentNodeInfoMap[`${item.nodeId}_${item.internalName}`] ||
      ({} as NodeInfo)
    );
  };

  const handleValueChange = (item: ValueItem, rowId: string, next: any) => {
    const value = next instanceof Array ? next[0] : next;
    const temp = _.cloneDeep(currentParamsConfig);
    if (type === 'group') {
      temp.values[item.subIndex].values[item.index] = value;
    } else {
      temp.values[item.index] = value;
    }
    updateCurrentConfig({ values: temp.values });
    updateEditStatus(rowId, false);
  };

  const handleDelete = (index: number) => {
    const temp = _.cloneDeep(currentParamsConfig);
    if (type === 'group') {
      temp.values?.forEach((config) => {
        config.values?.splice(index, 1);
      });
    } else {
      temp.values.splice(index, 1);
    }
    // 卡片 key 是按下标生成的，删掉一项后下标会复用，清掉编辑态避免错位
    setEditStatusMap({});
    updateCurrentConfig({ values: temp.values });
  };

  /** 清空当前参数的所有参数值 */
  const handleClearAllValues = () => {
    setEditStatusMap({});
    if (type === 'group') {
      updateCurrentConfig({
        values: currentParamsConfig.values.map((item) => ({
          ...item,
          values: [],
        })),
      });
    } else {
      updateCurrentConfig({ values: [] });
    }
  };

  return (
    <div className={withPrefix('params-value-list')}>
      <div className="title-container">
        <span className="title">
          {languageUtils.getText(TranslateKeys.PARAM_LIST)}
        </span>
        <div className="params-values-toolbar">
          {hasValues && hasPreviewable && (
            <ThumbnailSizeSlider
              targetRef={cardsRef}
              defaultValue={initialThumbSize}
            />
          )}
          {hasValues && (
            <Popconfirm
              title={I18n.t(
                'are_you_sure_to_clear_all_parameter_values',
                {},
                '确认清空所有参数值吗？',
              )}
              onOk={handleClearAllValues}
            >
              <Button
                type="outline"
                status="danger"
                size="mini"
                icon={<IconDelete />}
              >
                {I18n.t('clear_all', {}, '清空')}
              </Button>
            </Popconfirm>
          )}
        </div>
      </div>

      {hasValues ? (
        <div
          ref={cardsRef}
          className={cn('params-values-cards', {
            'is-text-only': !hasPreviewable,
          })}
          style={
            {
              '--params-thumb-size': `${initialThumbSize}px`,
            } as CSSProperties
          }
        >
          {rows.map((row) => {
            const isEditing = Boolean(editStatusMap[row.id]);
            return (
              <div
                className={cn('params-values-card', {
                  'is-editing': isEditing,
                })}
                key={row.id}
              >
                <span className="params-values-card-index">
                  {formatSerialNumber(row.index + 1)}
                </span>
                <Tooltip
                  content={
                    isEditing
                      ? I18n.t('cancel_edit', {}, '取消编辑')
                      : I18n.t(
                          'edit_value_hint',
                          {},
                          '编辑该值（回车保存 / Esc 取消）',
                        )
                  }
                >
                  <Button
                    className="params-values-card-edit"
                    shape="circle"
                    icon={isEditing ? <IconClose /> : <IconEdit />}
                    size="mini"
                    onClick={() => updateEditStatus(row.id, !isEditing)}
                  />
                </Tooltip>

                {row.items.map((item) => {
                  const previewable = PREVIEWABLE_TYPES.includes(
                    item.previewType,
                  );
                  const nodeInfo = getNodeInfoForItem(item);
                  const isError = isShowValuesError
                    ? Boolean(nodeInfo.paramType) &&
                      !validateValueType(item.value, nodeInfo.paramType)
                    : false;
                  return (
                    <div className="params-values-card-item" key={item.key}>
                      {type === 'group' && (
                        <div
                          className="params-values-card-label"
                          title={item.internalName}
                        >
                          {item.internalName}
                        </div>
                      )}
                      <div
                        className={cn('params-values-card-stage', {
                          'is-text': !previewable,
                          'is-editing': isEditing,
                        })}
                        title={item.value}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            updateEditStatus(row.id, false);
                          }
                        }}
                      >
                        {isEditing ? (
                          <InputParamsValue
                            autoFocus
                            size="default"
                            enterFrom="single-input"
                            currentParamConfig={item.editConfig}
                            noSplit
                            commitOnBlur={false}
                            placeholder={`${I18n.t('{internal_name}_value__enter_key_to_submit', { internal_name: item.internalName }, '{internal_name}值，enter键提交')}`}
                            defaultValue={item.value}
                            onChange={(v) => handleValueChange(item, row.id, v)}
                          />
                        ) : (
                          <ParamsValuePreview
                            value={item.value}
                            width="100%"
                            height="100%"
                            isError={isError}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* 删除按钮贴在预览图下方、与图片等宽，整块都是可点击区域 */}
                <Button
                  className="params-values-card-remove"
                  status="danger"
                  size="small"
                  icon={<IconDelete />}
                  long
                  onClick={() => handleDelete(row.index)}
                >
                  {I18n.t('delete', {}, '删除')}
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <img
          className="img"
          src={
            languageUtils.getLanguage() === LanguagesEnum.EN
              ? valuesEmptyGuideEn
              : valuesEmptyGuide
          }
          alt=""
        />
      )}
    </div>
  );
};
