/**
 * 应用版本号（唯一来源）
 *
 * 直接读取 package.json，升级版本时只需改 package.json 一处，
 * 避免此前 5 个页面各自硬编码 "v2.2.15" 需要手工同步的问题。
 */
import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
