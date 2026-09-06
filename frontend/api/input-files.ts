// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
import requestClient, { apiPrefix } from './request-instance';

export interface InputFilesResponse {
  code: number;
  message: string;
  data: string[];
}

/**
 * @description 获取 ComfyUI input 目录（含子目录）下的媒体文件相对路径列表
 * @param type 内容类型
 */
export async function getInputFiles(type: 'image' | 'video' | 'audio') {
  const res = await requestClient.get<InputFilesResponse>(
    `${apiPrefix}/input-files`,
    { params: { type } },
  );
  return res.data;
}
