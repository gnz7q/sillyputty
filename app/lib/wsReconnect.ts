/** Shared browser WebSocket reconnect knobs. */

export const WS_RECONNECT_BASE_MS = 2_000;
export const WS_RECONNECT_MAX_MS = 30_000;
/** Nobody retries faster than this: a dropped socket is not ready yet. */
export const WS_RECONNECT_MIN_MS = 250;

/**
 * Exponential backoff over a jittered window. `attempt` is 0 after the
 * first drop.
 *
 * The delay is drawn from the whole window rather than added to it. Every
 * socket in every open tab drops at the same instant when the upstream
 * bounces, so what matters is not the average wait but how tightly the
 * retries bunch: adding a small jitter to a fixed delay leaves them all
 * inside one 500ms window, which is the shape of a thundering herd.
 * Drawing across the window spreads the same clients out instead.
 */
export function nextReconnectDelayMs(
	attempt: number,
	random: () => number = Math.random,
): number {
	const window = Math.min(
		WS_RECONNECT_MAX_MS,
		WS_RECONNECT_BASE_MS * 2 ** Math.max(0, attempt),
	);
	return WS_RECONNECT_MIN_MS + Math.floor(random() * (window - WS_RECONNECT_MIN_MS));
}

export function debugWsLifecycle(
	channel: string,
	phase: string,
	details: Record<string, unknown>,
): void {
	if (!import.meta.env.DEV) return;
	console.debug(`[ws:${channel}] ${phase}`, details);
}
