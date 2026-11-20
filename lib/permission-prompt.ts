import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** Keep approval controls outside the viewport, even for huge tool arguments. */
export async function permissionPrompt(ctx: ExtensionContext, title: string, details: string, choices: string[]): Promise<string | undefined> {
	// RPC clients own their dialog rendering; custom terminal UI is unsupported there.
	if (ctx.mode !== "tui") return ctx.ui.select(`${title}\n\n${details}`, choices, { signal: ctx.signal });
	if (ctx.signal?.aborted) return undefined;
	return ctx.ui.custom<string | undefined>((tui, theme, keys, done) => {
		let selected = 0;
		let top = 0;
		let height = 1;
		let cachedWidth = -1;
		let lines: string[] = [];
		let closed = false;
		const finish = (choice?: string) => {
			if (closed) return;
			closed = true;
			ctx.signal?.removeEventListener("abort", abort);
			done(choice);
		};
		const abort = () => finish();
		ctx.signal?.addEventListener("abort", abort, { once: true });
		if (ctx.signal?.aborted) queueMicrotask(abort);
		return {
			render(width: number): string[] {
				const rows = Math.max(1, tui.terminal.rows);
				if (cachedWidth !== width) {
					// Arguments are plain text, never terminal control sequences.
					const safe = details.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
					lines = wrapTextWithAnsi(safe.replace(/\t/g, "    "), Math.max(1, width));
					cachedWidth = width;
				}
				// On very short terminals, show only the selected choice.
				const visibleChoices = rows >= choices.length + 5 ? choices.map((_, i) => i) : [selected];
				height = Math.max(1, rows - visibleChoices.length - 4);
				top = Math.max(0, Math.min(top, lines.length - height));
				const output = [
					theme.fg("accent", title),
					...lines.slice(top, top + height),
					theme.fg("dim", `Preview ${top + 1}-${Math.min(top + height, lines.length)}/${lines.length} • PgUp/PgDn scroll • Home/End`),
					...visibleChoices.map((i) => (i === selected ? theme.fg("accent", `> ${choices[i]}`) : `  ${choices[i]}`)),
					theme.fg("dim", "↑/↓ choose • Enter confirm • Esc deny"),
				];
				return output.slice(-rows).map((line) => truncateToWidth(line, width));
			},
			handleInput(data: string) {
				if (keys.matches(data, "tui.select.cancel") || matchesKey(data, "ctrl+c")) return finish();
				if (keys.matches(data, "tui.select.confirm")) return finish(choices[selected]);
				if (matchesKey(data, "pageUp")) top = Math.max(0, top - height);
				else if (matchesKey(data, "pageDown")) top = Math.min(Math.max(0, lines.length - height), top + height);
				else if (matchesKey(data, "home")) top = 0;
				else if (matchesKey(data, "end")) top = Math.max(0, lines.length - height);
				else if (keys.matches(data, "tui.select.up")) selected = (selected + choices.length - 1) % choices.length;
				else if (keys.matches(data, "tui.select.down")) selected = (selected + 1) % choices.length;
				else return;
				tui.requestRender();
			},
			invalidate() { cachedWidth = -1; },
			dispose() { ctx.signal?.removeEventListener("abort", abort); },
		};
	}, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%" }, blocked: { kind: "permission", message: title } });
}
