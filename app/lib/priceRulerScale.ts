/**
 * Stepped price ruler for the lights-off screen.
 *
 * Center = 0% vs open; the UI draws that as 1 / 2 / 3 dots (major 1% / 10% /
 * 100%) instead of a tick line. Minors are major/5. From center: promote at
 * the **5th major**; demote when live |pct| falls back inside the finer
 * rung's **1st major**. At most one demote per tick.
 */

/** Quiet half-range at the finest rung: ±0.8% → 9 ticks (4 × 0.2% minors). */
export const DEFAULT_RANGE_PCT = 0.008;

/** Major-step ladder (fraction). Legend dots → 1 / 2 / 3. */
export const RULER_UNITS = [0.01, 0.1, 1] as const;

/** Finest major step (1%). */
export const FINEST_DECADE_UNIT = RULER_UNITS[0];

/** Minors per major group. */
export const MINORS_PER_MAJOR = 5;

/** Majors from center → marker that trigger a step-up (5 × 1% = 5%). */
export const PROMOTE_MAJOR_COUNT = 5;

/** Quiet half-range for a major unit: 4 minors each side. */
export function defaultRangeForUnit(major: number): number {
	return (major / MINORS_PER_MAJOR) * 4;
}

export function scaleForUnit(major: number): { minor: number; major: number } {
	return { minor: major / MINORS_PER_MAJOR, major };
}

/** |pct| at which this major unit promotes (5th major from center). */
export function promoteThreshold(major: number): number {
	return major * PROMOTE_MAJOR_COUNT;
}

/**
 * |pct| at which the next-coarser rung demotes back — the finer rung's 1st
 * major (on "10", demote below 1%; on "100", demote below 10%).
 */
export function demoteThreshold(finerMajor: number): number {
	return finerMajor;
}

/** Cap half-range within a unit at the promote threshold. */
export function rangeCapForUnit(major: number): number {
	return promoteThreshold(major);
}

/** How many legend dots for this major rung: 1%→1, 10%→2, 100%→3. */
export function decadeDotCount(major: number): 1 | 2 | 3 {
	const percentPoints = Math.round(major * 100);
	if (percentPoints >= 100) return 3;
	if (percentPoints >= 10) return 2;
	return 1;
}

function unitIndex(major: number): number {
	const exact = RULER_UNITS.indexOf(major as (typeof RULER_UNITS)[number]);
	if (exact >= 0) return exact;
	let best = 0;
	let bestDist = Infinity;
	for (let i = 0; i < RULER_UNITS.length; i++) {
		const dist = Math.abs(RULER_UNITS[i]! - major);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return best;
}

/**
 * Step the major unit on live |pct|: promote at the 5th major, demote when
 * back inside the finer rung's 1st major (at most one rung per tick).
 */
export function resolveDecadeUnit(absPct: number, currentMajor: number): number {
	let i = unitIndex(currentMajor);

	while (i < RULER_UNITS.length - 1 && absPct >= promoteThreshold(RULER_UNITS[i]!)) {
		i += 1;
	}
	// One rung per tick — never 100 → 1 in a single print.
	if (i > 0 && absPct < demoteThreshold(RULER_UNITS[i - 1]!)) {
		i -= 1;
	}
	return RULER_UNITS[i]!;
}

export interface PriceRulerTick {
	value: number;
	major: boolean;
}

function isMultiple(value: number, step: number): boolean {
	if (step <= 0) return value === 0;
	const ratio = value / step;
	return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

/** Ticks in [-halfRange, halfRange] for the given major unit. */
export function buildPriceRulerTicks(
	halfRange: number,
	unit: number = FINEST_DECADE_UNIT,
): PriceRulerTick[] {
	const { minor, major } = scaleForUnit(unit);
	const range = Math.max(halfRange, defaultRangeForUnit(unit));
	const byValue = new Map<number, PriceRulerTick>();

	const majorSteps = Math.floor(range / major + 1e-12);
	for (let i = -majorSteps; i <= majorSteps; i++) {
		const value = i === 0 ? 0 : i * major;
		byValue.set(value, { value, major: true });
	}

	const minorSteps = Math.floor(range / minor + 1e-12);
	for (let i = -minorSteps; i <= minorSteps; i++) {
		const value = i === 0 ? 0 : i * minor;
		if (byValue.has(value)) continue;
		byValue.set(value, { value, major: isMultiple(value, major) });
	}

	return [...byValue.values()].sort((a, b) => a.value - b.value);
}

/** Map a % change onto the ruler's normalized Y axis: -1 bottom .. +1 top. */
export function pctChangeToPosition(
	pctChange: number,
	halfRange: number,
	unit: number = FINEST_DECADE_UNIT,
): number {
	const range = Math.max(halfRange, defaultRangeForUnit(unit));
	const raw = pctChange / range;
	return Math.max(-1, Math.min(1, raw));
}

export interface PriceRulerEnvelope {
	range: number;
	/** Current major step (fraction); legend dots = decadeDotCount(unit). */
	unit: number;
}

const RANGE_EXPANSION_HEADROOM = 1.5;
export const RANGE_SHRINK_TRIGGER = 0.5;

/**
 * Next display half-range + major unit after a print. The unit (and therefore
 * the legend) updates on both promote and demote.
 */
export function nextPriceRulerEnvelope(
	absPct: number,
	current: PriceRulerEnvelope,
): PriceRulerEnvelope {
	const unit = resolveDecadeUnit(absPct, current.unit);
	const floor = defaultRangeForUnit(unit);
	const cap = rangeCapForUnit(unit);

	if (unit !== current.unit) {
		return {
			unit,
			range: Math.min(Math.max(absPct * RANGE_EXPANSION_HEADROOM, floor), cap),
		};
	}

	let range = current.range;
	if (absPct > range) {
		range = Math.min(absPct * RANGE_EXPANSION_HEADROOM, cap);
	} else if (absPct < range * RANGE_SHRINK_TRIGGER) {
		range = Math.max(absPct * RANGE_EXPANSION_HEADROOM, floor);
	}
	range = Math.max(range, absPct, floor);
	range = Math.min(range, cap);
	return { unit, range };
}
