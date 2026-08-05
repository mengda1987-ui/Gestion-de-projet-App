import { BoardState } from '../types';
import { Action } from '../actions';

export function settingsReducer(state: BoardState, action: Action): BoardState {
  switch (action.type) {
    case 'SET_CURRENT_USER':
      return { ...state, currentUser: action.payload };

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

    case 'UPDATE_LOGO':
      return { ...state, logo: action.payload };

    case 'SET_ONLINE_USERS':
      return { ...state, onlineUsers: action.payload };

    default:
      return state;
  }
}
