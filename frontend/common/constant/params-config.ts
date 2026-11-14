export const SpecialOutputSuffix = ' [output]';

/**
 * 参数选择 / 参数值选择下拉的最大高度基准。
 * 以视口高度百分比为准，随屏幕高度线性变化，由浏览器重排，无需 JS 监听 resize。
 * - 理想值 70vh
 * - 上限 calc(100vh - 260px)：预留参数配置弹窗头部与输入控件占位，
 *   避免 position: bl 的下拉越过屏幕底部触发自动翻转
 * - 下限 200px：小窗口下仍能操作
 */
export const DROPDOWN_MAX_HEIGHT = 'clamp(200px, 70vh, calc(100vh - 260px))';
