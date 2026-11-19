/**
 * Per-call approval for Pi's shell and file-mutation tools.
 * This is a tool gate, not an OS sandbox: extension-internal I/O and arbitrary
 * custom/MCP tools are outside its scope. Nested calls to guarded tools are gated.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function permissions(pi: ExtensionAPI) {
	// Nested tool calls may arrive concurrently. Show only one dialog at a time.
	let pending: Promise<void> = Promise.resolve();

	function approve(ctx: ExtensionContext, title: string, details: string): Promise<boolean> {
		const decision = pending.then(async () => {
			if (!ctx.hasUI || ctx.signal?.aborted) return false;
			try {
				// Deny is first, so Enter alone never grants permission.
				const choice = await ctx.ui.select(
					`${title}\n\nWorking directory: ${ctx.cwd}\n\n${details}\n\nAllow this one operation?`,
					["Deny", "Allow once"],
					{ signal: ctx.signal },
				);
				return choice === "Allow once" && !ctx.signal?.aborted;
			} catch {
				// Cancellation, UI errors, and missing approval all fail closed.
				return false;
			}
		});
		pending = decision.then(() => undefined, () => undefined);
		return decision;
	}

	pi.on("tool_call", async (event, ctx) => {
		if (!["bash", "powershell", "edit", "write"].includes(event.toolName)) return;

		// Show every argument, including the complete command or proposed changes.
		const allowed = await approve(
			ctx,
			`Permission required: ${event.toolName}`,
			JSON.stringify(event.input, null, 2),
		);
		if (!allowed) {
			return {
				block: true,
				reason: `Permission not granted for ${event.toolName}. Do not retry or use another tool to bypass this denial.`,
			};
		}
	});

	pi.on("user_bash", async (event, ctx) => {
		if (await approve(ctx, "Permission required: shell command (!/!!)", event.command)) return;
		// Suppress the normal shell execution path.
		return {
			result: {
				output: "Shell command blocked: permission not granted.",
				exitCode: 1,
				cancelled: true,
				truncated: false,
			},
		};
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus("permissions", "Permissions: shell/edit/write ask; read allowed");
		}
	});
}
