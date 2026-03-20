"use client";

import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";

export type NodeType = "image" | "frame";

export interface CanvasNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  src?: string;
  name?: string;
  children?: string[];
  locked: boolean;
  visible: boolean;
}

export interface CanvasState {
  nodes: CanvasNode[];
  selectedIds: string[];
  scale: number;
  offset: { x: number; y: number };
  history: CanvasNode[][];
  historyIndex: number;
  
  // Actions
  addNode: (node: Omit<CanvasNode, "id">) => string;
  updateNode: (id: string, updates: Partial<CanvasNode>) => void;
  deleteNode: (id: string) => void;
  deleteSelectedNodes: () => void;
  selectNode: (id: string, multi?: boolean) => void;
  clearSelection: () => void;
  setScale: (scale: number) => void;
  setOffset: (offset: { x: number; y: number }) => void;
  undo: () => void;
  redo: () => void;
  saveToHistory: () => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  selectedIds: [],
  scale: 1,
  offset: { x: 0, y: 0 },
  history: [[]],
  historyIndex: 0,

  addNode: (node) => {
    const id = uuidv4();
    const newNode: CanvasNode = { ...node, id };
    const currentNodes = get().nodes;
    const newNodes = [...currentNodes, newNode];
    
    set({ nodes: newNodes });
    get().saveToHistory();
    
    return id;
  },

  updateNode: (id, updates) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, ...updates } : node
      ),
    }));
  },

  deleteNode: (id) => {
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== id),
      selectedIds: state.selectedIds.filter((nodeId) => nodeId !== id),
    }));
    get().saveToHistory();
  },

  deleteSelectedNodes: () => {
    const { selectedIds, nodes } = get();
    if (selectedIds.length === 0) return;
    
    const newNodes = nodes.filter((node) => !selectedIds.includes(node.id));
    set({ nodes: newNodes, selectedIds: [] });
    get().saveToHistory();
  },

  selectNode: (id, multi = false) => {
    set((state) => {
      if (multi) {
        const isSelected = state.selectedIds.includes(id);
        return {
          selectedIds: isSelected
            ? state.selectedIds.filter((nodeId) => nodeId !== id)
            : [...state.selectedIds, id],
        };
      }
      return { selectedIds: [id] };
    });
  },

  clearSelection: () => {
    set({ selectedIds: [] });
  },

  setScale: (scale) => {
    set({ scale: Math.max(0.1, Math.min(10, scale)) });
  },

  setOffset: (offset) => {
    set({ offset });
  },

  saveToHistory: () => {
    const { nodes, history, historyIndex } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push([...nodes]);
    
    if (newHistory.length > 50) {
      newHistory.shift();
    }
    
    set({
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      set({
        nodes: [...history[newIndex]],
        historyIndex: newIndex,
        selectedIds: [],
      });
    }
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      set({
        nodes: [...history[newIndex]],
        historyIndex: newIndex,
        selectedIds: [],
      });
    }
  },

  bringToFront: (id) => {
    set((state) => {
      const node = state.nodes.find((n) => n.id === id);
      if (!node) return state;
      
      const otherNodes = state.nodes.filter((n) => n.id !== id);
      return { nodes: [...otherNodes, node] };
    });
  },

  sendToBack: (id) => {
    set((state) => {
      const node = state.nodes.find((n) => n.id === id);
      if (!node) return state;
      
      const otherNodes = state.nodes.filter((n) => n.id !== id);
      return { nodes: [node, ...otherNodes] };
    });
  },
}));
