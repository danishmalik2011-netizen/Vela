(() => {
  "use strict";

  // CRC-32 table for ZIP (store-only) archives.
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Build an uncompressed ZIP archive (spec "store" method) from text files:
  // [{ path, content }]. No external dependency; download-only artifact.
  function createZip(files) {
    const encoder = new TextEncoder();
    const entries = (Array.isArray(files) ? files : [])
      .map((file) => ({
        name: String(file?.path || "file.txt").replace(/\\/g, "/").replace(/^\/+/, "").slice(0, 512),
        data: file?.data instanceof Uint8Array ? file.data : encoder.encode(String(file?.content ?? ""))
      }))
      .filter((file) => file.name && !file.name.includes(".."));

    const chunks = [];
    const central = [];
    let offset = 0;

    const push = (bytes) => { chunks.push(bytes); offset += bytes.length; };
    const u16 = (value) => Uint8Array.of(value & 0xff, (value >> 8) & 0xff);
    const u32 = (value) => Uint8Array.of(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const crc = crc32(entry.data);
      const localOffset = offset;
      // Local file header
      [u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc),
       u32(entry.data.length), u32(entry.data.length), u16(nameBytes.length), u16(0)]
        .forEach(push);
      push(nameBytes);
      push(entry.data);
      central.push({ nameBytes, crc, size: entry.data.length, localOffset });
    }

    const centralStart = offset;
    for (const entry of central) {
      [u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
       u32(entry.crc), u32(entry.size), u32(entry.size),
       u16(entry.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(entry.localOffset)]
        .forEach(push);
      push(entry.nameBytes);
    }
    const centralSize = offset - centralStart;
    [u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
     u32(centralSize), u32(centralStart), u16(0)].forEach(push);

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const archive = new Uint8Array(total);
    let position = 0;
    for (const chunk of chunks) {
      archive.set(chunk, position);
      position += chunk.length;
    }
    return archive;
  }

  globalThis.VelaExport = Object.freeze({ crc32, createZip });
})();
