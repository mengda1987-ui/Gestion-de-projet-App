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

export interface Card {
  id: string;
  title: string;
  description: string;
  coverImage?: string;
  labels: string[];
  assignees: string[];
  dueDate?: string;
  startDate?: string;
  completed: boolean;
  archived: boolean;
  checklists: Checklist[];
  comments: Comment[];
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
  order: number;
  mmNodeId?: string;
  mmPosition?: { x: number; y: number };
}

export interface Column {
  id: string;
  title: string;
  cards: Card[];
  order: number;
  archived: boolean;
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
  columns: Column[];
  labels: Label[];
  mindmap: MindMapNode[];
  createdAt: string;
  updatedAt: string;
}

export type ViewMode = 'board' | 'table' | 'gantt' | 'mindmap';

export interface FilterState {
  search: string;
  labels: string[];
  assignees: string[];
  showArchived: boolean;
}
