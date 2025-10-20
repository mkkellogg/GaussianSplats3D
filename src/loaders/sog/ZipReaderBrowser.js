// Minimal ZIP reader for browser ArrayBuffer input supporting STORE (method 0),
// data descriptor (0x08074b50), and UTF-8 filenames, matching splat-transform writer.

export function unzipStoredEntries(arrayBuffer) {
    const u8 = new Uint8Array(arrayBuffer);
    const dv = new DataView(arrayBuffer);
    const entries = new Map();

    let cursor = 0;
    const size = u8.length;

    const getUint32 = (o) => dv.getUint32(o, true);
    const getUint16 = (o) => dv.getUint16(o, true);

    const SIG_LOCAL = 0x04034b50;
    const SIG_CENTRAL = 0x02014b50;
    const SIG_EOCD = 0x06054b50;
    const SIG_DD = 0x08074b50;

    while (cursor + 30 <= size) {
        const sig = getUint32(cursor);
        if (sig === SIG_CENTRAL || sig === SIG_EOCD) break;
        if (sig !== SIG_LOCAL) break;

        const gpFlags = getUint16(cursor + 6);
        const method = getUint16(cursor + 8);
        const nameLen = getUint16(cursor + 26);
        const extraLen = getUint16(cursor + 28);

        if (method !== 0) {
            throw new Error(`Unsupported ZIP compression method: ${method} (only STORE=0)`);
        }

        const nameBytes = u8.subarray(cursor + 30, cursor + 30 + nameLen);
        const utf8 = (gpFlags & 0x800) !== 0;
        const name = new TextDecoder(utf8 ? 'utf-8' : 'ascii').decode(nameBytes);

        const headerEnd = cursor + 30 + nameLen + extraLen;
        const useDescriptor = (gpFlags & 0x8) !== 0;

        if (!useDescriptor) {
            const sizeUncomp = getUint32(cursor + 22);
            const dataStart = headerEnd;
            const dataEnd = dataStart + sizeUncomp;
            entries.set(name, u8.slice(dataStart, dataEnd));
            cursor = dataEnd;
        } else {
            let pos = headerEnd;
            let found = false;
            while (pos + 16 <= size) {
                if (getUint32(pos) === SIG_DD) {
                    const crc = getUint32(pos + 4); // eslint-disable-line
                    const sizeUncomp = getUint32(pos + 8);
                    const sizeComp = getUint32(pos + 12); // eslint-disable-line
                    const dataStart = headerEnd;
                    const dataEnd = dataStart + sizeUncomp;
                    entries.set(name, u8.slice(dataStart, dataEnd));
                    cursor = pos + 16;
                    found = true;
                    break;
                }
                pos++;
            }
            if (!found) throw new Error('ZIP data descriptor not found');
        }
    }

    return entries;
}
