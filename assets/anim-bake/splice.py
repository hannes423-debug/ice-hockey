import re, sys, io

HTML = '/home/sara/Työpöytä/hoki/game/ice_hockey.html'
b64 = open(sys.argv[1]).read().strip()
s = io.open(HTML, encoding='utf-8').read()
m = re.search(r'(const ANIM_B64=")([A-Za-z0-9+/=]+)(")', s)
assert m, 'ANIM_B64 not found'
old = m.group(2)
s2 = s[:m.start(2)] + b64 + s[m.end(2):]
assert s2.count('const ANIM_B64="') == 1
io.open(HTML, 'w', encoding='utf-8').write(s2)
print('ANIM_B64 %d -> %d chars (html %d -> %d bytes)' % (len(old), len(b64), len(s), len(s2)))
