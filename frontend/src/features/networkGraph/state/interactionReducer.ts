export type InteractionState = {
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  draggingNodeId: string | null;
  isResizingRing: boolean;
};

export type InteractionAction =
  | { type: 'NODE_CLICK'; nodeId: string }
  | { type: 'CANVAS_CLICK' }
  | { type: 'DRAG_START'; nodeId: string }
  | { type: 'DRAG_END' }
  | { type: 'HOVER_NODE'; nodeId: string | null }
  | { type: 'RING_RESIZE_START' }
  | { type: 'RING_RESIZE_END' };

export const initialInteractionState: InteractionState = {
  selectedNodeId: null,
  hoveredNodeId: null,
  draggingNodeId: null,
  isResizingRing: false,
};

export const interactionReducer = (
  state: InteractionState,
  action: InteractionAction,
): InteractionState => {
  switch (action.type) {
    case 'NODE_CLICK':
      if (state.selectedNodeId === action.nodeId) return state;
      return { ...state, selectedNodeId: action.nodeId };
    case 'CANVAS_CLICK':
      if (state.selectedNodeId === null) return state;
      return { ...state, selectedNodeId: null };
    case 'DRAG_START':
      if (state.draggingNodeId === action.nodeId) return state;
      return { ...state, draggingNodeId: action.nodeId };
    case 'DRAG_END':
      if (state.draggingNodeId === null) return state;
      return { ...state, draggingNodeId: null };
    case 'HOVER_NODE':
      if (state.hoveredNodeId === action.nodeId) return state;
      return { ...state, hoveredNodeId: action.nodeId };
    case 'RING_RESIZE_START':
      if (state.isResizingRing) return state;
      return { ...state, isResizingRing: true };
    case 'RING_RESIZE_END':
      if (!state.isResizingRing) return state;
      return { ...state, isResizingRing: false };
    default:
      return state;
  }
};
