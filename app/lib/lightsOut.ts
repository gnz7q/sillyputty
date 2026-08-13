/** Classic Lights Out on a square grid (default 5×5). */

export type LightsOutGrid = boolean[][];

export const LIGHTS_OUT_SIZE = 5;

/**
 * true  = light on  (rendered charcoal — a lit tile)
 * false = light off (rendered cream — extinguished)
 *
 * Win when the board is uniform: all off OR all on. On 5×5 classic Lights Out
 * these two targets are isomorphic (complement the on/off labels), so
 * reverse-generated puzzles stay solvable to either monochromatic state.
 */
export function createEmptyGrid(size = LIGHTS_OUT_SIZE): LightsOutGrid {
	return Array.from({ length: size }, () => Array.from({ length: size }, () => false));
}

export function cloneGrid(grid: LightsOutGrid): LightsOutGrid {
	return grid.map((row) => [...row]);
}

/** True when every cell shares the same state (all off or all on). */
export function isSolved(grid: LightsOutGrid): boolean {
	const first = grid[0]?.[0];
	if (first === undefined) return true;
	return grid.every((row) => row.every((cell) => cell === first));
}

function inBounds(grid: LightsOutGrid, row: number, col: number): boolean {
	return row >= 0 && col >= 0 && row < grid.length && col < (grid[0]?.length ?? 0);
}

/** Flip one cell in place. */
function flipCell(grid: LightsOutGrid, row: number, col: number): void {
	if (!inBounds(grid, row, col)) return;
	grid[row]![col] = !grid[row]![col];
}

/** Toggle cell and its orthogonal neighbors (classic Lights Out). */
export function press(grid: LightsOutGrid, row: number, col: number): LightsOutGrid {
	const next = cloneGrid(grid);
	flipCell(next, row, col);
	flipCell(next, row - 1, col);
	flipCell(next, row + 1, col);
	flipCell(next, row, col - 1);
	flipCell(next, row, col + 1);
	return next;
}

/**
 * 倒推法生成可解开局：
 * 1. 从「全灭」（通关态）开始
 * 2. 对每个格子独立随机决定是否模拟点击一次
 * 3. 将最终亮灯局面作为初始关卡展示（重复同一组点击即可还原全灭）
 */
export function createRandomPuzzle(
	size = LIGHTS_OUT_SIZE,
	rng: () => number = Math.random,
): LightsOutGrid {
	let grid = createEmptyGrid(size);
	for (let row = 0; row < size; row += 1) {
		for (let col = 0; col < size; col += 1) {
			if (rng() < 0.5) {
				grid = press(grid, row, col);
			}
		}
	}
	// 全部未点到时仍是全灭，强制点一格保证有题可解。
	if (isSolved(grid)) {
		return press(grid, 0, 0);
	}
	return grid;
}
