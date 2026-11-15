// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import type { ReactNode } from 'react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { Button, Input, Modal } from '@arco-design/web-react';
import { IconCheck, IconSearch } from '@arco-design/web-react/icon';

import './index.scss';
import { I18n } from '@common/i18n';
import { getImageUrlV2 } from '@common/utils/image';

interface FolderNode {
  name: string;
  path: string;
  depth: number;
  count: number;
  children: FolderNode[];
}

const dirOf = (file: string) => {
  const slash = file.lastIndexOf('/');
  return slash < 0 ? '' : file.slice(0, slash);
};

const nameOf = (file: string) => {
  const slash = file.lastIndexOf('/');
  return slash < 0 ? file : file.slice(slash + 1);
};

const ancestorsOf = (dir: string) => {
  const result = [''];
  let current = dir;
  while (current) {
    result.push(current);
    current = dirOf(current);
  }
  return result;
};

const buildTree = (files: string[]) => {
  const root: FolderNode = {
    name: '',
    path: '',
    depth: 0,
    count: 0,
    children: [],
  };
  const nodeMap = new Map<string, FolderNode>([['', root]]);

  const ensureNode = (path: string): FolderNode => {
    const existed = nodeMap.get(path);
    if (existed) {
      return existed;
    }
    const slash = path.lastIndexOf('/');
    const parent = ensureNode(slash < 0 ? '' : path.slice(0, slash));
    const node: FolderNode = {
      name: path.slice(slash + 1),
      path,
      depth: parent.depth + 1,
      count: 0,
      children: [],
    };
    parent.children.push(node);
    nodeMap.set(path, node);
    return node;
  };

  files.forEach((file) => {
    ensureNode(dirOf(file)).count += 1;
  });

  const sumCount = (node: FolderNode): number => {
    node.count += node.children.reduce(
      (total, child) => total + sumCount(child),
      0,
    );
    return node.count;
  };
  sumCount(root);

  return root;
};

/**
 * Shift 连选：把「锚点 → 目标」区间（含两端）叠加到基础选中集合上。
 * 区间按当前可见文件列表的顺序计算，和用户看到的网格顺序一致。
 * 锚点或目标不在当前可见列表（换了目录 / 搜索）时返回 null，
 * 由调用方退化为普通点击。
 */
export const getShiftSelection = (
  visibleFiles: string[],
  baseSelected: string[],
  anchor: string | null,
  target: string,
): string[] | null => {
  const from = anchor ? visibleFiles.indexOf(anchor) : -1;
  const to = visibleFiles.indexOf(target);
  if (from < 0 || to < 0) {
    return null;
  }
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const range = new Set(visibleFiles.slice(start, end + 1));
  const base = new Set(baseSelected);
  const visibleSet = new Set(visibleFiles);
  // 其它目录 / 搜索前已选的项保留，当前可见项按网格顺序排，
  // 保证导入的参数值顺序和屏幕上看到的顺序一致
  const outside = baseSelected.filter((file) => !visibleSet.has(file));
  const inside = visibleFiles.filter(
    (file) => range.has(file) || base.has(file),
  );
  return Array.from(new Set([...outside, ...inside]));
};

export const ImagePicker: React.FC<{
  visible: boolean;
  files: string[];
  value: string[];
  multiple: boolean;
  onCancel: () => void;
  onConfirm: (selected: string[]) => void;
}> = ({ visible, files, value, multiple, onCancel, onConfirm }) => {
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const wasVisible = useRef(false);
  /** 上一次「普通点击」的文件，作为 Shift 连选的起点 */
  const anchorRef = useRef<string | null>(null);
  /** 本轮 Shift 连选开始前的选中集合：反复调整末端时不会残留上一次的区间 */
  const baseSelectedRef = useRef<string[]>([]);

  useEffect(() => {
    if (visible === wasVisible.current) {
      return;
    }
    wasVisible.current = visible;
    if (!visible) {
      return;
    }
    const fileSet = new Set(files);
    const picked = Array.from(new Set(value.filter((v) => fileSet.has(v))));
    const first = picked[0] || files[0] || '';
    setSelected(picked);
    baseSelectedRef.current = picked;
    anchorRef.current = null;
    setQuery('');
    setActive(first);
    // 默认停在根目录（全部文件），不再跳到第一张图片所在的子目录
    setFolder('');
    setExpanded(new Set(['']));
  }, [visible, files, value]);

  const tree = useMemo(() => buildTree(files), [files]);

  const visibleFiles = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (keyword) {
      return files.filter((file) => file.toLowerCase().includes(keyword));
    }
    // 根目录与其它目录行为一致：只列出当前目录下的直属文件，
    // 子文件夹的内容通过目录树 / 面包屑进入；空目录显示「这里没有图片」
    return files.filter((file) => dirOf(file) === folder);
  }, [files, query, folder]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visibleSet = useMemo(() => new Set(visibleFiles), [visibleFiles]);
  const visibleAllSelected =
    visibleFiles.length > 0 &&
    visibleFiles.every((file) => selectedSet.has(file));

  useEffect(() => {
    if (!visible) {
      return;
    }
    if (!visibleFiles.includes(active)) {
      setActive(visibleFiles[0] || '');
    }
  }, [visible, visibleFiles, active]);

  const toggleSelected = (file: string, shiftKey = false) => {
    setActive(file);
    if (!multiple) {
      setSelected([file]);
      anchorRef.current = file;
      return;
    }
    if (shiftKey) {
      const range = getShiftSelection(
        visibleFiles,
        baseSelectedRef.current,
        anchorRef.current,
        file,
      );
      if (range) {
        setSelected(range);
        return;
      }
    }
    // 普通点击：切换选中，并把它作为下一次 Shift 连选的锚点
    const next = selected.includes(file)
      ? selected.filter((item) => item !== file)
      : [...selected, file];
    setSelected(next);
    baseSelectedRef.current = next;
    anchorRef.current = file;
  };

  /** 全选/取消全选当前可见（含搜索结果）的图片 */
  const toggleSelectAll = () => {
    const next = visibleAllSelected
      ? selected.filter((item) => !visibleSet.has(item))
      : Array.from(new Set([...selected, ...visibleFiles]));
    setSelected(next);
    baseSelectedRef.current = next;
    anchorRef.current = null;
  };

  const clearSelection = () => {
    setSelected([]);
    baseSelectedRef.current = [];
    anchorRef.current = null;
  };

  const confirm = () => {
    if (selected.length) {
      onConfirm(selected);
    }
  };

  const goFolder = (path: string) => {
    setQuery('');
    setFolder(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      ancestorsOf(path).forEach((item) => next.add(item));
      return next;
    });
  };

  const toggleExpanded = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderFolder = (node: FolderNode): ReactNode => {
    const hasChildren = node.children.length > 0;
    const open = expanded.has(node.path);
    return (
      <div key={node.path || '__root'}>
        <button
          type="button"
          className={`image-picker-folder${folder === node.path ? ' is-active' : ''}`}
          style={{ paddingLeft: 6 + node.depth * 12 }}
          onClick={() => goFolder(node.path)}
        >
          <span
            className="image-picker-caret"
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) {
                toggleExpanded(node.path);
              }
            }}
          >
            {hasChildren ? (open ? '▾' : '▸') : ''}
          </span>
          <span className="image-picker-folder-name">
            {node.path
              ? node.name
              : I18n.t('image_picker_root', {}, '全部（根目录）')}
          </span>
          <span className="image-picker-folder-count">{node.count}</span>
        </button>
        {open && node.children.map(renderFolder)}
      </div>
    );
  };

  const crumbs = useMemo(() => {
    const items = [
      {
        label: I18n.t('image_picker_root', {}, '全部（根目录）'),
        path: '',
      },
    ];
    let acc = '';
    (folder ? folder.split('/') : []).forEach((part) => {
      acc = acc ? `${acc}/${part}` : part;
      items.push({ label: part, path: acc });
    });
    return items;
  }, [folder]);

  return (
    <Modal
      className="image-picker-modal"
      wrapClassName="image-picker-modal-wrap"
      visible={visible}
      footer={null}
      unmountOnExit
      title={I18n.t('image_picker_title', {}, '浏览图片')}
      onCancel={onCancel}
      // 按视口尺寸铺开，不再用固定像素宽高限制：大屏下弹窗也只占中间一小块
      // 的话，文件树 / 缩略图网格 / 大图预览都得不到利用
      style={{ width: '90vw', top: '5vh' }}
      // 参数配置弹窗的层级是 9999，选择器必须盖在它上面
      wrapStyle={{ zIndex: 10000 }}
    >
      <div className="image-picker">
        <div className="image-picker-toolbar">
          <Input
            allowClear
            className="image-picker-search"
            prefix={<IconSearch />}
            placeholder={I18n.t(
              'image_picker_search_placeholder',
              {},
              '搜索文件名或路径…',
            )}
            value={query}
            onChange={setQuery}
            onPressEnter={confirm}
          />
          {multiple && (
            <span className="image-picker-hint">
              {I18n.t(
                'image_picker_shift_select_tip',
                {},
                '点击一张图后按住 Shift 点击另一张，可连选中间全部',
              )}
            </span>
          )}
        </div>
        <div className="image-picker-body">
          <div className="image-picker-tree">{renderFolder(tree)}</div>
          <div className="image-picker-main">
            <div className="image-picker-crumbs">
              {crumbs.map((crumb, index) => (
                <Fragment key={crumb.path || '__root'}>
                  {index > 0 && (
                    <span className="image-picker-crumb-sep">/</span>
                  )}
                  <button
                    type="button"
                    className="image-picker-crumb"
                    onClick={() => goFolder(crumb.path)}
                  >
                    {crumb.label}
                  </button>
                </Fragment>
              ))}
            </div>
            <div className="image-picker-grid">
              {visibleFiles.length === 0 ? (
                <div className="image-picker-empty">
                  {query
                    ? I18n.t('image_picker_no_match', {}, '没有匹配的图片')
                    : I18n.t('image_picker_no_images', {}, '这里没有图片')}
                </div>
              ) : (
                visibleFiles.map((file) => {
                  const isSelected = selectedSet.has(file);
                  return (
                    <div
                      key={file}
                      className={`image-picker-card${isSelected ? ' is-selected' : ''}`}
                    >
                      {/* 上半部分：切换选中 / Shift 连选；双击在单选模式下直接采用 */}
                      <button
                        type="button"
                        className="image-picker-card-select"
                        title={`${file} — ${I18n.t('image_picker_select_hint', {}, '点击选中')}${multiple ? ` · ${I18n.t('image_picker_shift_hint', {}, 'Shift 点击连选')}` : ''}`}
                        aria-label={I18n.t(
                          'image_picker_select_hint',
                          {},
                          '点击选中',
                        )}
                        onClick={(e) => toggleSelected(file, e.shiftKey)}
                        onDoubleClick={() => {
                          if (!multiple) {
                            onConfirm([file]);
                          }
                        }}
                      >
                        <img
                          className="image-picker-thumb"
                          src={getImageUrlV2(file, 'input')}
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.visibility = 'hidden';
                          }}
                        />
                        {isSelected && (
                          <span className="image-picker-check">
                            <IconCheck />
                          </span>
                        )}
                      </button>
                      {/* 下半部分：只更新右侧大图预览，不改变选中状态 */}
                      <button
                        type="button"
                        className="image-picker-card-view"
                        title={`${file} — ${I18n.t('image_picker_view_hint', {}, '点击查看大图，不选中')}`}
                        aria-label={I18n.t(
                          'image_picker_view_hint',
                          {},
                          '点击查看大图，不选中',
                        )}
                        onClick={() => setActive(file)}
                      >
                        <span className="image-picker-name">
                          {query ? file : nameOf(file)}
                        </span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="image-picker-footer">
              <span className="image-picker-selected">
                {I18n.t(
                  'image_picker_selected_count',
                  { n: selected.length },
                  `已选 ${selected.length} 张`,
                )}
              </span>
              {multiple && (
                <Button
                  size="mini"
                  disabled={!visibleFiles.length}
                  onClick={toggleSelectAll}
                >
                  {visibleAllSelected
                    ? I18n.t('unselect_all', {}, '取消全选')
                    : I18n.t('all_choose', {}, '全选')}
                </Button>
              )}
              {selected.length > 0 && (
                <Button type="text" size="mini" onClick={clearSelection}>
                  {I18n.t('clear_all', {}, '清空')}
                </Button>
              )}
              <Button size="small" onClick={onCancel}>
                {I18n.t('cancel', {}, '取消')}
              </Button>
              <Button
                size="small"
                type="primary"
                disabled={!selected.length}
                onClick={confirm}
              >
                {multiple
                  ? I18n.t(
                      'image_picker_use_selected',
                      { n: selected.length },
                      `使用所选（${selected.length}）`,
                    )
                  : I18n.t('image_picker_use_one', {}, '使用该图片')}
              </Button>
            </div>
          </div>
          <div className="image-picker-preview">
            <div className="image-picker-preview-box">
              {active ? (
                <img
                  src={getImageUrlV2(active, 'input')}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.visibility = 'hidden';
                  }}
                />
              ) : (
                <span className="image-picker-preview-hint">
                  {I18n.t(
                    'image_picker_preview_hint',
                    {},
                    '选择图片后在这里预览',
                  )}
                </span>
              )}
            </div>
            {active && (
              <span className="image-picker-preview-path" title={active}>
                {active}
              </span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
