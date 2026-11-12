import type {
  FigureNode,
  FigureMatrix,
} from "../../../shared/chemical-library/geometry.ts";
import { identityMatrix, multiplyMatrix } from "./geometry-math.ts";
export function walkGeometry(
  node: FigureNode,
  visit: (node: FigureNode, matrix: FigureMatrix) => void,
  parent = identityMatrix(),
) {
  const matrix = multiplyMatrix(parent, node.transform);
  visit(node, matrix);
  if (node.kind === "group")
    for (const child of node.children) walkGeometry(child, visit, matrix);
}
