// usage: node compile.js src/app.jsx out.js   (needs @babel/core, @babel/preset-react, terser via NODE_PATH)
const babel=require('@babel/core'),fs=require('fs');
(async()=>{
const src=fs.readFileSync(process.argv[2],'utf8');
let code=babel.transformSync(src,{presets:[["@babel/preset-react",{runtime:"classic"}]],filename:"app.jsx",compact:false}).code;
try{const {minify}=require('terser');code=(await minify(code,{compress:true,mangle:true})).code;}catch(e){console.error('terser skipped',e.message)}
fs.writeFileSync(process.argv[3],code);console.log('app.js',code.length);
})();
