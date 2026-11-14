# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent uint32 Jenkins reference, never imported by production extraction."""
import struct
def word(value):return struct.unpack("=I",struct.pack("=f",value))[0]
def f32(value):return struct.unpack("=f",struct.pack("=f",value))[0]
def hash_words(words):
    mask=0xffffffff
    rot=lambda x,n:((x<<n)|(x>>(32-n)))&mask
    a=b=c=(0xdeadbeef+(len(words)<<2)+13)&mask
    a=(a+words[0])&mask
    if len(words)>1:b=(b+words[1])&mask
    if len(words)>2:c=(c+words[2])&mask
    if len(words)==4:
        a=((a-c)^rot(c,4))&mask;c=(c+b)&mask
        b=((b-a)^rot(a,6))&mask;a=(a+c)&mask
        c=((c-b)^rot(b,8))&mask;b=(b+a)&mask
        a=((a-c)^rot(c,16))&mask;c=(c+b)&mask
        b=((b-a)^rot(a,19))&mask;a=(a+c)&mask
        c=((c-b)^rot(b,4))&mask;b=(b+a)&mask
        a=(a+words[3])&mask
    c=((c^b)-rot(b,14))&mask;a=((a^c)-rot(c,11))&mask;b=((b^a)-rot(a,25))&mask
    c=((c^b)-rot(b,16))&mask;a=((a^c)-rot(c,4))&mask;b=((b^a)-rot(a,14))&mask;c=((c^b)-rot(b,24))&mask
    return c
def scalar_hash(words):return word(f32(f32(hash_words(words))/f32(0xffffffff)))
def expected(words,output):
    if output=='Value':return [scalar_hash(words)]*3+[word(1)]
    if len(words)<=3:seeds=[words,words+[word(1)],words+[word(2)]]
    else:
        x,y,z,w=words;seeds=[words,[z,x,w,y],[w,z,y,x]]
    return [scalar_hash(seed)for seed in seeds]+[word(1)]
