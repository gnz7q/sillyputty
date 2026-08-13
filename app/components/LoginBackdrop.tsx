import { useEffect, useRef } from "react";
import {
	LOGIN_PARTICLE_ALPHA,
	LOGIN_PARTICLE_DOWN,
	LOGIN_PARTICLE_UP,
} from "../lib/loginAtmosphere";
import {
	DEFAULT_BACKDROP_INST_ID,
	DEFAULT_BACKDROP_REFERENCE_LOTS,
} from "../lib/backdropConfig";
import { startBackdropStream, type BackdropTrade } from "../lib/okx/backdropStream";

/**
 * No real print within this long → stop spawning new rows, since that really
 * would be inventing activity behind a dead connection. Rows already on
 * screen keep scrolling regardless — their motion represents a trade that
 * already happened, not new signal, so freezing them too on a network hiccup
 * would just read as the page hanging. Only when nothing has ever spawned
 * does staleness mean fully idle (see draw() below).
 */
const REAL_SIGNAL_FRESH_MS = 4_000;

/** Floor kept well above 2× the roundRectPath corner radius (4px) so small
 * squares read as rounded squares, not circles. */
const SIZE_MIN_PX = 16;

/**
 * Reference size for ~1 unit of base (see particleSidePx / referenceLots),
 * matched to the one real on-screen object it can be compared against: the
 * Lights Out cell. Genuinely a step function — LightsOutBoard's max-width is
 * capped, not fluid, so the cell size is constant at 56px from ~352px up to
 * 640px, then jumps to 62.4px above that.
 *
 * (max-w-[20rem|22rem] − 4 × 10px gap) / 5 columns, at Tailwind's default
 * `sm:` breakpoint.
 */
function referenceSizePx(viewportWidth: number): number {
	return viewportWidth >= 640 ? 62.4 : 56;
}

/**
 * Side length for a particle representing `lots`. Below the reference-lots
 * anchor (~1 unit of base), log-compressed so small/mid trades still show
 * meaningful variation instead of clustering near the floor. Above it, side
 * length grows with the square root of lots instead — so *area*, not side
 * length, scales proportionally with size. The two pieces agree exactly at
 * the anchor (both give `cellPx` there), so there is no visible jump.
 */
function particleSidePx(lots: number, cellPx: number, referenceLots: number): number {
	const anchor = Math.max(1, referenceLots);
	if (lots <= anchor) {
		const magnitude = Math.log1p(lots) / Math.log1p(anchor);
		return SIZE_MIN_PX + magnitude * (cellPx - SIZE_MIN_PX);
	}
	// Cap so a whale print cannot dominate the whole viewport height.
	return Math.min(cellPx * 1.35, cellPx * Math.sqrt(lots / anchor));
}

/**
 * One particle in the scrolling ticker. Trades arriving within one commit
 * window are summed *per side* — buys become one up-colored row, sells one
 * down-colored row — so a mixed burst reads as up to two shapes (each sized
 * by that side's own volume), not one merged total and not one per trade.
 */
type Row = {
	y: number;
	x: number;
	size: number;
	tone: "up" | "down";
	wobble: number;
	wobbleSpeed: number;
};

/** Scroll speed for the bottom-to-top ticker — slow enough to read as drift. */
const SCROLL_SPEED_PX_PER_SEC = 44;

/** Hard ceiling on simultaneous particles; busy markets skip new spawns
 * rather than stacking into an unreadable snow of squares. */
const MAX_ROWS = 36;

/**
 * A real gap this large between two consecutive animation frames means
 * requestAnimationFrame was suspended (tab backgrounded), not just a slow
 * frame — a healthy frame is ~16.7ms at 60Hz. Whatever piled up in
 * pendingRef during that gap is discarded rather than dumped as oversized
 * catch-up rows: this is decorative, nobody needs to catch up on what they
 * missed while away. Resumes silently with no marker.
 */
const BACKGROUND_RESUME_GAP_MS = 250;

/** Commit pending trades every N animation frames (~67ms at 60Hz) so a
 * bursty tape does not spawn a cell every single frame. */
const COMMIT_EVERY_N_FRAMES = 4;

function roundRectPath(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
	r: number,
): void {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + size, y, x + size, y + size, r);
	ctx.arcTo(x + size, y + size, x, y + size, r);
	ctx.arcTo(x, y + size, x, y, r);
	ctx.arcTo(x, y, x + size, y, r);
	ctx.closePath();
}

/**
 * Decorative background driven by the OKX ticker tape: every price update
 * arriving within one commit window is summed per side into at most two
 * rounded squares (buy / sell). Rows scroll bottom-to-top at a constant speed
 * and are dropped once past the top edge. With no live print in the last few
 * seconds new rows stop spawning — inventing one would fake activity behind a
 * dead connection — but rows already on screen keep scrolling.
 */
export function LoginBackdrop({
	instId = DEFAULT_BACKDROP_INST_ID,
	referenceLots = DEFAULT_BACKDROP_REFERENCE_LOTS,
}: {
	instId?: string;
	referenceLots?: number;
} = {}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const pendingRef = useRef<BackdropTrade[]>([]);
	const lastEventAtRef = useRef(0);
	const referenceLotsRef = useRef(referenceLots);
	referenceLotsRef.current = referenceLots;
	const resolvedInstId = instId.trim() || DEFAULT_BACKDROP_INST_ID;

	useEffect(() => {
		return startBackdropStream({
			instId: resolvedInstId,
			onTick: (trade) => {
				pendingRef.current.push(trade);
				lastEventAtRef.current = performance.now();
			},
		});
	}, [resolvedInstId]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const dpr = Math.max(1, window.devicePixelRatio || 1);
		let width = 0;
		let height = 0;

		function resize() {
			width = window.innerWidth;
			height = window.innerHeight;
			canvas!.width = width * dpr;
			canvas!.height = height * dpr;
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		resize();
		window.addEventListener("resize", resize);

		let rows: Row[] = [];

		function isFresh(now: number): boolean {
			return (
				lastEventAtRef.current > 0 && now - lastEventAtRef.current <= REAL_SIGNAL_FRESH_MS
			);
		}

		function drainPending(): BackdropTrade[] {
			const drained = pendingRef.current;
			pendingRef.current = [];
			return drained;
		}

		// Everything that arrived over the last COMMIT_EVERY_N_FRAMES becomes up
		// to two rows (one per side with volume > 0). Grouping across a short
		// frame window rather than each print's own `ts` keeps same-side bursts
		// as a single shape per side instead of one particle per fill.
		function commitSideRows(trades: BackdropTrade[], cellPx: number) {
			let buyVolume = 0;
			let sellVolume = 0;
			for (const trade of trades) {
				if (trade.direction === "up") buyVolume += trade.size;
				else sellVolume += trade.size;
			}

			function pushSide(volume: number, tone: Row["tone"]) {
				if (volume <= 0 || rows.length >= MAX_ROWS) return;
				rows.push({
					y: height,
					x: Math.random() * width,
					size: particleSidePx(volume, cellPx, referenceLotsRef.current),
					tone,
					wobble: Math.random() * Math.PI * 2,
					wobbleSpeed: 0.12 + Math.random() * 0.22,
				});
			}
			pushSide(buyVolume, "up");
			pushSide(sellVolume, "down");
		}

		let framesUntilCommit = 0;

		function draw(dt: number, rawGapMs: number) {
			const now = performance.now();
			const cellPx = referenceSizePx(width);
			const fresh = isFresh(now);

			if (fresh) {
				if (rawGapMs > BACKGROUND_RESUME_GAP_MS) {
					pendingRef.current = [];
					framesUntilCommit = 0;
				} else {
					framesUntilCommit += 1;
					if (framesUntilCommit >= COMMIT_EVERY_N_FRAMES) {
						framesUntilCommit = 0;
						const drained = drainPending();
						if (drained.length > 0) commitSideRows(drained, cellPx);
					}
				}
			}

			// Nothing has ever spawned and the signal still is not fresh — stay
			// fully idle (no clearRect) rather than repainting an empty canvas
			// every frame. Once anything is on screen the redraw below runs
			// unconditionally, so a later stale gap scrolls existing rows
			// instead of freezing them.
			if (!fresh && rows.length === 0) return;

			// Generous margin so a large (sqrt-scaled) square is not clipped
			// mid-render right as its row crosses the top edge.
			const exitMargin = Math.max(200, cellPx * 3);
			rows = rows.filter((row) => row.y > -exitMargin);

			ctx!.clearRect(0, 0, width, height);
			for (const row of rows) {
				row.y -= SCROLL_SPEED_PX_PER_SEC * dt;
				row.wobble += row.wobbleSpeed * dt;
				const x = row.x + Math.sin(row.wobble) * 7;
				ctx!.globalAlpha = LOGIN_PARTICLE_ALPHA;
				ctx!.fillStyle = row.tone === "up" ? LOGIN_PARTICLE_UP : LOGIN_PARTICLE_DOWN;
				roundRectPath(ctx!, x, row.y, row.size, 4);
				ctx!.fill();
			}
			ctx!.globalAlpha = 1;
		}

		let raf = 0;
		let last = performance.now();
		const loop = (now: number) => {
			const rawGapMs = now - last;
			const dt = Math.min(0.05, rawGapMs / 1000);
			last = now;
			draw(dt, rawGapMs);
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);

		return () => {
			window.removeEventListener("resize", resize);
			if (raf) cancelAnimationFrame(raf);
		};
	}, []);

	// canvas is a replaced element — fixed+inset-0 alone sizes it to its own
	// width/height *attributes* (the dpr-scaled bitmap resolution), not the
	// viewport, so everything drawn on it displays dpr-times too big. w-full
	// h-full forces the CSS box back to the viewport; the higher-res bitmap
	// still gets scaled down into it, so HiDPI sharpness is unaffected.
	//
	// -z-10: a `position: fixed` element with no z-index still paints *above*
	// normal-flow siblings regardless of DOM order, so without this the
	// scrolling rows would paint over the Lights Out board rather than behind.
	return (
		<canvas
			ref={canvasRef}
			aria-hidden="true"
			className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
		/>
	);
}
