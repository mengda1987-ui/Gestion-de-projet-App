export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  color: string;
  role: 'admin' | 'member';
  password: string;
  lang: 'zh' | 'en';
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  dueDate?: string;
  mmNodeId?: string;
  mmPosition?: { x: number; y: number };
}

export interface Checklist {
  id: string;
  name: string;
  items: ChecklistItem[];
}

export interface Comment {
  id: string;
  userId: string;
  text: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  uploadedAt: string;
}

export type CardStatus = 'todo' | 'in_progress' | 'complete';

// ===== CRM 相关类型 =====

export type CrmType = 'cours' | 'voyages' | 'projets';

export type CrmFieldType = 'text' | 'number' | 'date' | 'select';

export interface CrmField {
  id: string;
  name: string;
  type: CrmFieldType;
  options?: string[]; // type === 'select' 时的选项
}

export interface SavedFilter {
  id: string;
  name: string;
  filter: FilterState;
  createdAt: string;
}

export type CalendarEventType = 'meeting' | 'call' | 'task' | 'reminder';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO 日期时间
  end?: string;
  type: CalendarEventType;
  boardId?: string;
  cardId?: string;
  note?: string;
  createdAt: string;
}

export interface OperationLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  coverImage?: string;
  labels: string[];
  assignees: string[];
  dueDate?: string;
  startDate?: string;
  status: CardStatus;
  archived: boolean;
  checklists: Checklist[];
  comments: Comment[];
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
  order: number;
  mmNodeId?: string;
  mmPosition?: { x: number; y: number };
  visibleTo?: string[]; // Admin: user IDs who can see this card
  customFields?: Record<string, string>; // CRM 自定义字段值（key 为 CrmField.id）
}

export interface Column {
  id: string;
  title: string;
  cards: Card[];
  order: number;
  archived: boolean;
  visibleTo?: string[]; // Admin: user IDs who can see this column
  mmRootId?: string;
  mmPosition?: { x: number; y: number };
}

export interface MindMapNode {
  id: string;
  text: string;
  description?: string;
  parentId: string | null;
  color: string;
  collapsed?: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Board {
  id: string;
  title: string;
  background: string;
  emoji?: string;
  iconBg?: string;
  iconImage?: string;
  columns: Column[];
  labels: Label[];
  mindmap: MindMapNode[];
  createdAt: string;
  updatedAt: string;
  visibleTo?: string[];
  order?: number;
  crmType?: CrmType;
}

export type ViewMode = 'board' | 'table' | 'gantt' | 'mindmap' | 'summary' | 'calendar';

export interface FilterState {
  search: string;
  labels: string[];
  assignees: string[];
  showArchived: boolean;
}
