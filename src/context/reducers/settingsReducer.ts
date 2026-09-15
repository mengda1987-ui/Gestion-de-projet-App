import { BoardState } from '../types';
import { Action } from '../actions';

export function settingsReducer(state: BoardState, action: Action): BoardState {
  switch (action.type) {
    case 'SET_CURRENT_USER':
      return { ...state, currentUser: action.payload, appSection: action.payload ? state.appSection : 'portal' };

    case 'SET_APP_SECTION':
      return { ...state, appSection: action.payload };

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload };

    case 'SET_FILTERS':
      return { ...state, filters: { ...state.filters, ...action.payload } };

    case 'TOGGLE_DARK_MODE':
      return { ...state, darkMode: !state.darkMode };

    case 'SET_DARK_MODE':
      return { ...state, darkMode: action.payload };

    case 'UPDATE_WORKSPACE_BG':
      return { ...state, workspaceBackground: action.payload };

    case 'UPDATE_LOGIN_BG':
      return { ...state, loginBackground: action.payload };

    case 'UPDATE_PORTAL_BG':
      return { ...state, portalBackground: action.payload };

    case 'UPDATE_CRM_BG':
      return { ...state, crmBackground: action.payload };

    case 'UPDATE_PORTAL_IMAGE_OPACITY':
      return { ...state, portalImageOpacity: action.payload };

    case 'UPDATE_CRM_IMAGE_OPACITY':
      return { ...state, crmImageOpacity: action.payload };

    case 'UPDATE_LOGO':
      return { ...state, logo: action.payload };

    case 'SET_ONLINE_USERS':
      return { ...state, onlineUsers: action.payload };

    default:
      return state;
  }
}
