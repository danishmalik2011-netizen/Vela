import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/services/export.js", import.meta.url), "utf8");
const context = vm.createContext({ TextEncoder });
vm.runInContext(source, context);
const zip = context.VelaExport;

test("crc32 matches the canonical value for a known payload", () => {
  assert.equal(zip.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("createZip emits a valid store-only archive", () => {
  const bytes = zip.createZip([
    { path: "index.html", content: "<h1>Hi</h1>" },
    { path: "src/app.js", content: "console.log('ok')" }
  ]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Local file header signature
  assert.equal(view.getUint32(0, true), 0x04034b50);
  // Filename is embedded
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /index\.html/);
  assert.match(text, /src\/app\.js/);
  // End of central directory record
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), 2); // entry count
});

test("createZip sanitizes unsafe paths and skips empty names", () => {
  const bytes = zip.createZip([{ path: "../evil.txt", content: "x" }]);
  assert.equal(bytes.length, 22); // only the end record remains
});
