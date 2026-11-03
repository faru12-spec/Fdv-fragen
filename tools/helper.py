"""Neue Fragen erzeugen und ins passende Register (data/*.json) schreiben, danach build.py aufrufen.
Beispiel (Skript kNN.py):
    from helper import setup, add, run
    setup('R 300.6','Zugfahrten, Ziff.')
    add('5.1','Thema','Frage mit § ?','richtig',['f1','f2','f3'],'Zitat aus dem Reglement')
    run(seed=1, new_reg=('r6k7','R 300.6 K7','R 300.6 ZUGFAHRTEN - KAP. 7'))   # new_reg nur bei neuem Kapitel
'''§ wird zu 'gemäss FDV R 300.x, Ziff. z'."""
import json,os,random,re,subprocess,sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_cfg={}; _items=[]
def setup(doc,fdv_prefix): _cfg.update(doc=doc,pre=fdv_prefix)
def add(z,topic,q,good,bad,fdv):
    assert len(bad)==3,(z,topic)
    q=re.sub(r' +',' ',q.replace('§',f"gemäss FDV {_cfg['doc']}, Ziff. {z}")).replace(' ?','?').strip()
    assert q.endswith('?'),q
    _items.append((f"{_cfg['doc']} Ziff. {z} - {topic}",q,good,bad,f"{_cfg['pre']} {z} - {fdv}"))
def run(seed=1,new_reg=None):
    regs=json.load(open(f'{R}/tools/registers.json',encoding='utf-8'))
    data={r['id']:json.load(open(f"{R}/data/{r['file']}",encoding='utf-8')) for r in regs}
    nr=max(x['nr'] for d in data.values() for x in d)+1; first=nr
    rnd=random.Random(seed); new=[]
    for term,q,good,bad,fdv in _items:
        o=[(good,True)]+[(b,False) for b in bad]; rnd.shuffle(o)
        new.append({'nr':nr,'p':1,'term':term,'approved':False,'q':q,
          'opts':[{'l':'ABCD'[i],'t':t,'c':c} for i,(t,c) in enumerate(o)],'fdv':fdv,'note':'',
          'optTags':{l:[] for l in 'ABCD'},'optNotes':{l:'' for l in 'ABCD'},'contentVersion':2}); nr+=1
    if new_reg:
        rid,label,title=new_reg
        regs.append({'id':rid,'label':label,'title':title,'file':rid+'.json','min':first,'max':nr-1}); data[rid]=[]
    else:
        regs[-1]['max']=nr-1
    data[regs[-1]['id']]+=new
    for r in regs: json.dump(data[r['id']],open(f"{R}/data/{r['file']}",'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
    json.dump(regs,open(f'{R}/tools/registers.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
    subprocess.check_call([sys.executable,f'{R}/tools/build.py'])
    print(f'{len(new)} neue Fragen, nr {first}-{nr-1}')
