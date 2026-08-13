import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Route } from "./+types/lights-off";
import { LightsOutBoard } from "../components/LightsOutBoard";
import { LoginBackdrop } from "../components/LoginBackdrop";
import { PriceRuler } from "../components/PriceRuler";
import { createEmptyGrid, createRandomPuzzle, isSolved, press } from "../lib/lightsOut";

/** How long a cleared board is held before the next puzzle is dealt. */
const SOLVED_HOLD_MS = 900;

/**
 * This page is server-rendered, where useLayoutEffect only warns and does
 * nothing — but on the client the layout timing matters (the board must be
 * randomized before first paint), so swap per environment.
 */
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "Lights Off" },
		{ name: "description", content: "Clear the board." },
	];
}

export default function LightsOff() {
	// createRandomPuzzle() is non-deterministic; seeding state with it during
	// SSR would mismatch hydration. Start uniform (matching server markup) and
	// randomize once mounted, so the board is ready before the first paint.
	const [grid, setGrid] = useState(() => createEmptyGrid());
	const [solved, setSolved] = useState(false);
	const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useClientLayoutEffect(() => {
		setGrid(createRandomPuzzle());
	}, []);

	useEffect(() => {
		return () => {
			if (resetTimer.current !== null) clearTimeout(resetTimer.current);
		};
	}, []);

	function handlePress(row: number, col: number) {
		if (solved) return;
		const next = press(grid, row, col);
		setGrid(next);
		if (!isSolved(next)) return;
		// Hold the cleared board for a beat so the win is legible, then deal
		// another one — there is nothing behind this screen to advance to.
		setSolved(true);
		resetTimer.current = setTimeout(() => {
			resetTimer.current = null;
			setGrid(createRandomPuzzle());
			setSolved(false);
		}, SOLVED_HOLD_MS);
	}

	return (
		<div className="login-atmosphere fixed inset-0 flex flex-col items-center justify-center px-4">
			<div
				aria-hidden="true"
				className="login-atmosphere-bg pointer-events-none absolute inset-0 -z-20"
			/>
			<div
				aria-hidden="true"
				className="login-atmosphere-noise pointer-events-none absolute inset-0 -z-20"
			/>
			<LoginBackdrop />
			<PriceRuler />

			<div className="relative z-[1] w-full">
				<LightsOutBoard grid={grid} onPress={handlePress} disabled={solved} />
			</div>
		</div>
	);
}
