"""Docx-Inhalt in Dokumentreihenfolge ausgeben: python3 -I tools/dump.py datei.docx [von bis]  (Tabellen-Indizes)"""
import sys,docx
from docx.table import Table
from docx.text.paragraph import Paragraph
d=docx.Document(sys.argv[1])
lo=int(sys.argv[2]) if len(sys.argv)>2 else 0; hi=int(sys.argv[3]) if len(sys.argv)>3 else 10**6
ti=-1
for el in d.element.body.iterchildren():
    if el.tag.endswith('}p'):
        t=Paragraph(el,d).text.strip()
        if t and lo<=ti<=hi and False: print('P:',t)
    elif el.tag.endswith('}tbl'):
        ti+=1
        if not(lo<=ti<=hi): continue
        T=Table(el,d); print(f'=== TABLE {ti} ===')
        for r in T.rows:
            seen=[];cells=[]
            for c in r.cells:
                if c._tc in seen: continue
                seen.append(c._tc); cells.append(c.text.strip().replace('\n',' / '))
            print(' | '.join(cells))
print('tables total',ti+1)
