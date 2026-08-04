import { User, Label, Board } from '@/types';

const now = new Date().toISOString();
const tomorrow = new Date(Date.now() + 86400000).toISOString();
const in3Days = new Date(Date.now() + 3 * 86400000).toISOString();
const in1Week = new Date(Date.now() + 7 * 86400000).toISOString();
const yesterday = new Date(Date.now() - 86400000).toISOString();
const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString();
const in2Days = new Date(Date.now() + 2 * 86400000).toISOString();
const in4Days = new Date(Date.now() + 4 * 86400000).toISOString();
const in5Days = new Date(Date.now() + 5 * 86400000).toISOString();

export const MOCK_USERS: User[] = [
  {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    name: 'Da MENG',
    email: 'dameng@example.com',
    avatar: 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=cute%20cartoon%20orange%20fox%20avatar%20kawaii%20style%20big%20eyes%20round%20face%20pastel%20background&image_size=square',
    color: '#3B82F6',
    role: 'admin',
    password: '123456',
    lang: 'zh',
  },
  {
    id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    name: 'Laure Gouhier',
    email: 'laure@example.com',
    avatar: 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=cute%20cartoon%20cat%20avatar%20kawaii%20style%20big%20green%20eyes%20round%20face%20pastel%20background&image_size=square',
    color: '#EC4899',
    role: 'member',
    password: '123456',
    lang: 'en',
  },
  {
    id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
    name: '王磊',
    email: 'wanglei@example.com',
    avatar: 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=cute%20cartoon%20panda%20bear%20avatar%20kawaii%20chibi%20style%20bamboo%20leaf%20big%20round%20eyes%20soft%20green%20background&image_size=square',
    color: '#8B5CF6',
    role: 'member',
    password: '123456',
    lang: 'zh',
  },
];

export const MOCK_LABELS: Label[] = [
  { id: 'label-1', name: '高优先级', color: '#EF4444' },
  { id: 'label-2', name: 'Bug', color: '#F59E0B' },
  { id: 'label-3', name: '新功能', color: '#10B981' },
  { id: 'label-4', name: '设计', color: '#8B5CF6' },
  { id: 'label-5', name: '文档', color: '#3B82F6' },
  { id: 'label-6', name: '紧急', color: '#DC2626' },
  { id: 'label-7', name: '重构', color: '#06B6D4' },
];

export const MOCK_BOARD: Board = {
  id: 'd4e5f6a7-b8c9-0123-defa-234567890123',
  title: '产品开发项目',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  createdAt: lastWeek,
  updatedAt: now,
  labels: MOCK_LABELS,
  columns: [
    {
      id: 'col-1',
      title: '待办事项',
      order: 0,
      archived: false,
      cards: [
        {
          id: 'card-1',
          title: '用户调研与需求分析',
          description: '## 目标\n\n收集用户反馈，分析核心需求。\n\n### 任务清单\n\n- [x] 设计调研问卷\n- [ ] 发送给50位目标用户\n- [ ] 收集并整理结果\n- [ ] 输出调研报告',
          labels: ['label-5', 'label-3'],
          assignees: ['user-1', 'user-2'],
          dueDate: in3Days,
          startDate: yesterday,
          completed: false,
          archived: false,
          checklists: [
            {
              id: 'cl-1',
              name: '调研步骤',
              items: [
                { id: 'cli-1', text: '确定调研目标', completed: true },
                { id: 'cli-2', text: '设计调研问卷', completed: true },
                { id: 'cli-3', text: '发送问卷', completed: false },
                { id: 'cli-4', text: '收集数据', completed: false },
                { id: 'cli-5', text: '撰写报告', completed: false },
              ],
            },
          ],
          comments: [
            {
              id: 'c-1',
              userId: 'user-2',
              text: '问卷草稿已经准备好，请大家review一下。',
              createdAt: yesterday,
            },
          ],
          attachments: [],
          createdAt: lastWeek,
          updatedAt: yesterday,
          order: 0,
        },
        {
          id: 'card-2',
          title: '修复登录页面样式问题',
          description: '在移动端登录按钮被遮挡，需要修复响应式布局。',
          labels: ['label-2', 'label-6'],
          assignees: ['user-1'],
          dueDate: tomorrow,
          startDate: now,
          completed: false,
          archived: false,
          checklists: [
            {
              id: 'cl-2',
              name: '修复步骤',
              items: [
                { id: 'cli-6', text: '复现问题', completed: true },
                { id: 'cli-7', text: '定位原因', completed: true },
                { id: 'cli-8', text: '修复代码', completed: false },
                { id: 'cli-9', text: '多设备测试', completed: false },
              ],
            },
          ],
          comments: [
            {
              id: 'c-2',
              userId: 'user-1',
              text: '已经定位到是flex布局在小屏幕的问题。',
              createdAt: yesterday,
            },
            {
              id: 'c-3',
              userId: 'user-3',
              text: '建议用min-h-screen替代h-screen，可能解决部分问题。',
              createdAt: now,
            },
          ],
          attachments: [
            {
              id: 'att-1',
              name: 'screenshot-iphone.png',
              url: '#',
              type: 'image/png',
              size: 245000,
              uploadedAt: yesterday,
            },
          ],
          createdAt: yesterday,
          updatedAt: now,
          order: 1,
        },
        {
          id: 'card-3',
          title: '编写API接口文档',
          description: '使用Swagger/OpenAPI规范编写后端接口文档。',
          labels: ['label-5'],
          assignees: ['user-2'],
          dueDate: in1Week,
          startDate: in2Days,
          completed: false,
          archived: false,
          checklists: [],
          comments: [],
          attachments: [],
          createdAt: lastWeek,
          updatedAt: lastWeek,
          order: 2,
        },
      ],
    },
    {
      id: 'col-2',
      title: '进行中',
      order: 1,
      archived: false,
      cards: [
        {
          id: 'card-4',
          title: '设计新版首页UI',
          description: '## 设计要求\n\n- 现代化简洁风格\n- 支持深色模式\n- 响应式布局\n- 加入动效设计',
          labels: ['label-4', 'label-3'],
          assignees: ['user-3'],
          dueDate: in3Days,
          startDate: yesterday,
          completed: false,
          archived: false,
          checklists: [
            {
              id: 'cl-3',
              name: '设计阶段',
              items: [
                { id: 'cli-10', text: '线框图设计', completed: true },
                { id: 'cli-11', text: '高保真设计稿', completed: true },
                { id: 'cli-12', text: '交互动效设计', completed: false },
                { id: 'cli-13', text: '设计评审', completed: false },
                { id: 'cli-14', text: '切图与标注', completed: false },
              ],
            },
          ],
          comments: [
            {
              id: 'c-4',
              userId: 'user-3',
              text: '线框图和初稿已经上传到Figma，请查阅。',
              createdAt: yesterday,
            },
          ],
          attachments: [
            {
              id: 'att-2',
              name: 'homepage-v1.fig',
              url: '#',
              type: 'application/figma',
              size: 12450000,
              uploadedAt: yesterday,
            },
          ],
          createdAt: lastWeek,
          updatedAt: yesterday,
          order: 0,
        },
        {
          id: 'card-5',
          title: '数据库性能优化',
          description: '优化慢查询，添加必要的索引，提升查询性能50%以上。',
          labels: ['label-7', 'label-1'],
          assignees: ['user-1', 'user-2'],
          dueDate: in5Days,
          startDate: now,
          completed: false,
          archived: false,
          checklists: [
            {
              id: 'cl-4',
              name: '优化步骤',
              items: [
                { id: 'cli-15', text: '分析慢查询日志', completed: true },
                { id: 'cli-16', text: '添加索引', completed: true },
                { id: 'cli-17', text: '优化SQL语句', completed: false },
                { id: 'cli-18', text: '压力测试验证', completed: false },
              ],
            },
          ],
          comments: [],
          attachments: [],
          createdAt: yesterday,
          updatedAt: now,
          order: 1,
        },
      ],
    },
    {
      id: 'col-3',
      title: '审核中',
      order: 2,
      archived: false,
      cards: [
        {
          id: 'card-6',
          title: '支付模块集成',
          description: '集成Stripe支付网关，支持信用卡和微信支付。',
          labels: ['label-3', 'label-1'],
          assignees: ['user-1'],
          dueDate: in4Days,
          startDate: lastWeek,
          completed: false,
          archived: false,
          checklists: [
            {
              id: 'cl-5',
              name: '支付功能',
              items: [
                { id: 'cli-19', text: 'Stripe账号配置', completed: true },
                { id: 'cli-20', text: '信用卡支付', completed: true },
                { id: 'cli-21', text: '微信支付', completed: true },
                { id: 'cli-22', text: '退款功能', completed: true },
                { id: 'cli-23', text: 'Webhook处理', completed: true },
                { id: 'cli-24', text: '安全审计', completed: false },
              ],
            },
          ],
          comments: [
            {
              id: 'c-5',
              userId: 'user-2',
              text: '功能都已完成，请安全组的同事帮忙做一下审计。',
              createdAt: yesterday,
            },
          ],
          attachments: [],
          createdAt: lastWeek,
          updatedAt: yesterday,
          order: 0,
        },
      ],
    },
    {
      id: 'col-4',
      title: '已完成',
      order: 3,
      archived: false,
      cards: [
        {
          id: 'card-7',
          title: '项目初始化与环境搭建',
          description: '搭建Next.js + TypeScript + Tailwind CSS 开发环境，配置CI/CD流程。',
          labels: ['label-3'],
          assignees: ['user-1', 'user-2', 'user-3'],
          dueDate: lastWeek,
          startDate: new Date(Date.now() - 14 * 86400000).toISOString(),
          completed: true,
          archived: false,
          checklists: [
            {
              id: 'cl-6',
              name: '环境搭建',
              items: [
                { id: 'cli-25', text: '项目初始化', completed: true },
                { id: 'cli-26', text: 'ESLint & Prettier配置', completed: true },
                { id: 'cli-27', text: 'Husky + Commitlint', completed: true },
                { id: 'cli-28', text: 'GitHub Actions CI/CD', completed: true },
              ],
            },
          ],
          comments: [
            {
              id: 'c-6',
              userId: 'user-1',
              text: '环境已经全部搭建完毕，大家可以开始开发了！',
              createdAt: lastWeek,
            },
          ],
          attachments: [],
          createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
          updatedAt: lastWeek,
          order: 0,
        },
        {
          id: 'card-8',
          title: '品牌Logo设计',
          description: '设计公司品牌Logo和VI系统基础元素。',
          labels: ['label-4'],
          assignees: ['user-3'],
          dueDate: new Date(Date.now() - 3 * 86400000).toISOString(),
          startDate: new Date(Date.now() - 10 * 86400000).toISOString(),
          completed: true,
          archived: false,
          checklists: [],
          comments: [
            {
              id: 'c-7',
              userId: 'user-2',
              text: 'Logo非常棒，已经确定使用第3版方案！',
              createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
            },
          ],
          attachments: [
            {
              id: 'att-3',
              name: 'brand-logo-pack.zip',
              url: '#',
              type: 'application/zip',
              size: 8560000,
              uploadedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
            },
          ],
          createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
          updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
          order: 1,
        },
      ],
    },
  ],
  mindmap: [],
};

export const MOCK_BOARDS: Board[] = [MOCK_BOARD];
