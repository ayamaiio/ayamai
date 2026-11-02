// Dependency-free ZIP (store compression) for installing the unpacked extension.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const files = ["manifest.json", "background.js", "capture.html", "capture.js", "source.js", "README.md"];
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const entries = [], directory = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(`browser-capture/${file}`);
  const bytes = readFileSync(`${root}extensions/browser-capture/${file}`);
  const crc = crc32(bytes);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
  header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18);
  header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26);
  entries.push(header, name, bytes);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20);
  central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42); directory.push(central, name);
  offset += header.length + name.length + bytes.length;
}
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(Buffer.concat(directory).length, 12); end.writeUInt32LE(offset, 16);
const out = `${root}artifacts/private-media-library/public/browser-capture.zip`;
mkdirSync(`${root}artifacts/private-media-library/public`, { recursive: true });
writeFileSync(out, Buffer.concat([...entries, ...directory, end]));
