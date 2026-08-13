/**
 * Decorative price tape for the lights-off screen, read straight off OKX.
 *
 * The `tickers` channel pushes the instrument's last print (`last`, `lastSz`)
 * plus the current UTC-day open (`sodUtc0`). Direction is derived the only way
 * this channel allows — comparing consecutive last prints — so the first
 * message is a snapshot that seeds the comparison and carries the open, and
 * every later one where the price actually moved becomes a tick.
 *
 * Decorative only: it drives the backdrop particles and the price ruler,
 * nothing that anyone makes a decision on. It never throws, retries quietly
 * behind `subscribeOkx`, and callers must freeze rather than invent motion
 * when `onTick` goes quiet.
 */

import { DEFAULT_BACKDROP_INST_ID } from "../backdropConfig";
import { OKX_PUBLIC_WS_URL, subscribeOkx, type OkxStreamStatus } from "./socket";

/**
 * OKX stamps every push with its own `ts` (epoch ms). Network buffering or a
 * reconnect racing a fresh subscribe can occasionally deliver one well after
 * it happened, and a particle born from it would read as a trade happening
 * right now when it isn't. Kept tight on purpose: a *chronic* few-seconds lag
 * — every message individually still "recent enough" — would sail through a
 * looser bound forever. The cost is also dropping prints during ordinary
 * jitter, acceptable for something purely decorative.
 */
const MAX_TICK_AGE_MS = 1_000;

export type TickDirection = "up" | "down";

export interface BackdropTrade {
	direction: TickDirection;
	/** This print's size (OKX `lastSz`), for scaling the visual pulse — a
	 * whale print should read as bigger than a one-lot retail fill. */
	size: number;
	/** This print's price (OKX `last`). NaN when missing/malformed, so
	 * callers that key off price must check before using it. */
	price: number;
	/** Current UTC-day open (OKX `sodUtc0`). */
	openUtc0?: number;
}

export interface BackdropStreamHandlers {
	onTick: (trade: BackdropTrade) => void;
	/** Called for the first message and whenever a later one carries an open. */
	onOpenPrice?: (open: number) => void;
	onStatus?: (status: OkxStreamStatus) => void;
	/** OKX instrument id, e.g. BTC-USDT-SWAP. */
	instId?: string;
}

function positiveNumber(value: unknown): number | null {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Subscribes the `tickers` channel for one instrument. Every subscriber keeps
 * its own last-price comparison — they all see the same message sequence off
 * the shared socket, so the derived direction is identical either way, and
 * keeping the state here leaves `socket.ts` a plain transport.
 */
export function startBackdropStream(handlers: BackdropStreamHandlers): () => void {
	const instId = handlers.instId?.trim() || DEFAULT_BACKDROP_INST_ID;
	let previousPrice: number | null = null;

	return subscribeOkx({
		url: OKX_PUBLIC_WS_URL,
		arg: { channel: "tickers", instId },
		onStatus: handlers.onStatus,
		onData: (row) => {
			const price = positiveNumber(row.last);
			if (price === null) return;
			const open = positiveNumber(row.sodUtc0);

			if (previousPrice === null) {
				previousPrice = price;
				if (open !== null) handlers.onOpenPrice?.(open);
				return;
			}
			// Unchanged price is not a tick: it carries no direction, and the
			// backdrop would otherwise spawn a particle for every heartbeat-ish
			// republish of the same print.
			if (price === previousPrice) return;

			const ts = Number(row.ts);
			if (Number.isFinite(ts) && Date.now() - ts > MAX_TICK_AGE_MS) {
				// Still worth keeping as the comparison baseline — dropping it
				// entirely would make the *next* print's direction wrong.
				previousPrice = price;
				return;
			}

			const direction: TickDirection = price > previousPrice ? "up" : "down";
			previousPrice = price;
			if (open !== null) handlers.onOpenPrice?.(open);
			const size = Number(row.lastSz);
			handlers.onTick({
				direction,
				size: Number.isFinite(size) ? size : 0,
				price,
				openUtc0: open ?? Number.NaN,
			});
		},
	});
}
