const fs = require('node:fs');
const path = require('node:path');

const size = 256;
const headerSize = 40;
const pixelBytes = size * size * 4;
const maskStride = Math.ceil(size / 32) * 4;
const maskBytes = maskStride * size;
const image = Buffer.alloc(headerSize + pixelBytes + maskBytes);

image.writeUInt32LE(headerSize, 0);
image.writeInt32LE(size, 4);
image.writeInt32LE(size * 2, 8);
image.writeUInt16LE(1, 12);
image.writeUInt16LE(32, 14);
image.writeUInt32LE(pixelBytes, 20);

const bars = [
  { x: 48, width: 20, height: 68 },
  { x: 82, width: 20, height: 132 },
  { x: 116, width: 20, height: 188 },
  { x: 150, width: 20, height: 132 },
  { x: 184, width: 20, height: 68 }
];
const top = (size - 188) / 2;
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    if (!bars.some(bar => x >= bar.x && x < bar.x + bar.width && y >= top + 188 - bar.height && y < top + 188)) continue;
    const offset = headerSize + ((size - 1 - y) * size + x) * 4;
    image[offset] = 108;
    image[offset + 1] = 243;
    image[offset + 2] = 199;
    image[offset + 3] = 255;
  }
}

const directory = Buffer.alloc(22);
directory.writeUInt16LE(0, 0);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(1, 4);
directory.writeUInt8(0, 6);
directory.writeUInt8(0, 7);
directory.writeUInt8(0, 8);
directory.writeUInt8(0, 9);
directory.writeUInt16LE(1, 10);
directory.writeUInt16LE(32, 12);
directory.writeUInt32LE(image.length, 14);
directory.writeUInt32LE(directory.length, 18);

const iconPath = path.join(__dirname, '..', 'assets', 'room-tone.ico');
fs.mkdirSync(path.dirname(iconPath), { recursive: true });
fs.writeFileSync(iconPath, Buffer.concat([directory, image]));
