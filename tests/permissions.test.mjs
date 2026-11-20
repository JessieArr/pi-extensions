import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalPath, decisionFor, loadPolicy, saveRule, within } from "../lib/permission-rules.ts";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-permissions-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function extensionHarness(t, agentDir) {
  const dir = agentDir ?? await fixture(t);
  let source = await readFile(new URL("../extensions/permissions.ts", import.meta.url), "utf8");
  source = source.replace(/import \{ getAgentDir, type ExtensionAPI, type ExtensionContext \} from [^;]+;/,
    `const getAgentDir = () => ${JSON.stringify(dir)};`);
  source = source.replace('"../lib/permission-rules.ts"', JSON.stringify(new URL("../lib/permission-rules.ts", import.meta.url).href));
  const { default: setup } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
  const handlers = new Map();
  const commands = new Map();
  setup({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
  });
  const prompts = [];
  const errors = [];
  const answers = [];
  const ctx = {
    cwd: dir, hasUI: true,
    ui: {
      select: async (title, choices) => {
        prompts.push({ title, choices });
        const answer = answers.shift();
        return typeof answer === "number" ? choices[answer] : answer;
      },
      input: async () => answers.shift(),
      confirm: async () => answers.shift() === true,
      notify: (message) => errors.push(message),
      setStatus() {},
    },
  };
  return {
    dir, ctx, prompts, answers, errors,
    manage: () => commands.get("permissions").handler("", ctx),
    call: (toolName, path) => handlers.get("tool_call")({ toolName, input: { path, command: "echo test" } }, ctx),
    shell: () => handlers.get("user_bash")({ command: "echo test" }, ctx),
  };
}

test("/permissions adds, lists, and removes rules without tool prompts", async (t) => {
  const h = await extensionHarness(t);
  h.answers.push("Add rule", "deny", "write", "tree", "project", true, "Done");
  await h.manage();
  const file = join(h.dir, "permissions.json");
  const rule = { effect: "deny", access: "write", scope: "tree", path: join(h.dir, "project") };
  assert.deepEqual((await loadPolicy(file)).rules, [rule]);
  const count = h.prompts.length;
  assert.equal((await h.call("edit", "project/nested/file")).block, true);
  assert.equal(h.prompts.length, count);
  h.answers.push("List rules", 0, "Remove rule", true, "Done");
  await h.manage();
  assert.deepEqual((await loadPolicy(file)).rules, []);
  assert.ok(h.prompts.some((p) => p.title.includes("0 allowed, 1 denied")));
});

test("/permissions cancellation and empty paths do not save rules", async (t) => {
  const h = await extensionHarness(t);
  h.answers.push("Add rule", "allow", "read", "exact", "file", false, "Done");
  await h.manage();
  h.answers.push("Add rule", "allow", "read", "exact", "   ", "Done");
  await h.manage();
  h.answers.push("Add rule", undefined, "Done");
  await h.manage();
  assert.deepEqual((await loadPolicy(join(h.dir, "permissions.json"))).rules, []);
  assert.ok(h.errors.includes("Path must not be empty."));
});

test("/permissions fails safely on malformed policy and works without UI", async (t) => {
  const h = await extensionHarness(t);
  const file = join(h.dir, "permissions.json");
  await writeFile(file, "broken");
  await h.manage();
  assert.match(h.errors[0], /Permission management failed/);
  assert.equal(await readFile(file, "utf8"), "broken");
  h.ctx.hasUI = false;
  await h.manage();
  assert.equal(h.prompts.length, 0);
});

test("path boundaries and symlinked new-file parents", async (t) => {
  const dir = await fixture(t);
  await mkdir(join(dir, "real"));
  await symlink(join(dir, "real"), join(dir, "alias"));
  assert.equal(await canonicalPath("@alias/new/file", dir), join(dir, "real/new/file"));
  assert.equal(within("/work/project/file", "/work/project"), true);
  assert.equal(within("/work/project-other/file", "/work/project"), false);
});

test("rules persist, separate reads/writes, and deny wins over tree allow", async (t) => {
  const dir = await fixture(t);
  const file = join(dir, "policy.json");
  assert.deepEqual(await loadPolicy(file), { version: 1, rules: [] });
  await saveRule(file, { access: "read", effect: "allow", path: dir, scope: "tree" });
  await saveRule(file, { access: "read", effect: "deny", path: join(dir, "secret"), scope: "exact" });
  const policy = await loadPolicy(file);
  assert.equal(await decisionFor(policy, "read", join(dir, "other")), "allow");
  assert.equal(await decisionFor(policy, "write", join(dir, "other")), undefined);
  assert.equal(await decisionFor(policy, "read", join(dir, "secret")), "deny");
  await writeFile(file, '{"version":1,"rules":[{}]}');
  await assert.rejects(loadPolicy(file), /Invalid permissions/);
});

test("exact read approval persists across extension instances, not writes or other files", async (t) => {
  const h = await extensionHarness(t);
  h.answers.push(2);
  assert.equal(await h.call("read", "hosts"), undefined);
  assert.equal(h.prompts[0].choices[0], "Allow once");
  assert.equal(h.prompts[0].choices[2], `Always Allow Reading ${h.dir}/hosts`);
  assert.equal(await h.call("read", "hosts"), undefined);
  assert.equal(h.prompts.length, 1);
  h.answers.push("Deny once", "Deny once");
  assert.equal((await h.call("write", "hosts")).block, true);
  assert.equal((await h.call("read", "other")).block, true);
  const restarted = await extensionHarness(t, h.dir);
  restarted.ctx.hasUI = false;
  assert.equal(await restarted.call("read", "hosts"), undefined);
  assert.equal(restarted.prompts.length, 0);
});

test("parent write approval covers edit/write descendants, not sibling prefixes or reads", async (t) => {
  const h = await extensionHarness(t);
  h.answers.push(4);
  assert.equal(await h.call("write", "project/file"), undefined);
  assert.equal(h.prompts[0].choices[4], `Always Allow Writing In ${h.dir}/project`);
  assert.equal(await h.call("edit", "project/nested/file"), undefined);
  h.answers.push("Deny once", "Deny once");
  assert.equal((await h.call("write", "project-other/file")).block, true);
  assert.equal((await h.call("read", "project/file")).block, true);
});

test("always deny persists and manual policy changes are re-read", async (t) => {
  const h = await extensionHarness(t);
  h.answers.push(3);
  assert.equal((await h.call("read", "secret")).block, true);
  assert.equal((await h.call("read", "secret")).block, true);
  assert.equal(h.prompts.length, 1);
  await writeFile(join(h.dir, "permissions.json"), '{"version":1,"rules":[]}');
  h.answers.push("Allow once");
  assert.equal(await h.call("read", "secret"), undefined);
  assert.equal(h.prompts.length, 2);
});

test("shell always prompts and never offers persistent options", async (t) => {
  const h = await extensionHarness(t);
  await saveRule(join(h.dir, "permissions.json"), { access: "write", effect: "allow", path: h.dir, scope: "tree" });
  h.answers.push("Allow once", "Deny once", "Allow once", "Deny once");
  assert.equal(await h.call("bash"), undefined);
  assert.equal((await h.call("powershell")).block, true);
  assert.equal(await h.shell(), undefined);
  assert.equal((await h.shell()).result.cancelled, true);
  assert.equal(h.prompts.length, 4);
  for (const prompt of h.prompts) assert.deepEqual(prompt.choices, ["Allow once", "Deny once"]);
});

test("cancellation, missing UI, malformed policy, and self-policy writes fail closed", async (t) => {
  const h = await extensionHarness(t);
  assert.equal((await h.call("read", "file")).block, true);
  h.ctx.hasUI = false;
  assert.equal((await h.call("read", "file")).block, true);
  h.ctx.hasUI = true;
  await writeFile(join(h.dir, "permissions.json"), "invalid json");
  assert.equal((await h.call("read", "file")).block, true);
  assert.equal(h.errors.length, 1);
  assert.equal((await h.call("write", "permissions.json")).block, true);
});

test("concurrent approvals check the freshly saved rule before prompting again", async (t) => {
  const h = await extensionHarness(t);
  h.answers.push(2);
  const results = await Promise.all([h.call("read", "file"), h.call("read", "file")]);
  assert.deepEqual(results, [undefined, undefined]);
  assert.equal(h.prompts.length, 1);
});
