import { useEffect, useRef, useState } from "react";
import { DEFAULT_BACKDROP_INST_ID } from "./backdropConfig";
import { startBackdropStream } from "./okx/backdropStream";
import {
	DEFAULT_RANGE_PCT,
	FINEST_DECADE_UNIT,
	nextPriceRulerEnvelope,
	pctChangeToPosition,
	type PriceRulerEnvelope,
} from "./priceRulerScale";

export interface PriceRulerState {
	/** -1 (bottom) .. 1 (top), derived from pctChange / range and clamped. */
	position: number;
	/** Visible half-range as a fraction (0.008 = ±0.8%). Drives tick placement. */
	range: number;
	/** Current percent change from the reference open, as a fraction. */
	pctChange: number;
	/** Major step as a fraction (0.01 = one legend dot). */
	unit: number;
}

const INITIAL_STATE: PriceRulerState = {
	position: 0,
	range: DEFAULT_RANGE_PCT,
	pctChange: 0,
	unit: FINEST_DECADE_UNIT,
};

const INITIAL_ENVELOPE: PriceRulerEnvelope = {
	range: DEFAULT_RANGE_PCT,
	unit: FINEST_DECADE_UNIT,
};

/** YYYY-MM-DD in UTC — the day `sodUtc0` belongs to. */
export function utcDateString(nowMs: number = Date.now()): string {
	return new Date(nowMs).toISOString().slice(0, 10);
}

function stateFromPrice(
	price: number,
	base: number,
	envelope: PriceRulerEnvelope,
): { state: PriceRulerState; envelope: PriceRulerEnvelope } {
	const pctChange = (price - base) / base;
	const next = nextPriceRulerEnvelope(Math.abs(pctChange), envelope);
	return {
		envelope: next,
		state: {
			pctChange,
			range: next.range,
			unit: next.unit,
			position: pctChangeToPosition(pctChange, next.range, next.unit),
		},
	};
}

/**
 * Marker position and stepped scale for the price ruler — tracks the
 * configured OKX swap against today's UTC open.
 *
 * Reference price is OKX `sodUtc0` for the current UTC day, which arrives on
 * the first ticker message and on later ones. A same-day repeat must not
 * override a base the first live print already set; a new UTC day's open
 * replaces the base and resets the envelope so the marker is not stuck on
 * yesterday's coarse scale.
 */
export function usePriceRulerPosition(
	instId: string = DEFAULT_BACKDROP_INST_ID,
): PriceRulerState {
	const [state, setState] = useState<PriceRulerState>(INITIAL_STATE);
	const basePriceRef = useRef<number | null>(null);
	const baseUtcDayRef = useRef<string | null>(null);
	const lastPriceRef = useRef<number | null>(null);
	const envelopeRef = useRef<PriceRulerEnvelope>(INITIAL_ENVELOPE);
	const resolvedInstId = instId.trim() || DEFAULT_BACKDROP_INST_ID;

	useEffect(() => {
		basePriceRef.current = null;
		baseUtcDayRef.current = null;
		lastPriceRef.current = null;
		envelopeRef.current = { ...INITIAL_ENVELOPE };
		setState(INITIAL_STATE);

		return startBackdropStream({
			instId: resolvedInstId,
			onOpenPrice: (open) => {
				const today = utcDateString();
				if (baseUtcDayRef.current === today && basePriceRef.current !== null) return;
				basePriceRef.current = open;
				baseUtcDayRef.current = today;
				envelopeRef.current = { ...INITIAL_ENVELOPE };
				const last = lastPriceRef.current;
				if (last == null || !Number.isFinite(last) || last <= 0) {
					setState(INITIAL_STATE);
					return;
				}
				const applied = stateFromPrice(last, open, envelopeRef.current);
				envelopeRef.current = applied.envelope;
				setState(applied.state);
			},
			onTick: (trade) => {
				if (!Number.isFinite(trade.price) || trade.price <= 0) return;
				lastPriceRef.current = trade.price;

				const today = utcDateString();
				if (basePriceRef.current === null) {
					basePriceRef.current = trade.price;
					baseUtcDayRef.current = today;
					envelopeRef.current = { ...INITIAL_ENVELOPE };
					setState(INITIAL_STATE);
					return;
				}
				const applied = stateFromPrice(
					trade.price,
					basePriceRef.current,
					envelopeRef.current,
				);
				envelopeRef.current = applied.envelope;
				setState(applied.state);
			},
		});
	}, [resolvedInstId]);

	return state;
}
