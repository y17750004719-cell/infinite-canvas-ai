"use client";

import React from "react";
import {
  MousePointer2,
  Hand,
  Square,
  ImageIcon,
  Frame,
  Undo2,
  Redo2,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Wand2,
} from "lucide-react";
import { useCanvasStore } from "../../lib/store";

interface ToolbarProps {
  onUploadImage: () => void;
  onAddFrame: () => void;
  onGenerate: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToScreen: () => void;
}

export default function Toolbar({
  onUploadImage,
  onAddFrame,
  onGenerate,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
}: ToolbarProps) {
  const { selectedIds, deleteSelectedNodes, undo, redo, scale, history, historyIndex } =
    useCanvasStore();

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  return (
    <div className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-2 shadow-sm z-50">
      <div className="flex items-center gap-1 pr-4 border-r border-gray-200">
        <button
          onClick={undo}
          disabled={!canUndo}
          className="p-2 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-5 h-5" />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="p-2 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center gap-1 px-4 border-r border-gray-200">
        <button
          onClick={onUploadImage}
          className="p-2 rounded hover:bg-gray-100 transition-colors"
          title="Upload Image"
        >
          <ImageIcon className="w-5 h-5" />
        </button>
        <button
          onClick={onAddFrame}
          className="p-2 rounded hover:bg-gray-100 transition-colors"
          title="Add Frame (F)"
        >
          <Frame className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center gap-1 px-4 border-r border-gray-200">
        <button
          onClick={onGenerate}
          className="flex items-center gap-2 px-3 py-2 bg-primary text-white rounded hover:bg-primary/90 transition-colors"
          title="Generate Image (G)"
        >
          <Wand2 className="w-5 h-5" />
          <span className="text-sm font-medium">Generate</span>
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1 px-4 border-l border-gray-200">
        <button
          onClick={onZoomOut}
          className="p-2 rounded hover:bg-gray-100 transition-colors"
          title="Zoom Out"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <span className="text-sm text-gray-500 w-14 text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={onZoomIn}
          className="p-2 rounded hover:bg-gray-100 transition-colors"
          title="Zoom In"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          onClick={onFitToScreen}
          className="p-2 rounded hover:bg-gray-100 transition-colors"
          title="Fit to Screen"
        >
          <Maximize className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center gap-1 pl-4 border-l border-gray-200">
        <button
          onClick={deleteSelectedNodes}
          disabled={selectedIds.length === 0}
          className="p-2 rounded hover:bg-red-50 text-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Delete Selected (Del)"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
