import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

/** A deterministic RGB pattern, generated without datasets, checkpoints or image libraries. */
export function syntheticPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const stride = width * 3 + 1;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + 1 + x * 3;
      pixels[offset] = x % 256;
      pixels[offset + 1] = y % 256;
      pixels[offset + 2] = (x + y) % 256;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function syntheticTiff(): Buffer {
  const tags = [
    [256, 4, 32],
    [257, 4, 32],
    [258, 3, 8],
    [259, 3, 1],
    [262, 3, 1],
    [273, 4, 8 + 2 + 9 * 12 + 4],
    [277, 3, 1],
    [278, 4, 32],
    [279, 4, 32 * 32],
  ] as const;
  const imageOffset = 8 + 2 + tags.length * 12 + 4;
  const bytes = Buffer.alloc(imageOffset + 32 * 32);
  bytes.write("II");
  bytes.writeUInt16LE(42, 2);
  bytes.writeUInt32LE(8, 4);
  bytes.writeUInt16LE(tags.length, 8);
  tags.forEach(([tag, type, value], index) => {
    const offset = 10 + index * 12;
    bytes.writeUInt16LE(tag, offset);
    bytes.writeUInt16LE(type, offset + 2);
    bytes.writeUInt32LE(1, offset + 4);
    bytes.writeUInt32LE(value, offset + 8);
  });
  for (let index = imageOffset; index < bytes.length; index += 1) bytes[index] = index % 256;
  return bytes;
}

export function prepareE2EFixtures(directory: string) {
  mkdirSync(directory, { recursive: true });
  const highres = syntheticPng(3000, 2400);
  writeFileSync(resolve(directory, "panel-3000.png"), highres);
  writeFileSync(resolve(directory, "panel.tiff"), syntheticTiff());
  const small = syntheticPng(32, 32);
  // A valid PNG followed by padding: the client must reject its byte size before decoding.
  const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);
  small.copy(oversized);
  writeFileSync(resolve(directory, "over20MB.png"), oversized);
  return directory;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const directory = resolve(
    process.env["SOLARVISION_E2E_FIXTURE_DIR"] || resolve(frontend, ".e2e-local/fixtures"),
  );
  console.log(`Generated synthetic E2E images in ${prepareE2EFixtures(directory)}`);
}
