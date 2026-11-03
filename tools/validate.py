import json,os,sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bad=[];seen=set()
for r in json.load(open(f'{R}/tools/registers.json',encoding='utf-8')):
    for x in json.load(open(f"{R}/data/{r['file']}",encoding='utf-8')):
        o=x['opts']
        if x['nr']<624: ok=len(o)>=2 and any(a['c'] for a in o)
        else: ok=len(o)==4 and sum(1 for a in o if a['c'])==1
        if x['nr'] in seen or not ok or (x['nr']>=624 and (not x['q'].endswith('?') or len({a['t'] for a in o})!=4)): bad.append(x['nr'])
        seen.add(x['nr'])
print('bad:',bad,'total',len(seen)); sys.exit(1 if bad else 0)
