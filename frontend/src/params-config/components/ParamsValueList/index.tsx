// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button, Popconfirm, Tooltip } from '@arco-design/web-react';
import {
  IconClose,
  IconDelete,
  IconDragDotVertical,
  IconEdit,
} from '@arco-design/web-react/icon';
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

/** 把 from 位置的元素移动到 to 位置；下标越界或原地不动时返回副本 */
export const moveItem = <T,>(list: T[], from: number, to: number): T[] => {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return [...list];
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

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
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  /** 只有从把手按下才允许发起拖拽，避免和编辑 / 删除 / 查看大图冲突 */
  const fromHandleRef = useRef(false);
  /** dragover / drop 读 ref，不依赖 state 更新时机 */
  const dragFromRef = useRef<number | null>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  // 只在挂载时读取一次，之后尺寸完全由滑块自己维护
  const initialThumbSize = useMemo(() => readThumbSize(), []);

  /**
   * 标题栏吸顶位置 = 参数选择行的吸顶位置 + 该行高度。
   * 参数选择行在窄屏可能换行变高，用 ResizeObserver 跟着更新。
   */
  const [stickyTop, setStickyTop] = useState(160);
  useEffect(() => {
    const row = document.querySelector<HTMLElement>(
      '.params-config-sticky-row',
    );
    if (!row) {
      return;
    }
    const update = () => {
      // 必须对齐参数选择行自己的吸顶位置（它 CSS 里写死 top: 80px）。
      // 不能用 header 实际高度代替：两者不相等时会算出偏小的 top，
      // 两层 sticky 重叠，标题栏被压在下面只露出一条边。
      const rowTop = Number.parseFloat(getComputedStyle(row).top) || 80;
      // 多留 2px，避免亚像素误差造成边缘遮挡
      setStickyTop(Math.round(rowTop + row.offsetHeight) + 2);
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

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

  const resetDrag = () => {
    fromHandleRef.current = false;
    dragFromRef.current = null;
    setDraggingIndex(null);
    setDragOverIndex(null);
  };

  /**
   * 拖拽换序：group 模式下所有子参数必须同步移动同一个下标，
   * 否则一组里各参数的值会错配成别的组合。
   */
  const handleReorder = (from: number, to: number) => {
    if (from === to || Number.isNaN(from)) {
      return;
    }
    const temp = _.cloneDeep(currentParamsConfig);
    if (type === 'group') {
      temp.values = temp.values.map((config) => ({
        ...config,
        values: moveItem(config.values ?? [], from, to),
      }));
    } else {
      temp.values = moveItem(temp.values ?? [], from, to);
    }
    // 卡片 key 与编辑态都按下标生成，重排后清掉避免输入框错位
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
      <div className="title-container" style={{ top: stickyTop }}>
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
          onDragOver={(e) => {
            if (dragFromRef.current === null) {
              return;
            }
            // 允许在卡片之间的间隙放下，否则拖偏一点就会毫无反应
            e.preventDefault();
          }}
          onDrop={(e) => {
            // 卡片自身的 onDrop 会先处理并清空 dragFromRef；
            // 仍为非空说明落在了空白区域，兜底把该项移到末尾
            if (dragFromRef.current === null || e.target !== e.currentTarget) {
              return;
            }
            e.preventDefault();
            handleReorder(dragFromRef.current, rows.length - 1);
            resetDrag();
          }}
        >
          {rows.map((row) => {
            const isEditing = Boolean(editStatusMap[row.id]);
            const canDrag = rows.length > 1;
            return (
              <div
                className={cn('params-values-card', {
                  'is-editing': isEditing,
                  'is-dragging': draggingIndex === row.index,
                  'is-drag-over':
                    dragOverIndex === row.index &&
                    draggingIndex !== null &&
                    draggingIndex !== row.index,
                })}
                key={row.id}
                draggable={canDrag && !isEditing}
                onMouseDown={(e) => {
                  fromHandleRef.current = Boolean(
                    (e.target as HTMLElement).closest(
                      '.params-values-card-drag',
                    ),
                  );
                }}
                onDragStart={(e) => {
                  // 卡片本身 draggable，但只允许从把手发起；
                  // 否则拖图片、点按钮、选输入框文字都会误触发拖拽
                  if (!fromHandleRef.current || isEditing) {
                    e.preventDefault();
                    return;
                  }
                  dragFromRef.current = row.index;
                  setDraggingIndex(row.index);
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox 必须 setData 才会真正开始拖拽
                  e.dataTransfer.setData('text/plain', String(row.index));
                }}
                onDragOver={(e) => {
                  if (dragFromRef.current === null) {
                    return;
                  }
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverIndex !== row.index) {
                    setDragOverIndex(row.index);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragFromRef.current;
                  if (from !== null) {
                    handleReorder(from, row.index);
                  }
                  resetDrag();
                }}
                onDragEnd={resetDrag}
              >
                <div className="params-values-card-top-left">
                  <span className="params-values-card-index">
                    {formatSerialNumber(row.index + 1)}
                  </span>
                </div>
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
                  // 图片 / 视频铺满整块预览区，按上下对半分区；
                  // 音频 / 文本只有顶部一行内容，拖拽区放到下方留白
                  const hasFullPreview =
                    item.previewType === 'image' ||
                    item.previewType === 'video';
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
                        {/* 上半部分拖拽、下半部分点击打开大图；
                            没有大图预览的类型整块都可拖 */}
                        {canDrag && !isEditing && (
                          <span
                            className={cn(
                              'params-values-card-drag',
                              hasFullPreview ? 'is-half' : 'is-lower',
                            )}
                            title={I18n.t(
                              'drag_to_reorder',
                              {},
                              '按住拖拽调整参数值顺序',
                            )}
                            aria-label={I18n.t(
                              'drag_to_reorder',
                              {},
                              '按住拖拽调整参数值顺序',
                            )}
                          >
                            <IconDragDotVertical />
                          </span>
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
