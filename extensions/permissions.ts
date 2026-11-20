/**
 * File read/write rules and per-call shell approval. This is a tool gate, not
 * an OS sandbox: extension-internal I/O and arbitrary custom/MCP tools are outside
 * its scope. Nested calls to guarded tools are gated too.
 */
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { canonicalPath, decisionFor, loadPolicy, removeRule, saveRule, type Access, type Rule } from "../lib/permission-rules.ts";

export default function permissions(pi: ExtensionAPI) {
	const policyFile = join(getAgentDir(), "permissions.json");
	// Serialize the entire check/prompt/save sequence, not just the dialogs.
	let pending: Promise<void> = Promise.resolve();

	function approve(ctx: ExtensionContext, tool: string, details: string, file?: { access: Access; path: string }): Promise<boolean> {
		const decision = pending.then(async () => {
			if (ctx.signal?.aborted) return false;
			try {
				let path: string | undefined;
				if (file) {
					path = await canonicalPath(file.path, ctx.cwd);
					// Policy changes must be made manually or via explicitly approved shell
					// commands, never by a file tool using its own remembered approval.
					if (file.access === "write" && path === await canonicalPath(policyFile, ctx.cwd)) {
						ctx.ui.notify(`Use /permissions or edit ${policyFile} manually to change permission rules.`, "warning");
						return false;
					}
					const saved = await decisionFor(await loadPolicy(policyFile), file.access, path);
					if (saved) return saved === "allow" && !ctx.signal?.aborted;
				}
				if (!ctx.hasUI || ctx.signal?.aborted) return false;
				const verb = file?.access === "read" ? "Reading" : "Writing";
				const allowExact = `Always Allow ${verb} ${path}`;
				const denyExact = `Always Deny ${verb} ${path}`;
				const allowParent = `Always Allow ${verb} In ${path ? dirname(path) : ""}`;
				const choices = ["Allow once", "Deny once"];
				if (file) choices.push(allowExact, denyExact, allowParent);
				const title = `Permission required: ${tool}`;
				const preview = `Working directory: ${ctx.cwd}${path ? `\nTarget: ${path}` : ""}\n\n${details}\n\n${file ? "Parent-directory rules include descendants." : "Shell commands always require one-time approval."}`;
				const choice = ctx.mode === "tui"
					? await (await import("../lib/permission-prompt.ts")).permissionPrompt(ctx, title, preview, choices)
					: await ctx.ui.select(`${title}\n\n${preview}`, choices, { signal: ctx.signal });
				if (ctx.signal?.aborted) return false;
				if (choice === "Allow once") return true;
				if (file && path && (choice === allowExact || choice === denyExact || choice === allowParent)) {
					await saveRule(policyFile, {
						access: file.access,
						effect: choice === denyExact ? "deny" : "allow",
						path: choice === allowParent ? dirname(path) : path,
						scope: choice === allowParent ? "tree" : "exact",
					});
					return choice !== denyExact && !ctx.signal?.aborted;
				}
				return false;
			} catch (error) {
				// Invalid policy, failed saves, cancellation, and UI errors fail closed.
				if (ctx.hasUI) ctx.ui.notify(`Permission check failed: ${String(error)}`, "error");
				return false;
			}
		});
		pending = decision.then(() => undefined, () => undefined);
		return decision;
	}

	function describe(rule: Rule): string {
		return `${rule.effect.toUpperCase()} ${rule.access} · ${rule.scope === "tree" ? "directory + descendants" : "exact path"} · ${rule.path}`;
	}

	async function manage(ctx: ExtensionContext): Promise<void> {
		while (true) {
			const { rules } = await loadPolicy(policyFile);
			const action = await ctx.ui.select(
				`Permissions (${rules.filter((r) => r.effect === "allow").length} allowed, ${rules.filter((r) => r.effect === "deny").length} denied)\n${policyFile}\nDeny rules win; shell commands always require approval.`,
				["List rules", "Add rule", "Remove rule", "Done"],
			);
			if (!action || action === "Done") return;
			if (action === "Add rule") {
				const effect = await ctx.ui.select("Rule effect", ["allow", "deny"]);
				if (effect !== "allow" && effect !== "deny") continue;
				const access = await ctx.ui.select("File access (edit/write share write rules)", ["read", "write"]);
				if (access !== "read" && access !== "write") continue;
				const scope = await ctx.ui.select("Rule scope", ["exact", "tree"]);
				if (scope !== "exact" && scope !== "tree") continue;
				const input = await ctx.ui.input(`Path (${scope === "tree" ? "directory and all descendants" : "exact file or directory"}; relative to ${ctx.cwd})`, "Absolute, relative, or ~/path");
				if (input === undefined) continue;
				if (!input.trim()) {
					ctx.ui.notify("Path must not be empty.", "warning");
					continue;
				}
				const rule: Rule = { effect, access, scope, path: await canonicalPath(input.trim(), ctx.cwd) };
				if (await ctx.ui.confirm("Add permission rule?", `${describe(rule)}\nDeny rules take precedence. File tools cannot write the policy itself.`)) {
					await saveRule(policyFile, rule);
					ctx.ui.notify("Permission rule saved.", "info");
				}
				continue;
			}
			if (!rules.length) {
				ctx.ui.notify("No saved permission rules.", "info");
				continue;
			}
			// Numbered labels remain unique even if a manually edited policy has duplicates.
			const labels = rules.map((rule, index) => `${index + 1}. ${describe(rule)}`);
			const selected = await ctx.ui.select(action === "Remove rule" ? "Select a rule to remove" : "Saved rules (select to view/remove)", labels);
			const index = selected === undefined ? -1 : labels.indexOf(selected);
			if (index < 0) continue;
			const rule = rules[index];
			if (action === "List rules" && await ctx.ui.select(describe(rule), ["Back", "Remove rule"]) !== "Remove rule") continue;
			if (await ctx.ui.confirm("Remove permission rule?", `${describe(rule)}\nOther matching rules still apply; otherwise access will prompt again.`)) {
				await removeRule(policyFile, rule);
				ctx.ui.notify("Permission rule removed.", "info");
			}
		}
	}

	pi.registerCommand("permissions", {
		description: "List, add, or remove saved allow/deny file permission rules",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			// Share the approval queue so dialogs and policy updates cannot overlap.
			const task = pending.then(() => manage(ctx));
			pending = task.then(() => undefined, () => undefined);
			try {
				await task;
			} catch (error) {
				ctx.ui.notify(`Permission management failed: ${String(error)}`, "error");
			}
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!["bash", "powershell", "read", "edit", "write"].includes(event.toolName)) return;
		const isFile = ["read", "edit", "write"].includes(event.toolName);
		const input = event.input as { path?: unknown };
		let allowed = false;
		if (!isFile || (typeof input.path === "string" && input.path.length > 0)) {
			allowed = await approve(ctx, event.toolName, JSON.stringify(event.input, null, 2), isFile ? {
				access: event.toolName === "read" ? "read" : "write",
				path: input.path as string,
			} : undefined);
		}
		if (!allowed) return {
			block: true,
			reason: `Permission not granted for ${event.toolName}. Do not retry or use another tool to bypass this denial.`,
		};
	});

	pi.on("user_bash", async (event, ctx) => {
		if (await approve(ctx, "shell command (!/!!)", event.command)) return;
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
		if (ctx.hasUI) ctx.ui.setStatus("permissions", "Permissions: read/write rules active; shell approval required");
	});
}
