#!/usr/bin/env python3
"""Baut die Seite: data/manifest.json (Hashes, Nummern) + app.js (JSX vorkompiliert) + index.html.
Fragen liegen in data/<register>.json (Quelle der Wahrheit). Register: tools/registers.json.
Aufruf: python3 tools/build.py   (benoetigt node + @babel/core @babel/preset-react terser, siehe tools/README.md)"""
import json,hashlib,os,subprocess,sys
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
regs=json.load(open(f'{R}/tools/registers.json',encoding='utf-8'))
man={'regs':[],'v':{}}
allnr=set()
for r in regs:
    q=json.load(open(f"{R}/data/{r['file']}",encoding='utf-8'))
    for x in q:
        assert r['min']<=x['nr']<=r['max'],(r['id'],x['nr'])
        assert x['nr'] not in allnr,x['nr']; allnr.add(x['nr'])
        man['v'][str(x['nr'])]=x.get('contentVersion',1)
    raw=open(f"{R}/data/{r['file']}",'rb').read()
    man['regs'].append({**r,'hash':hashlib.md5(raw).hexdigest()[:10],'nrs':sorted(x['nr'] for x in q)})
json.dump(man,open(f'{R}/data/manifest.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
nm=os.environ.get('NODE_PATH') or f'{R}/tools/node_modules'
env={**os.environ,'NODE_PATH':nm if nm.endswith('node_modules') else nm}
subprocess.check_call(['node',f'{R}/tools/compile.js',f'{R}/src/app.jsx',f'{R}/app.js'],env=env)
js=hashlib.md5(open(f'{R}/app.js','rb').read()).hexdigest()[:10]
html=f'''<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FDV R 300 - Frageneinstellungen</title>
<style>
  html, body {{ margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }}
  #root {{ min-height: 100vh; }}
</style>
</head>
<body>
<div id="root"><div style="padding:40px;text-align:center;color:#666;font-size:15px">Lade...</div></div>
<script src="vendor/react.production.min.js"></script>
<script src="vendor/react-dom.production.min.js"></script>
<script src="app.js?v={js}"></script>
</body>
</html>
'''
open(f'{R}/index.html','w',encoding='utf-8').write(html)
print('built',len(allnr),'Fragen,',len(regs),'Register')
