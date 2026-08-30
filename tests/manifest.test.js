const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

test("Manifest V3 permission surface matches accepted ADRs exactly", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ["storage"]);
  assert.deepEqual([...manifest.host_permissions].sort(), [
    "https://api.sleeper.app/*",
    "https://api.sleeper.com/*",
  ]);
  const forbidden = ["cookies", "identity", "management", "webRequest", "downloads", "tabs", "clipboardRead", "clipboardWrite"];
  assert.ok(forbidden.every((permission) => !manifest.permissions.includes(permission)));
  assert.equal(manifest.externally_connectable, undefined);
});

test("content scripts are restricted to accepted Sleeper draft surfaces", () => {
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://sleeper.com/draft/*",
    "https://sleeper.com/draftboards*",
    "https://sleeper.com/leagues/*/predraft*",
    "https://sleeper.com/mock-drafts/*",
  ]);
  assert.ok(manifest.content_scripts[0].matches.every((match) => match.startsWith("https://sleeper.com/")));
});

test("all manifest and extension-page resources are local and present", () => {
  const references = [
    manifest.action.default_popup,
    manifest.background.service_worker,
    manifest.options_ui.page,
    "extension/draft.html",
    ...manifest.content_scripts.flatMap((entry) => entry.js),
    ...manifest.content_scripts.flatMap((entry) => entry.css || []),
  ];
  for (const reference of references) {
    assert.equal(/^https?:/i.test(reference), false, `${reference} must be local`);
    assert.equal(fs.existsSync(path.join(ROOT, reference)), true, `${reference} must exist`);
  }

  for (const htmlPath of [manifest.action.default_popup, manifest.options_ui.page, "extension/editor.html", "extension/draft.html"]) {
    const html = fs.readFileSync(path.join(ROOT, htmlPath), "utf8");
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map((match) => match[1]);
    assert.ok(scripts.length > 0);
    assert.equal(/<script(?!\s+src=)[^>]*>/i.test(html), false, `${htmlPath} cannot contain inline script`);
    for (const script of scripts) {
      assert.equal(/^https?:/i.test(script), false, `${script} must be local`);
      assert.equal(fs.existsSync(path.resolve(path.dirname(path.join(ROOT, htmlPath)), script)), true, `${script} must exist`);
    }
  }
});

test("extension service and content entry contain no write-network request", () => {
  for (const relative of ["extension/background.js", "src/content-entry.js", "extension/setup.js", "extension/editor.js", "extension/draft.js"]) {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.equal(/method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i.test(source), false, `${relative} cannot write over HTTP`);
  }
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-eval/i);
  assert.match(
    manifest.content_security_policy.extension_pages,
    /connect-src https:\/\/api\.sleeper\.app https:\/\/api\.sleeper\.com/,
  );
});
