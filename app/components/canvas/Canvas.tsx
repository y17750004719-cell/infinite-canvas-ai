"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";
import { Stage, Layer, Rect, Image as KonvaImage, Transformer, Group, Circle, Line } from "react-konva";
import { useCanvasStore, CanvasNode } from "../../lib/store";
import useImage from "use-image";

interface CanvasProps {
  width: number;
  height: number;
}

interface NodeImageProps {
  node: CanvasNode;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (updates: Partial<CanvasNode>) => void;
}

function NodeImage({ node, isSelected, onSelect, onChange }: NodeImageProps) {
  const [image] = useImage(node.src || "", "anonymous");
  const transformerRef = useRef<any>(null);
  const shapeRef = useRef<any>(null);

  useEffect(() => {
    if (isSelected && transformerRef.current && shapeRef.current) {
      transformerRef.current.nodes([shapeRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const handleDragEnd = (e: any) => {
    onChange({
      x: e.target.x(),
      y: e.target.y(),
    });
  };

  const handleTransformEnd = () => {
    const node = shapeRef.current;
    if (!node) return;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    onChange({
      x: node.x(),
      y: node.y(),
      width: Math.max(50, node.width() * scaleX),
      height: Math.max(50, node.height() * scaleY),
      rotation: node.rotation(),
    });
  };

  if (!node.src) return null;

  return (
    <>
      <KonvaImage
        ref={shapeRef}
        image={image}
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rotation={node.rotation}
        draggable={!node.locked}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
        opacity={node.visible ? 1 : 0}
      />
      {isSelected && (
        <Transformer
          ref={transformerRef}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 50 || newBox.height < 50) {
              return oldBox;
            }
            return newBox;
          }}
          rotateEnabled={true}
          enabledAnchors={[
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
            "middle-left",
            "middle-right",
            "top-center",
            "bottom-center",
          ]}
        />
      )}
    </>
  );
}

interface FrameNodeProps {
  node: CanvasNode;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (updates: Partial<CanvasNode>) => void;
}

function FrameNode({ node, isSelected, onSelect, onChange }: FrameNodeProps) {
  const transformerRef = useRef<any>(null);
  const shapeRef = useRef<any>(null);
  const nodes = useCanvasStore((state) => state.nodes);

  useEffect(() => {
    if (isSelected && transformerRef.current && shapeRef.current) {
      transformerRef.current.nodes([shapeRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const handleDragEnd = (e: any) => {
    onChange({
      x: e.target.x(),
      y: e.target.y(),
    });
  };

  const handleTransformEnd = () => {
    const nodeRef = shapeRef.current;
    if (!nodeRef) return;

    const scaleX = nodeRef.scaleX();
    const scaleY = nodeRef.scaleY();

    nodeRef.scaleX(1);
    nodeRef.scaleY(1);

    onChange({
      x: nodeRef.x(),
      y: nodeRef.y(),
      width: Math.max(100, nodeRef.width() * scaleX),
      height: Math.max(100, nodeRef.height() * scaleY),
      rotation: nodeRef.rotation(),
    });
  };

  return (
    <>
      <Group
        ref={shapeRef}
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rotation={node.rotation}
        draggable={!node.locked}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      >
        <Rect
          width={node.width}
          height={node.height}
          stroke="#3b82f6"
          strokeWidth={isSelected ? 2 : 1}
          cornerRadius={4}
          fill="transparent"
          dash={isSelected ? undefined : [5, 5]}
        />
      </Group>
      {isSelected && (
        <Transformer
          ref={transformerRef}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 100 || newBox.height < 100) {
              return oldBox;
            }
            return newBox;
          }}
          rotateEnabled={true}
          enabledAnchors={[
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
          ]}
        />
      )}
    </>
  );
}

function GridBackground({ scale, offset }: { scale: number; offset: { x: number; y: number } }) {
  const gridSize = 20;
  const lines = [];
  
  const startX = Math.floor(-offset.x / scale / gridSize) * gridSize - gridSize;
  const startY = Math.floor(-offset.y / scale / gridSize) * gridSize - gridSize;
  const endX = startX + (window.innerWidth / scale) + gridSize * 2;
  const endY = startY + (window.innerHeight / scale) + gridSize * 2;

  for (let x = startX; x < endX; x += gridSize) {
    lines.push(
      <Line
        key={`v-${x}`}
        points={[x, startY, x, endY]}
        stroke="#e5e7eb"
        strokeWidth={1 / scale}
      />
    );
  }

  for (let y = startY; y < endY; y += gridSize) {
    lines.push(
      <Line
        key={`h-${y}`}
        points={[startX, y, endX, y]}
        stroke="#e5e7eb"
        strokeWidth={1 / scale}
      />
    );
  }

  return <>{lines}</>;
}

export default function Canvas({ width, height }: CanvasProps) {
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width, height });
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const dragStartOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const {
    nodes,
    selectedIds,
    scale,
    offset,
    selectNode,
    clearSelection,
    setScale,
    setOffset,
    updateNode,
  } = useCanvasStore();

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const handleWheel = useCallback(
    (e: any) => {
      e.evt.preventDefault();

      const stage = stageRef.current;
      if (!stage) return;

      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };

      const direction = e.evt.deltaY > 0 ? -1 : 1;
      const scaleBy = 1.1;
      const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
      const clampedScale = Math.max(0.1, Math.min(10, newScale));

      const newPos = {
        x: pointer.x - mousePointTo.x * clampedScale,
        y: pointer.y - mousePointTo.y * clampedScale,
      };

      setScale(clampedScale);
      setOffset(newPos);
    },
    [setScale, setOffset]
  );

  const handlePointerDown = useCallback(
    (e: any) => {
      const evt = e.evt;
      if (evt.button === 1) {
        evt.preventDefault();
        const stage = stageRef.current;
        const pointer = stage?.getPointerPosition();
        
        if (stage && pointer) {
          dragStartPos.current = pointer;
          dragStartOffset.current = { x: stage.x(), y: stage.y() };
          if (containerRef.current) {
            containerRef.current.style.cursor = "grabbing";
          }
        }
      } else if (e.target === e.target.getStage()) {
        clearSelection();
      }
    },
    [clearSelection]
  );

  const handlePointerMove = useCallback(
    (e: any) => {
      if (!dragStartPos.current) return;

      const stage = stageRef.current;
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const dx = pointer.x - dragStartPos.current.x;
      const dy = pointer.y - dragStartPos.current.y;

      setOffset({
        x: dragStartOffset.current.x + dx,
        y: dragStartOffset.current.y + dy,
      });
    },
    [setOffset]
  );

  const handlePointerUp = useCallback(() => {
    dragStartPos.current = null;
    if (containerRef.current) {
      containerRef.current.style.cursor = "default";
    }
  }, []);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full overflow-hidden bg-gray-50"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        scaleX={scale}
        scaleY={scale}
        x={offset.x}
        y={offset.y}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <Layer>
          <GridBackground scale={scale} offset={offset} />
          
          {nodes.map((node) => {
            const isSelected = selectedIds.includes(node.id);
            
            if (node.type === "frame") {
              return (
                <FrameNode
                  key={node.id}
                  node={node}
                  isSelected={isSelected}
                  onSelect={() => selectNode(node.id)}
                  onChange={(updates) => updateNode(node.id, updates)}
                />
              );
            }
            
            return (
              <NodeImage
                key={node.id}
                node={node}
                isSelected={isSelected}
                onSelect={() => selectNode(node.id)}
                onChange={(updates) => updateNode(node.id, updates)}
              />
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
