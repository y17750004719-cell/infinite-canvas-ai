export function getImageDimensionsFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) {
    return null;
  }

  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return {
      naturalWidth: buffer.readUInt32BE(16),
      naturalHeight: buffer.readUInt32BE(20),
    };
  }

  if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return {
      naturalWidth: buffer.readUInt16LE(6),
      naturalHeight: buffer.readUInt16LE(8),
    };
  }

  return null;
}
