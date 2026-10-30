import struct,sys
def parse(path):
    d=open(path,'rb').read()
    assert d[:3]==b'MBS'
    rows,cols,idx_off,type_off,data_off,x20,pool=struct.unpack_from('<7I',d,12)
    ids=struct.unpack_from('<%dI'%rows,d,idx_off)
    types=d[type_off:d.index(0,type_off)].decode()
    assert len(types)==cols,(len(types),cols)
    p=data_off; out=[]
    for r in range(rows):
        row=[]
        for t in types:
            if t=='u': row.append(struct.unpack_from('<I',d,p)[0]); p+=4
            elif t=='f': row.append(round(struct.unpack_from('<f',d,p)[0],4)); p+=4
            else:
                off,ln=struct.unpack_from('<IH',d,p); p+=6
                row.append(d[off:off+ln].decode('utf8','replace'))
        out.append((ids[r],row))
    return types,out,p
if __name__=='__main__':
    t,o,p=parse(sys.argv[1]); print(t,len(o),'rows; ended at',p)
    for i,r in o[:int(sys.argv[2]) if len(sys.argv)>2 else 5]: print(i,r)
