import json, struct

def read_glb(path):
    buf = open(path, 'rb').read()
    magic, ver, length = struct.unpack('<III', buf[:12])
    off = 12; js = None; bin_ = b''
    while off < len(buf):
        clen, ctype = struct.unpack('<II', buf[off:off+8]); off += 8
        chunk = buf[off:off+clen]; off += clen
        if ctype == 0x4E4F534A: js = json.loads(chunk.decode('utf-8'))
        elif ctype == 0x004E4942: bin_ = chunk
    return js, bin_

def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = bin_ + b'\0' * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(bb)
    out = struct.pack('<III', 0x46546C67, 2, total)
    out += struct.pack('<II', len(jb), 0x4E4F534A) + jb
    out += struct.pack('<II', len(bb), 0x004E4942) + bb
    open(path, 'wb').write(out)
    return total

CT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

def read_accessor(js, bin_, idx):
    a = js['accessors'][idx]
    bv = js['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = a['count'] * NC[a['type']]
    fmt = '<%d%s' % (n, CT[a['componentType']])
    vals = struct.unpack_from(fmt, bin_, off)
    nc = NC[a['type']]
    return [vals[i*nc:(i+1)*nc] for i in range(a['count'])]
