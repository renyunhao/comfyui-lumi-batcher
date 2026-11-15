// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * @description 基于setInterval实现，提供全局轮询管理实例
 */
class PollingManager {
  timerMap = new Map<string, NodeJS.Timer>();
  cbProcessMap = new Map<string, boolean>();

  /**
   * @param cb 回调函数
   * @param duration 持续时长，单位ms
   * @param key 轮询池唯一标识当前轮询
   */
  // eslint-disable-next-line @typescript-eslint/ban-types
  startPolling(cb: Function, duration: number, key: string) {
    this.clearPolling(key);
    const timer = setInterval(async () => {
      if (this.cbProcessMap.get(key)) {
        return;
      }
      this.cbProcessMap.set(key, true);
      try {
        await cb();
      } finally {
        // 回调抛错时也要释放，否则该 key 的轮询会永久空转
        this.cbProcessMap.set(key, false);
      }
    }, duration);
    this.timerMap.set(key, timer);
  }

  /**
   * @param key 要清除的轮询
   */
  clearPolling(key: string) {
    const timer = this.timerMap.get(key);
    if (timer) {
      // @ts-ignore
      clearInterval(timer);
    }
    this.timerMap.delete(key);
    // 定时器重建时上一次回调可能还没结束，残留的 true 会让新轮询永远空转
    this.cbProcessMap.delete(key);
  }

  clearAll() {
    this.timerMap.forEach((value, key) => {
      if (value) {
        // @ts-ignore
        clearInterval(value);
      }
      this.cbProcessMap.delete(key);
    });
    this.timerMap.clear();
  }
}

const pollingManager = new PollingManager();

export default pollingManager;
