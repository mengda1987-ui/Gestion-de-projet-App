import { Board, Label, ViewMode, FilterState, User, CrmField, SavedFilter, CalendarEvent, OperationLog } from '@/types';

export interface BoardState {
  boards: Board[];
  currentBoardId: string;
  board: Board;
  users: User[];
  currentUser: User | null;
  viewMode: ViewMode;
  filters: FilterState;
  darkMode: boolean;
  onlineUsers: string[];
  workspaceBackground: string;
  loginBackground: string;
  logo: string;
  boardLabels: Label[];
  crmFields: Record<string, CrmField[]>;
  savedFilters: SavedFilter[];
  calendarEvents: CalendarEvent[];
  operationLogs: OperationLog[];
  _loaded?: boolean;
}

// 每个 CRM 对象（Cours/Voyages/Projets）的默认字段定义
export function defaultCrmFields(): Record<string, CrmField[]> {
  const f = (id: string, name: string, type: CrmField['type'], options?: string[]): CrmField =>
    ({ id, name, type, ...(options ? { options } : {}) });

  return {
    cours: [
      f('cours_student', '学生姓名', 'text'),
      f('cours_type', '课程类型', 'select', ['法语', '英语', '中文', '其他']),
      f('cours_start', '开课日期', 'date'),
      f('cours_hours', '课时数', 'number'),
      f('cours_price', '学费 (€)', 'number'),
      f('cours_status', '状态', 'select', ['待报名', '已报名', '进行中', '已完成', '已退课']),
    ],
    voyages: [
      f('voyage_client', '客户姓名', 'text'),
      f('voyage_dest', '目的地', 'text'),
      f('voyage_start', '出发日期', 'date'),
      f('voyage_people', '人数', 'number'),
      f('voyage_budget', '预算 (€)', 'number'),
      f('voyage_status', '状态', 'select', ['询价', '已预订', '已确认', '已完成', '已取消']),
    ],
    projets: [
      f('projet_client', '客户', 'text'),
      f('projet_amount', '项目金额 (€)', 'number'),
      f('projet_start', '开始日期', 'date'),
      f('projet_deadline', '截止日期', 'date'),
      f('projet_owner', '负责人', 'text'),
      f('projet_status', '状态', 'select', ['潜在', '已签约', '进行中', '已完成', '已搁置']),
    ],
  };
}

export function createInitialState(): BoardState {
  return {
    boards: [],
    currentBoardId: '',
    board: {
      id: '',
      title: '',
      background: '#f5f5f7',
      columns: [],
      labels: [],
      mindmap: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    users: [],
    currentUser: null,
    viewMode: 'board',
    filters: {
      search: '',
      labels: [],
      assignees: [],
      showArchived: false,
    },
    darkMode: false,
    onlineUsers: [],
    workspaceBackground: '#f5f5f7',
    loginBackground: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
    logo: '',
    boardLabels: [],
    crmFields: defaultCrmFields(),
    savedFilters: [],
    calendarEvents: [],
    operationLogs: [],
  };
}
