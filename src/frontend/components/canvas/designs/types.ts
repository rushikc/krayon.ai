import type { CSSProperties, ComponentType, RefObject } from "react";

import type { ArrowNode, BoxNode, NumberNode } from "@/types/canvas";

export interface DesignBoxProps {
  node: BoxNode;
  selected: boolean;
  canvasRef: RefObject<HTMLDivElement | null>;
}

export interface DesignNumberProps {
  node: NumberNode;
  selected: boolean;
  canvasRef: RefObject<HTMLDivElement | null>;
}

export interface DesignArrowProps {
  arrow: ArrowNode;
  boxes: BoxNode[];
  selected: boolean;
  markerPrefix: string;
}

export interface DesignMarkersProps {
  markerPrefix: string;
}

export interface CanvasDesign {
  Box: ComponentType<DesignBoxProps>;
  Number: ComponentType<DesignNumberProps>;
  Arrow: ComponentType<DesignArrowProps>;
  Markers: ComponentType<DesignMarkersProps>;
  frameClassName: string;
  frameStyle: (exporting: boolean) => CSSProperties;
  exportBackground: string;
  exportBackgroundImage: string;
  exportBackgroundSize: string;
  exportBackgroundPosition: string;
  exportBackgroundRepeat: string;
  skill: string;
}
