import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type Access = "read" | "write";
export interface Rule {
	access: Access;
	effect: "allow" | "deny";
	path: string;
	scope: "exact" | "tree";
}
export interface Policy {
	version: 1;
	rules: Rule[];
}

// Resolve symlinks, including the existing ancestor of a not-yet-created file.
export async function canonicalPath(input: string, cwd: string): Promise<string> {
	let expanded = input.startsWith("@") ? input.slice(1) : input;
	if (expanded === "~") expanded = homedir();
	else if (expanded.startsWith("~/")) expanded = join(homedir(), expanded.slice(2));
	const absolute = resolve(cwd, expanded);
	async function canonical(path: string): Promise<string> {
		try {
			return await realpath(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = dirname(path);
			if (parent === path) throw error;
			return resolve(await canonical(parent), relative(parent, path));
		}
	}
	return canonical(absolute);
}

export async function loadPolicy(file: string): Promise<Policy> {
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, rules: [] };
		throw error;
	}
	const value = JSON.parse(text);
	if (value?.version !== 1 || !Array.isArray(value.rules) || !value.rules.every((rule: Rule) =>
		rule && (rule.access === "read" || rule.access === "write") &&
		(rule.effect === "allow" || rule.effect === "deny") &&
		(rule.scope === "exact" || rule.scope === "tree") &&
		typeof rule.path === "string" && isAbsolute(rule.path)
	)) throw new Error("Invalid permissions policy; expected version 1 and absolute-path rules");
	return value;
}

export function within(path: string, directory: string): boolean {
	const rel = relative(directory, path);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

export async function decisionFor(policy: Policy, access: Access, path: string): Promise<"allow" | "deny" | undefined> {
	let allowed = false;
	for (const rule of policy.rules) {
		if (rule.access !== access) continue;
		const target = await canonicalPath(rule.path, "/");
		if (rule.scope === "exact" ? target !== path : !within(path, target)) continue;
		if (rule.effect === "deny") return "deny";
		allowed = true;
	}
	return allowed ? "allow" : undefined;
}

export async function saveRule(file: string, rule: Rule): Promise<void> {
	// Re-read before saving so manual edits are picked up. Atomic replacement prevents
	// partial JSON reads; separate Pi processes should not edit this file concurrently.
	const policy = await loadPolicy(file);
	if (!policy.rules.some((r) => JSON.stringify(r) === JSON.stringify(rule))) policy.rules.push(rule);
	await mkdir(dirname(file), { recursive: true });
	const temp = `${file}.${randomUUID()}.tmp`;
	try {
		await writeFile(temp, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600, flag: "wx" });
		await rename(temp, file);
	} finally {
		await unlink(temp).catch(() => {});
	}
}
