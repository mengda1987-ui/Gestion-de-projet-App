import { BoardState } from '../types';
import { Action } from '../actions';
import { SavedFilter } from '@/types';
import { generateId } from '@/lib/utils';

export function crmReducer(state: BoardState, action: Action): BoardState {
  switch (action.type) {
    case 'ADD_CRM_FIELD': {
      const { crmType, field } = action.payload;
      const list = state.crmFields[crmType] || [];
      return {
        ...state,
        crmFields: { ...state.crmFields, [crmType]: [...list, field] },
      };
    }

    case 'UPDATE_CRM_FIELD': {
      const { crmType, fieldId, updates } = action.payload;
      const list = state.crmFields[crmType] || [];
      return {
        ...state,
        crmFields: {
          ...state.crmFields,
          [crmType]: list.map(f => (f.id === fieldId ? { ...f, ...updates } : f)),
        },
      };
    }

    case 'DELETE_CRM_FIELD': {
      const { crmType, fieldId } = action.payload;
      const list = state.crmFields[crmType] || [];
      return {
        ...state,
        crmFields: {
          ...state.crmFields,
          [crmType]: list.filter(f => f.id !== fieldId),
        },
      };
    }

    case 'SAVE_FILTER': {
      const { name, filter } = action.payload;
      const saved: SavedFilter = {
        id: generateId(),
        name,
        filter,
        createdAt: new Date().toISOString(),
      };
      return { ...state, savedFilters: [...state.savedFilters, saved] };
    }

    case 'DELETE_SAVED_FILTER': {
      return {
        ...state,
        savedFilters: state.savedFilters.filter(f => f.id !== action.payload.id),
      };
    }

    case 'ADD_CALENDAR_EVENT': {
      return {
        ...state,
        calendarEvents: [...state.calendarEvents, action.payload.event],
      };
    }

    case 'UPDATE_CALENDAR_EVENT': {
      const { eventId, updates } = action.payload;
      return {
        ...state,
        calendarEvents: state.calendarEvents.map(e =>
          e.id === eventId ? { ...e, ...updates } : e
        ),
      };
    }

    case 'DELETE_CALENDAR_EVENT': {
      return {
        ...state,
        calendarEvents: state.calendarEvents.filter(e => e.id !== action.payload.eventId),
      };
    }

    case 'ADD_OPERATION_LOG': {
      // 最多保留 500 条，避免无限增长
      const logs = [action.payload.log, ...state.operationLogs].slice(0, 500);
      return { ...state, operationLogs: logs };
    }

    default:
      return state;
  }
}
