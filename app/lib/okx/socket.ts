/**
 * Multiplexed browser → OKX public WebSocket.
 *
 * The browser talks to the exchange directly; there is no backend in front
 * of it. One socket per endpoint URL is shared by every caller, refcounted:
 * the first `subscribeOkx` dials, later ones only add channel args, and the
 * last teardown closes it. Args are resent on every reconnect, so a caller
 * never has to re-subscribe by hand.
 *
 * Endpoint split is OKX's own: `tickers` / `books` / `mark-price` live on
 * /ws/v5/public, candles on /ws/v5/business.
 */

import { debugWsLifecycle, nextReconnectDelayMs } from "../wsReconnect";

export const OKX_PUBLIC_WS_URL = "wss://ws.okx.com:8443/ws/v5/public";
export const OKX_BUSINESS_WS_URL = "wss://ws.okx.com:8443/ws/v5/business";

/**
 * OKX drops a socket after 30s of silence in either direction. `tickers` is
 * chatty enough that this rarely fires, but a dead-quiet instrument would
 * otherwise be disconnected and reconnected on a loop.
 */
const PING_IDLE_MS = 20_000;
const PING_CHECK_MS = 5_000;

export type OkxArg = { channel: string; instId: string };

export type OkxStreamStatus = "live" | "reconnecting" | "idle";

export type OkxListener = (row: Record<string, unknown>, arg: OkxArg) => void;
export type OkxStatusListener = (status: OkxStreamStatus) => void;

function argKey(arg: OkxArg): string {
	return `${arg.channel}::${arg.instId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Subscription {
	arg: OkxArg;
	listeners: Set<OkxListener>;
}

interface Connection {
	subs: Map<string, Subscription>;
	statusListeners: Set<OkxStatusListener>;
	status: OkxStreamStatus;
	/** Ask the socket for these args now, if it is open. */
	send: (op: "subscribe" | "unsubscribe", args: OkxArg[]) => void;
	close: () => void;
}

const connections = new Map<string, Connection>();

function createConnection(url: string): Connection {
	const subs = new Map<string, Subscription>();
	const statusListeners = new Set<OkxStatusListener>();

	let socket: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let pingTimer: ReturnType<typeof setInterval> | null = null;
	let reconnectAttempt = 0;
	let lastMessageAt = 0;
	let cancelled = false;

	const connection: Connection = {
		subs,
		statusListeners,
		status: "idle",
		send: () => undefined,
		close: () => undefined,
	};

	const setStatus = (status: OkxStreamStatus) => {
		connection.status = status;
		for (const listener of statusListeners) listener(status);
	};

	const socketIsOpen = () => socket !== null && socket.readyState === WebSocket.OPEN;

	const send = (op: "subscribe" | "unsubscribe", args: OkxArg[]) => {
		if (args.length === 0 || !socketIsOpen()) return;
		socket!.send(JSON.stringify({ op, args }));
	};

	const stopPing = () => {
		if (pingTimer !== null) {
			clearInterval(pingTimer);
			pingTimer = null;
		}
	};

	const startPing = () => {
		stopPing();
		pingTimer = setInterval(() => {
			if (!socketIsOpen()) return;
			if (Date.now() - lastMessageAt < PING_IDLE_MS) return;
			// A bare "ping" string, not JSON — OKX answers with a bare "pong".
			socket!.send("ping");
		}, PING_CHECK_MS);
	};

	const scheduleReconnect = () => {
		if (cancelled || reconnectTimer !== null) return;
		const delay = nextReconnectDelayMs(reconnectAttempt);
		debugWsLifecycle("okx", "schedule_reconnect", { url, attempt: reconnectAttempt, delay });
		reconnectAttempt += 1;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, delay);
	};

	const connect = () => {
		if (cancelled) return;
		if (typeof WebSocket === "undefined") {
			setStatus("idle");
			return;
		}
		let created: WebSocket;
		try {
			debugWsLifecycle("okx", "connect", { url, attempt: reconnectAttempt });
			created = new WebSocket(url);
		} catch {
			scheduleReconnect();
			return;
		}
		socket = created;

		created.onopen = () => {
			if (cancelled || socket !== created) return;
			reconnectAttempt = 0;
			lastMessageAt = Date.now();
			debugWsLifecycle("okx", "open", { url, args: subs.size });
			// One frame for every arg the page currently wants — a reconnect
			// restores the full subscription set without the callers knowing.
			send(
				"subscribe",
				[...subs.values()].map((sub) => sub.arg),
			);
			startPing();
			setStatus("live");
		};

		created.onmessage = (event) => {
			if (cancelled || socket !== created) return;
			lastMessageAt = Date.now();
			const raw = typeof event.data === "string" ? event.data : "";
			if (!raw || raw === "pong") return;
			let payload: unknown;
			try {
				payload = JSON.parse(raw);
			} catch {
				return;
			}
			if (!isRecord(payload)) return;
			if (typeof payload.event === "string") {
				// subscribe/unsubscribe acks and channel-level errors. Nothing to
				// do on the happy path; an error here means that one arg will
				// never deliver, which is worth seeing in dev.
				if (payload.event === "error") {
					debugWsLifecycle("okx", "channel_error", {
						url,
						code: payload.code,
						msg: payload.msg,
					});
				}
				return;
			}
			if (!isRecord(payload.arg) || !Array.isArray(payload.data)) return;
			const channel = payload.arg.channel;
			const instId = payload.arg.instId;
			if (typeof channel !== "string" || typeof instId !== "string") return;
			const sub = subs.get(argKey({ channel, instId }));
			if (sub === undefined) return;
			for (const row of payload.data) {
				if (!isRecord(row)) continue;
				for (const listener of sub.listeners) listener(row, sub.arg);
			}
		};

		created.onclose = () => {
			if (cancelled || socket !== created) return;
			debugWsLifecycle("okx", "close", { url });
			socket = null;
			stopPing();
			setStatus("reconnecting");
			scheduleReconnect();
		};

		// onclose always follows onerror for browser WebSockets — the reconnect
		// is scheduled there, nothing extra needed here.
		created.onerror = () => undefined;
	};

	const close = () => {
		cancelled = true;
		stopPing();
		if (reconnectTimer !== null) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		if (socket !== null) {
			socket.onopen = null;
			socket.onmessage = null;
			socket.onclose = null;
			socket.onerror = null;
			try {
				socket.close();
			} catch {
				// already closing/closed
			}
			socket = null;
		}
		setStatus("idle");
	};

	connection.send = send;
	connection.close = close;
	setStatus("reconnecting");
	connect();
	return connection;
}

/**
 * Subscribe one OKX channel arg. Returns the unsubscriber; when it drops the
 * last listener for that arg the socket is told to unsubscribe, and when the
 * last arg on a connection goes away the connection itself is closed.
 */
export function subscribeOkx({
	url = OKX_PUBLIC_WS_URL,
	arg,
	onData,
	onStatus,
}: {
	url?: string;
	arg: OkxArg;
	onData: OkxListener;
	onStatus?: OkxStatusListener;
}): () => void {
	let connection = connections.get(url);
	if (connection === undefined) {
		connection = createConnection(url);
		connections.set(url, connection);
	}

	const key = argKey(arg);
	let sub = connection.subs.get(key);
	if (sub === undefined) {
		sub = { arg, listeners: new Set() };
		connection.subs.set(key, sub);
		// A socket that is still connecting subscribes everything in `onopen`.
		connection.send("subscribe", [arg]);
	}
	sub.listeners.add(onData);
	if (onStatus) {
		connection.statusListeners.add(onStatus);
		onStatus(connection.status);
	}

	let stopped = false;
	return () => {
		if (stopped) return;
		stopped = true;
		const current = connections.get(url);
		if (current === undefined) return;
		if (onStatus) current.statusListeners.delete(onStatus);
		const entry = current.subs.get(key);
		if (entry !== undefined) {
			entry.listeners.delete(onData);
			if (entry.listeners.size === 0) {
				current.subs.delete(key);
				current.send("unsubscribe", [arg]);
			}
		}
		if (current.subs.size === 0) {
			connections.delete(url);
			current.close();
		}
	};
}

/** Test/HMR escape hatch: drop every shared connection. */
export function resetOkxSocketsForTests(): void {
	for (const connection of connections.values()) connection.close();
	connections.clear();
}
