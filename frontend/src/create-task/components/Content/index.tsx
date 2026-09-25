// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import { Button, Popconfirm, Space } from '@arco-design/web-react';
import { IconDelete } from '@arco-design/web-react/icon';
import { useShallow } from 'zustand/react/shallow';

import { openParamsConfigModal } from '../../../params-config';
import { useCreatorStore } from '../../store';
import { ParamsList } from '../ParamsList';

import './index.scss';
import { languageUtils, TranslateKeys } from '@common/language';
import { I18n } from '@common/i18n';

export const CreatorContent = () => {
  const [addParamsConfig, paramsConfig] = useCreatorStore(
    useShallow((s) => [s.addParamsConfig, s.paramsConfig]),
  );
  const addParams = () => {
    addParamsConfig();
    openParamsConfigModal();
  };

  const handleClearAll = () => {
    useCreatorStore.setState({
      paramsConfig: [],
    });
  };

  return (
    <div className="sdk-creator-content">
      <section className="sdk-creator-content-title">
        <p className="sdk-creator-content-title-text">
          {languageUtils.getText(TranslateKeys.PARAM_LIST)}
        </p>
        <Space>
          {paramsConfig.length > 0 && (
            <Popconfirm
              title={I18n.t(
                'are_you_sure_to_clear_all_parameters',
                {},
                '确认清除所有参数吗？',
              )}
              onOk={handleClearAll}
            >
              <Button
                type="outline"
                status="danger"
                size="small"
                icon={<IconDelete />}
              >
                {I18n.t('clear_all', {}, '清空')}
              </Button>
            </Popconfirm>
          )}
          <Button
            type="primary"
            status="default"
            onClick={addParams}
            size="small"
          >
            {I18n.t('custom_parameters', {}, '自定义参数')}
          </Button>
        </Space>
      </section>
      <ParamsList />
    </div>
  );
};
