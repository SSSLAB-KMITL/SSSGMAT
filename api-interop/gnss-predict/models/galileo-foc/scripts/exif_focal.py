"""Print FocalLength / FocalLengthIn35mm from JPEG EXIF (read-only, stdlib only)."""
import struct, sys

def read_exif(path):
    with open(path, 'rb') as f:
        data = f.read(256 * 1024)
    i = 2
    while i < len(data) - 4:
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        ln = struct.unpack('>H', data[i + 2:i + 4])[0]
        if marker == 0xE1 and data[i + 4:i + 10] == b'Exif\x00\x00':
            return data[i + 10:i + 2 + ln]
        i += 2 + ln
    return None

def parse(t):
    e = '<' if t[:2] == b'II' else '>'
    def u16(o): return struct.unpack(e + 'H', t[o:o + 2])[0]
    def u32(o): return struct.unpack(e + 'I', t[o:o + 4])[0]
    def ifd(o):
        out = {}
        for k in range(u16(o)):
            p = o + 2 + 12 * k
            out[u16(p)] = (u16(p + 2), u32(p + 4), p + 8)
        return out
    res = {}
    d0 = ifd(u32(4))
    if 0x8769 in d0:
        ex = ifd(d0[0x8769][2] and u32(d0[0x8769][2]))
        if 0x920A in ex:
            off = u32(ex[0x920A][2])
            res['FocalLength_mm'] = u32(off) / u32(off + 4)
        if 0xA405 in ex:
            res['FocalLength35mm'] = u16(ex[0xA405][2])
    return res

for p in sys.argv[1:]:
    t = read_exif(p)
    print(p.split('/')[-1], parse(t) if t else 'no exif')
