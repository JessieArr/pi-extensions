import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";

// Point at Pi's host-provided pi-tui module to exercise real ANSI/wide-text wrapping.
const modulePath = process.env.PI_TUI_MODULE;
test("large permission previews remain bounded, scrollable, and cancellable", { skip: !modulePath && "Set PI_TUI_MODULE to Pi's pi-tui/dist/index.js" }, async () => {
  const source = (await readFile(new URL("../lib/permission-prompt.ts", import.meta.url), "utf8"))
    .replace('"@earendil-works/pi-tui"', JSON.stringify(pathToFileURL(modulePath).href));
  const { permissionPrompt } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
  const { visibleWidth } = await import(pathToFileURL(modulePath).href);
  const keys = { matches: (data, action) => data === ({ "tui.select.up": "up", "tui.select.down": "down", "tui.select.confirm": "enter", "tui.select.cancel": "escape" })[action] };
  let component;
  let options;
  let renders = 0;
  const controller = new AbortController();
  const terminal = { rows: 24 };
  const ctx = {
    mode: "tui", signal: controller.signal,
    ui: { custom: (factory, opts) => {
      options = opts;
      return new Promise((resolve) => { component = factory({ terminal, requestRender: () => renders++ }, { fg: (_, s) => s }, keys, resolve); });
    } },
  };
  const choices = ["Allow once", "Deny once", "Always allow", "Always deny", "Allow parent"];
  const details = "START\n" + "界🙂long text ".repeat(20000) + "\nLAST\n\x1b[2J";
  const result = permissionPrompt(ctx, "Permission required: write", details, choices);
  assert.equal(options.blocked.kind, "permission");
  function render(width) {
    const lines = component.render(width);
    assert.ok(lines.length <= terminal.rows);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
    return lines.join("\n");
  }
  assert.match(render(80), /START/);
  assert.match(render(80), /> Allow once/);
  component.handleInput("\x1b[6~"); // Page Down
  assert.doesNotMatch(render(80), /START/);
  component.handleInput("\x1b[F"); // End
  assert.match(render(80), /LAST/);
  assert.match(render(80), /\\u001b\[2J/);
  terminal.rows = 10;
  render(20);
  terminal.rows = 4;
  render(12);
  terminal.rows = 24;
  component.handleInput("down");
  assert.match(render(80), /> Deny once/);
  component.handleInput("enter");
  assert.equal(await result, "Deny once");
  component.dispose();
  assert.ok(renders > 0);

  const cancelled = permissionPrompt(ctx, "Permission", "details", choices);
  controller.abort();
  assert.equal(await cancelled, undefined);
  component.dispose();
});
