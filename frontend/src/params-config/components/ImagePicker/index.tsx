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
    const dir = first ? dirOf(first) : '';
    setSelected(picked);
    setQuery('');
    setActive(first);
    setFolder(dir);
    setExpanded((prev) => {
      const next = new Set(prev);
      ancestorsOf(dir).forEach((path) => next.add(path));
      return next;
    });
  }, [visible, files, value]);

  const tree = useMemo(() => buildTree(files), [files]);

  const visibleFiles = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (keyword) {
      return files.filter((file) => file.toLowerCase().includes(keyword));
    }
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

  const toggleSelected = (file: string) => {
    setActive(file);
    setSelected((prev) => {
      if (!multiple) {
        return [file];
      }
      return prev.includes(file)
        ? prev.filter((item) => item !== file)
        : [...prev, file];
    });
  };

  /** 全选/取消全选当前可见（含搜索结果）的图片 */
  const toggleSelectAll = () => {
    setSelected((prev) =>
      visibleAllSelected
        ? prev.filter((item) => !visibleSet.has(item))
        : Array.from(new Set([...prev, ...visibleFiles])),
    );
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
              : I18n.t('image_picker_root', {}, '全部（input）')}
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
        label: I18n.t('image_picker_root', {}, '全部（input）'),
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
      style={{ width: 'min(1120px, 94vw)', top: 36 }}
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
                    <button
                      key={file}
                      type="button"
                      className={`image-picker-card${isSelected ? ' is-selected' : ''}`}
                      title={file}
                      onClick={() => toggleSelected(file)}
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
                      <span className="image-picker-name">
                        {query ? file : nameOf(file)}
                      </span>
                    </button>
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
                <Button type="text" size="mini" onClick={() => setSelected([])}>
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
