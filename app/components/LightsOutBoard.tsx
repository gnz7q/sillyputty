import { LIGHTS_OUT_SIZE, type LightsOutGrid } from "../lib/lightsOut";

type LightsOutBoardProps = {
	grid: LightsOutGrid;
	onPress: (row: number, col: number) => void;
	disabled?: boolean;
};

/** Presentational 5×5 Lights Out grid (charcoal = on, cream = off). */
export function LightsOutBoard({ grid, onPress, disabled = false }: LightsOutBoardProps) {
	return (
		<div
			role="grid"
			aria-label="Lights Out puzzle"
			className="mx-auto grid w-full max-w-[20rem] gap-2.5 sm:max-w-[22rem]"
			style={{ gridTemplateColumns: `repeat(${LIGHTS_OUT_SIZE}, minmax(0, 1fr))` }}
		>
			{grid.map((row, rowIndex) =>
				row.map((on, colIndex) => (
					<button
						key={`${rowIndex}-${colIndex}`}
						type="button"
						role="gridcell"
						disabled={disabled}
						aria-label={`Row ${rowIndex + 1}, column ${colIndex + 1}, ${on ? "on" : "off"}`}
						onClick={() => onPress(rowIndex, colIndex)}
						// select-none + touch-callout:none — without them a slightly
						// long tap on a touchscreen (easy to do mid-game, rapidly
						// pressing cells) opens the browser's native text-selection
						// "Copy" callout instead of registering as a move.
						className={`aspect-square select-none rounded-2xl shadow-[0_2px_0_rgba(0,0,0,0.12)] transition-transform duration-150 [-webkit-touch-callout:none] active:scale-95 disabled:pointer-events-none disabled:active:scale-100 ${
							on ? "bg-[#232323]" : "bg-[#fff5d6]"
						}`}
					/>
				)),
			)}
		</div>
	);
}
