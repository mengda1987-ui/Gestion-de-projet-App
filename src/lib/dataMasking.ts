/**
 * 数据脱敏工具 — 保护隐私信息不被 API 中转站获取
 * 所有敏感数据在发送给第三方 API 之前都会被替换为占位符
 */

// ── 脱敏规则 ────────────────────────────────────────

interface MaskRule {
  name: string;
  pattern: RegExp;
  replacement: (match: string, ...groups: string[]) => string;
}

const MASK_RULES: MaskRule[] = [
  // 邮箱地址
  {
    name: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: () => '[邮箱已隐藏]',
  },
  // 手机号 (中国)
  {
    name: 'phone_cn',
    pattern: /(?<!\d)(1[3-9]\d{9})(?!\d)/g,
    replacement: (m) => m.slice(0, 3) + '****' + m.slice(7),
  },
  // 手机号 (法国)
  {
    name: 'phone_fr',
    pattern: /(?<!\d)(0[1-9]\d{8})(?!\d)/g,
    replacement: (m) => m.slice(0, 2) + '****' + m.slice(6),
  },
  // 国际电话
  {
    name: 'phone_intl',
    pattern: /(?<!\d)(\+?\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4})(?!\d)/g,
    replacement: () => '[电话已隐藏]',
  },
  // 银行卡号 (16-19 位连续数字)
  {
    name: 'bank_card',
    pattern: /(?<!\d)(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?:\d{3})?)(?!\d)/g,
    replacement: () => '[银行卡已隐藏]',
  },
  // IBAN (常见格式)
  {
    name: 'iban',
    pattern: /\b[A-Z]{2}\d{2}[\s]?[A-Z0-9]{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?(\d{4})?\b/g,
    replacement: () => '[IBAN已隐藏]',
  },
  // 欧元金额
  {
    name: 'amount_eur',
    pattern: /(?:€|EUR|euro)\s*\d{1,3}(?:[,\s]?\d{3})*(?:\.\d{2})?\s*(?:€|EUR|euro)?/gi,
    replacement: () => '[金额已隐藏]',
  },
  // 人民币金额
  {
    name: 'amount_cny',
    pattern: /(?:¥|CNY|元|人民币)\s*\d{1,3}(?:[,\s]?\d{3})*(?:\.\d{2})?\s*(?:¥|CNY|元|万|亿)?/g,
    replacement: () => '[金额已隐藏]',
  },
  // 美元金额
  {
    name: 'amount_usd',
    pattern: /(?:\$|USD|dollar)\s*\d{1,3}(?:[,\s]?\d{3})*(?:\.\d{2})?\s*(?:\$|USD)?/gi,
    replacement: () => '[金额已隐藏]',
  },
  // 百分比形式的利润率/财务指标
  {
    name: 'percent_finance',
    pattern: /(?:利润率|毛利率|净利率|ROI|回报率|收益率|成本率|税率|手续费率?)\s*[:：]?\s*\d+(?:\.\d+)?%/g,
    replacement: () => '[财务指标已隐藏]',
  },
  // 明确的"金额""资金""预算""收入""支出"后跟数字
  {
    name: 'amount_keyword',
    pattern: /(?:金额|资金|预算|收入|支出|利润|亏损|营业额|成本|费用|薪资|工资|奖金)[:：\s]*\d{1,3}(?:[,\s]?\d{3})*(?:\.\d{2})?/g,
    replacement: (m) => m.replace(/\d{1,3}(?:[,\s]?\d{3})*(?:\.\d{2})?/g, '[数字已隐藏]'),
  },
  // 身份证号 (中国)
  {
    name: 'id_cn',
    pattern: /(?<!\d)(\d{6})(\d{4})(\d{4})(\d{3}[0-9Xx])(?!\d)/g,
    replacement: (_m, p1: string, _p2: string, _p3: string, p4: string) => p1 + '********' + p4,
  },
  // SIRET (法国企业号)
  {
    name: 'siret',
    pattern: /\b\d{3}\s?\d{3}\s?\d{3}\s?\d{5}\b/g,
    replacement: () => '[企业号已隐藏]',
  },
  // 网站 URL（可能泄露项目名）
  {
    name: 'url',
    pattern: /https?:\/\/[^\s<>"']{5,}/g,
    replacement: () => '[链接已隐藏]',
  },
  // IP 地址
  {
    name: 'ip',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: (m) => m.split('.').slice(0, 2).join('.') + '.*.*',
  },
];

/**
 * 对文本进行脱敏处理
 * @param text 原始文本
 * @returns 脱敏后的文本
 */
export function maskSensitiveData(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let result = text;
  for (const rule of MASK_RULES) {
    try {
      result = result.replace(rule.pattern, rule.replacement as any);
    } catch {
      // 单条规则失败不影响其他规则
    }
  }
  return result;
}

/**
 * 对对象进行递归脱敏（深拷贝后处理所有字符串字段）
 * @param obj 原始对象
 * @returns 脱敏后的新对象
 */
export function deepMaskSensitiveData<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return maskSensitiveData(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepMaskSensitiveData(item)) as T;
  }

  if (typeof obj === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as object)) {
      try {
        masked[key] = deepMaskSensitiveData(value);
      } catch {
        masked[key] = value;
      }
    }
    return masked as T;
  }

  return obj;
}
