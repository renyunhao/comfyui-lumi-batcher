// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Button,
  Input,
  type InputProps,
  Select,
  Space,
  Typography,
} from '@arco-design/web-react';
import { IconFolder } from '@arco-design/web-react/icon';
import { useShallow } from 'zustand/react/shallow';

import { ClearComponent } from './ClearComp';
import { CustomTag } from './CustomTag';
import { RandomSeed } from './RandomSeed';
import {
  dataTransfer,
  expandNumberRange,
  expandNumberRangeList,
} from './share';
import { UploadComponent } from './UploadComp';
import type { Size } from './UploadPopover/shared';
import { ImagePicker } from '../ImagePicker';

import './index.scss';
import { I18n } from '@common/i18n';
import {
  getNodeInfo,
  getNodeInfoKey,
  NodeInfo,
  ValueBaseType,
} from '@src/create-task/utils/get-node-info';
import { ParamsConfigTypeItem } from '@common/type/batch-task';
import { useCreatorStore } from '@src/create-task/store';
import {
  buildSpecialOutputValue,
  getSpecialOutputValue,
  RE_VIDEO_SUFFIX,
  ValueTypeEnum,
} from '@common/utils/value-type';
import { TemplateFileType } from '@common/constant/creator';
import { SpecialOutputSuffix } from '@common/constant/params-config';
import { uuid } from '@common/utils/uuid';
import { getInputFiles } from '@api/input-files';

interface InputParamsValueProps {
  onChange: (value: ValueBaseType[]) => void;
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  noSplit?: boolean;
  popover?: {
    type: TemplateFileType;
    size: Size;
  };
  currentParamConfig: ParamsConfigTypeItem;
  enterFrom?: 'batch-input' | 'single-input';
  size?: InputProps['size'];
}

export const InputParamsValue: React.FC<InputParamsValueProps> = (props) => {
  const {
    onChange,
    placeholder = '',
    autoFocus,
    defaultValue = '',
    noSplit,
    popover,
    currentParamConfig,
    size = 'large',
    enterFrom = 'batch-input',
  } = props;
  const [currentNodeInfoMap, updateCurrentNodeInfoMap] = useCreatorStore(
    useShallow((s) => [s.currentNodeInfoMap, s.updateCurrentNodeInfoMap]),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);
  const [value, setValue] = useState<string | string[]>(defaultValue);
  const [inputValue, setInputValue] = useState<string | string[]>('');
  const [popupVisible, setPopupVisible] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState(false);
  /** input 目录（含子目录）下的图片相对路径列表 */
  const [inputImageFiles, setInputImageFiles] = useState<string[]>([]);
  /** 下拉列表最大高度，弹出时按输入框到屏幕底部的距离自适应 */
  const [dropdownMaxHeight, setDropdownMaxHeight] = useState<string>();
  const [pickerVisible, setPickerVisible] = useState(false);
  // 弹窗挂载时焦点锁会触发输入框 blur，用 ref 同步判断，避免误提交
  const pickerVisibleRef = useRef(false);

  const nodeInfo = currentParamConfig?.nodeId
    ? currentNodeInfoMap[getNodeInfoKey(currentParamConfig)]
    : ({} as NodeInfo);

  const isImageParam = nodeInfo?.paramType === ValueTypeEnum.IMAGE;

  const matchSelector =
    nodeInfo?.paramOptions?.length > 0 ||
    (nodeInfo?.paramType === ValueTypeEnum.IMAGE && inputImageFiles.length > 0);

  useEffect(() => {
    if (!currentParamConfig.nodeId) {
      return;
    }

    const n = getNodeInfo(
      currentParamConfig.nodeId,
      currentParamConfig.internal_name,
    );

    updateCurrentNodeInfoMap(n.key, n);
  }, [currentParamConfig]);

  // 图片参数：拉取 input 目录（含子目录）下的图片，用于快速选择
  useEffect(() => {
    if (nodeInfo?.paramType !== ValueTypeEnum.IMAGE) {
      return;
    }
    let cancelled = false;
    getInputFiles('image')
      .then((res) => {
        if (!cancelled) {
          setInputImageFiles(res?.data ?? []);
        }
      })
      .catch((e) => {
        console.error('获取 input 图片列表失败:', e);
      });
    return () => {
      cancelled = true;
    };
  }, [nodeInfo?.paramType]);

  const handleChange = (newValue?: any) => {
    const lastValue = newValue || value;
    if (isEditing) {
      return;
    }
    if (lastValue instanceof Array) {
      onChange(
        dataTransfer(
          expandNumberRangeList(
            lastValue.map((v) => String(v)),
            nodeInfo?.paramType,
          ),
          nodeInfo?.paramType,
        ),
      );
      setValue('');
      return;
    }

    if (noSplit) {
      onChange(dataTransfer(lastValue, nodeInfo?.paramType));
    } else {
      if (lastValue) {
        if (/[;；]/.test(lastValue)) {
          onChange(
            dataTransfer(
              expandNumberRangeList(
                lastValue.split(/[;；]/),
                nodeInfo?.paramType,
              ),
              nodeInfo?.paramType,
            ),
          );
        } else {
          const range = expandNumberRange(lastValue, nodeInfo?.paramType);
          if (range) {
            onChange(dataTransfer(range, nodeInfo?.paramType));
          } else {
            onChange(dataTransfer(lastValue, nodeInfo?.paramType));
          }
        }
      }

      setValue('');
    }
  };

  const onPressEnter = () => {
    handleChange();
  };

  const onBlur = () => {
    setPopupVisible(false);
    // 打开图片选择器时焦点会被弹窗接管，此时不能提交并结束当前编辑
    if (pickerVisibleRef.current) {
      return;
    }
    handleChange();
  };

  const handlePlaceholderClick = () => {
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (autoFocus) {
      handlePlaceholderClick();
    }
  }, []);

  const closeImagePicker = useCallback(() => {
    pickerVisibleRef.current = false;
    setPickerVisible(false);
  }, []);

  const openImagePicker = useCallback(() => {
    setPopupVisible(false);
    pickerVisibleRef.current = true;
    setPickerVisible(true);
    getInputFiles('image')
      .then((res) => {
        setInputImageFiles(res?.data ?? []);
      })
      .catch((e) => {
        console.error('获取 input 图片列表失败:', e);
      });
  }, []);

  const SuffixComp = useMemo(
    () => (
      <Space size="small" style={{ zIndex: 2 }}>
        <ClearComponent
          onClick={() => {
            setValue('');
          }}
        />
        {isImageParam && (
          <span
            className="input-param-value-suffix-browse"
            title={I18n.t('browse_image_library', {}, '浏览图片库')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              openImagePicker();
            }}
          >
            <IconFolder />
          </span>
        )}
        <UploadComponent
          currentParamConfig={currentParamConfig}
          rootDomRef={rootRef}
          popover={popover}
          isUploading={isEditing}
          onUpdateUploadingStatus={setIsEditing}
          onChange={onChange}
          onVisibleChange={(v) => setPopupVisible(!v)}
        />
      </Space>
    ),
    [
      currentParamConfig,
      rootRef,
      popover,
      isEditing,
      setIsEditing,
      setValue,
      onChange,
      isImageParam,
      openImagePicker,
    ],
  );

  // 图片参数改由全屏选择器挑选，下拉只保留手输/自定义值；
  // 视频参数仍需按后缀过滤候选值列表
  const options = useMemo(() => {
    if (nodeInfo?.paramType === ValueTypeEnum.IMAGE) {
      return [];
    }
    return (nodeInfo?.paramOptions || [])
      .filter((v) =>
        nodeInfo?.paramType === ValueTypeEnum.VIDEO
          ? RE_VIDEO_SUFFIX.test(String(v).toLowerCase())
          : true,
      )
      .map((v) => String(v));
  }, [nodeInfo]);

  const currentValueList = useMemo(
    () =>
      (value instanceof Array ? value : value ? [value] : []).map((v) =>
        String(v),
      ),
    [value],
  );

  /** 裸文件名若能唯一匹配到 input 子目录，统一成相对路径 */
  const resolveInputImageFile = useCallback(
    (raw: string) => {
      const plain = getSpecialOutputValue(raw);
      if (inputImageFiles.includes(plain)) {
        return plain;
      }
      if (plain && !plain.includes('/')) {
        const matches = inputImageFiles.filter(
          (path) => (path.split('/').pop() || path) === plain,
        );
        if (matches.length === 1) {
          return matches[0];
        }
      }
      return '';
    },
    [inputImageFiles],
  );

  const pickerSelectedValues = useMemo(
    () =>
      Array.from(
        new Set(
          currentValueList
            .map((item) => resolveInputImageFile(item))
            .filter(Boolean),
        ),
      ),
    [currentValueList, resolveInputImageFile],
  );

  const handleImagePickerConfirm = (picked: string[]) => {
    closeImagePicker();
    if (!picked.length) {
      return;
    }

    const isSpecialOutput = String(nodeInfo?.paramValue)?.endsWith(
      SpecialOutputSuffix,
    );
    const toValue = (file: string) =>
      isSpecialOutput ? buildSpecialOutputValue(file) : file;

    if (enterFrom === 'single-input') {
      const next = toValue(picked[0]);
      setValue(next);
      handleChange(next);
      return;
    }

    // 未在文件库中的值（特殊输出、手输值等）无法在图片选择器里取消，
    // 合并时保留下来；文件库中的值以选择器勾选结果为准
    const keep = currentValueList.filter(
      (item) => !resolveInputImageFile(item),
    );
    handleChange(Array.from(new Set([...keep, ...picked.map(toValue)])));
  };

  /** 弹出时按输入框到屏幕底部的可用空间自适应下拉列表高度 */
  const updateDropdownHeight = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const margin = 16;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const available = Math.max(spaceBelow, spaceAbove);
    setDropdownMaxHeight(`${Math.max(available, 200)}px`);
  };

  /** 选项值列表（与渲染 Option 时的 value 映射保持一致） */
  const optionValueList = useMemo(() => {
    const isSpecialOutput = String(nodeInfo?.paramValue)?.endsWith(
      SpecialOutputSuffix,
    );
    return options.map((option) => {
      const v = String(option || '');
      return {
        value: isSpecialOutput ? buildSpecialOutputValue(v) : v,
        text: v,
      };
    });
  }, [options, nodeInfo?.paramValue]);

  /** 当前搜索词下可见的选项值（与 Arco 默认 filterOption 的匹配行为一致） */
  const visibleOptionValues = useMemo(() => {
    const search = String(inputValue || '').toLowerCase();
    if (!search) {
      return optionValueList.map((o) => o.value);
    }
    return optionValueList
      .filter(
        (o) =>
          o.value.toLowerCase().includes(search) ||
          o.text.toLowerCase().includes(search),
      )
      .map((o) => o.value);
  }, [optionValueList, inputValue]);

  const selectedValueList =
    value instanceof Array ? value : value ? [value] : [];

  /** 可见项是否已全部选中 */
  const allVisibleSelected =
    visibleOptionValues.length > 0 &&
    visibleOptionValues.every((v) => selectedValueList.includes(v));

  /** 全选/取消全选当前可见（搜索结果）的所有项 */
  const handleToggleSelectAll = () => {
    const next = allVisibleSelected
      ? selectedValueList.filter((v) => !visibleOptionValues.includes(v))
      : Array.from(new Set([...selectedValueList, ...visibleOptionValues]));
    setValue(next);
  };

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative' }}
      className="input-param-value-wrapper"
    >
      {matchSelector ? (
        <Select
          className="input-param-value-select"
          ref={inputRef}
          size={size}
          mode={enterFrom === 'batch-input' ? 'multiple' : undefined}
          defaultValue={defaultValue}
          value={value ? (value instanceof Array ? value : [value]) : []}
          onChange={(v) => {
            setValue(v);
            if (enterFrom === 'single-input') {
              handleChange(v);
            }
          }}
          // 多选模式下点击选项后保留搜索词，支持在搜索结果中连续选择
          showSearch={{ retainInputValueWhileSelect: true }}
          onInputValueChange={setInputValue}
          popupVisible={popupVisible}
          allowCreate={{
            formatter: (input_value) => ({
              value: input_value,
              label: input_value,
            }),
          }}
          renderTag={({ label, closable, onClose }, index, valueList) => (
            <CustomTag
              props={{
                label,
                closable,
                onClose,
              }}
              rootRef={rootRef}
              index={index}
              values={valueList}
              internal_name={currentParamConfig.internal_name ?? ''}
              suffixWidth={isImageParam ? 78 : 54}
            />
          )}
          renderFormat={(_, val) => {
            if (enterFrom === 'single-input') {
              return (
                <Typography.Paragraph
                  className="clear-arco-typography-margin-bottom"
                  ellipsis={{
                    rows: 1,
                    showTooltip: true,
                    wrapper: 'div',
                  }}
                >
                  {typeof val === 'string' ? val : String(val)}
                </Typography.Paragraph>
              );
            } else {
              return val as string;
            }
          }}
          getPopupContainer={() =>
            enterFrom === 'batch-input'
              ? rootRef.current || document.body
              : document.body
          }
          dropdownRender={
            enterFrom === 'batch-input'
              ? (menu) => (
                  <div className="input-param-value-select-dropdown">
                    {menu}
                    {visibleOptionValues.length > 0 && (
                      <div className="select-dropdown-footer">
                        <Button
                          type="text"
                          size="mini"
                          // 阻止按钮抢走焦点，避免触发 onBlur 关闭下拉
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={handleToggleSelectAll}
                        >
                          {allVisibleSelected
                            ? I18n.t('unselect_all', {}, '取消全选')
                            : I18n.t('all_choose', {}, '全选')}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              : undefined
          }
          dropdownMenuStyle={{
            // 显示底栏时从列表最大高度中扣除底栏占位，保证弹窗总高不变，
            // 避免 Trigger 自动上移遮挡输入框
            maxHeight:
              enterFrom === 'batch-input' &&
              visibleOptionValues.length > 0 &&
              dropdownMaxHeight
                ? `calc(${dropdownMaxHeight} - 30px)`
                : dropdownMaxHeight,
          }}
          notFoundContent={
            isImageParam ? (
              <div className="image-dropdown-browse-hint">
                {I18n.t(
                  'image_picker_dropdown_hint',
                  {},
                  '点击右侧文件夹图标浏览图片库，或直接输入值后回车',
                )}
              </div>
            ) : undefined
          }
          suffixIcon={SuffixComp}
          onFocus={() => {
            setIsEditing(false);
            updateDropdownHeight();
            setPopupVisible(true);
          }}
          onVisibleChange={(visible) => {
            if (visible) {
              updateDropdownHeight();
            }
          }}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.keyCode === 13 || e.code === 'Enter') {
              if (!inputValue) {
                inputRef.current?.blur();
                e.preventDefault();
              }
            }
          }}
        >
          {options.map((option) => {
            const v = String(option || '');
            return (
              <Select.Option
                key={uuid()}
                value={
                  String(nodeInfo?.paramValue)?.endsWith(SpecialOutputSuffix)
                    ? buildSpecialOutputValue(v)
                    : v
                }
              >
                {option}
              </Select.Option>
            );
          })}
        </Select>
      ) : (
        <Input
          className="input-param-value-input"
          ref={inputRef}
          autoFocus={autoFocus}
          defaultValue={defaultValue}
          size={size}
          placeholder=""
          onPressEnter={onPressEnter}
          value={value as string}
          onBlur={onBlur}
          onFocus={() => setIsEditing(false)}
          onChange={(v) => {
            setValue(v);
          }}
          suffix={SuffixComp}
        />
      )}

      {value?.length === 0 && inputValue?.length === 0 && (
        <div className="custom-placeholder">
          <Typography.Paragraph
            onClick={handlePlaceholderClick}
            className="clear-arco-typography-margin-bottom placeholder-text"
            ellipsis={{
              rows: 1,
              showTooltip: true,
              wrapper: 'div',
            }}
          >
            {placeholder}
          </Typography.Paragraph>
          {nodeInfo?.isSeed && enterFrom === 'batch-input' ? (
            <RandomSeed
              onChange={onChange}
              inputDomRef={inputRef}
              rootDomRef={rootRef}
              config={currentParamConfig}
            />
          ) : null}
        </div>
      )}

      {isImageParam && (
        <ImagePicker
          visible={pickerVisible}
          files={inputImageFiles}
          value={pickerSelectedValues}
          multiple={enterFrom === 'batch-input'}
          onCancel={closeImagePicker}
          onConfirm={handleImagePickerConfirm}
        />
      )}
    </div>
  );
};
