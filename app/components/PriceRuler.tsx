import {
	LOGIN_PARTICLE_ALPHA,
	LOGIN_PARTICLE_DOWN,
	LOGIN_PARTICLE_UP,
} from "../lib/loginAtmosphere";
import { DEFAULT_BACKDROP_INST_ID } from "../lib/backdropConfig";
import { buildPriceRulerTicks, decadeDotCount } from "../lib/priceRulerScale";
import { usePriceRulerPosition } from "../lib/usePriceRulerPosition";

/**
 * Vertical price ruler along the right edge.
 *
 * Stepped scale: the 0% center is 1 / 2 / 3 geometric dots (major 1% / 10% /
 * 100%) instead of a tick line. Minors are major/5. Promote at the 5th major;
 * demote when |pct| falls back to the finer rung's 1st major. Marker eases on
 * `top`.
 */
export function PriceRuler({
	instId = DEFAULT_BACKDROP_INST_ID,
}: {
	instId?: string;
} = {}) {
	const { position, range, pctChange, unit } = usePriceRulerPosition(instId);
	const markerTopPercent = ((1 - position) / 2) * 100;
	// Same hex + opacity as the backdrop particles — readable on the amber field.
	const markerPaint =
		pctChange > 0
			? { backgroundColor: LOGIN_PARTICLE_UP, opacity: LOGIN_PARTICLE_ALPHA }
			: pctChange < 0
				? { backgroundColor: LOGIN_PARTICLE_DOWN, opacity: LOGIN_PARTICLE_ALPHA }
				: null;

	const ticks = buildPriceRulerTicks(range, unit).filter((tick) => tick.value !== 0);
	const dots = decadeDotCount(unit);

	return (
		<div
			aria-hidden="true"
			className="pointer-events-none fixed top-1/2 right-3 z-[1] h-[60vh] w-6 -translate-y-1/2 sm:right-6"
		>
			<div className="relative h-full w-full">
				{ticks.map((tick) => {
					const topPercent = ((1 - tick.value / range) / 2) * 100;
					return (
						<span
							key={`${unit}-${tick.value}`}
							className={`absolute right-0 h-px transition-[opacity,width] duration-300 ease-out ${
								tick.major
									? "bg-[color:var(--login-tick-major)]"
									: "bg-[color:var(--login-tick)]"
							}`}
							style={{ top: `${topPercent}%`, width: tick.major ? "100%" : "45%" }}
						/>
					);
				})}
				<span
					data-dots={dots}
					// Same top-edge anchoring as the marker (`top: 50%`, no Y
					// translate) so the 3px dots share a midline with the 3px
					// marker at rest.
					className="absolute top-1/2 right-0 flex items-center justify-end gap-1"
				>
					{Array.from({ length: dots }, (_, i) => (
						<span
							key={i}
							className="block h-[3px] w-[3px] rounded-full bg-[color:var(--login-tick-major)]"
						/>
					))}
				</span>
				<span
					data-tone={pctChange > 0 ? "up" : pctChange < 0 ? "down" : "flat"}
					className={`absolute right-0 h-[3px] w-full rounded-full transition-[top,background-color,opacity] duration-500 ease-out ${
						markerPaint ? "" : "bg-[color:var(--login-marker-flat)]"
					}`}
					style={{ top: `${markerTopPercent}%`, ...markerPaint }}
				/>
			</div>
		</div>
	);
}
