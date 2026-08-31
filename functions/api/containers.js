
const DATASET_ID = "separate-collection";
const PACKAGE_URL = `https://urbandata.sofia.bg/api/3/action/package_show?id=${encodeURIComponent(DATASET_ID)}`;

function clean(v){ return String(v ?? "").replace(/^\uFEFF/,"").trim(); }

function detectDelimiter(text){
  const first=(text.split(/\r?\n/).find(x=>x.trim())||"");
  const counts=[[",",(first.match(/,/g)||[]).length],[";",(first.match(/;/g)||[]).length],["\t",(first.match(/\t/g)||[]).length]]
    .sort((a,b)=>b[1]-a[1]);
  return counts[0][1] ? counts[0][0] : ",";
}

function parseCSV(text){
  const delim=detectDelimiter(text);
  const rows=[]; let row=[], cell="", q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(q){
      if(c === '"' && n === '"'){ cell+='"'; i++; }
      else if(c === '"'){ q=false; }
      else cell+=c;
    }else{
      if(c === '"') q=true;
      else if(c === delim){ row.push(cell); cell=""; }
      else if(c === "\n"){ row.push(cell); rows.push(row); row=[]; cell=""; }
      else if(c !== "\r") cell+=c;
    }
  }
  if(cell.length || row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r=>r.some(c=>clean(c)!==""));
}

function num(v){
  const s=clean(v).replace(/\s/g,"").replace(",",".");
  if(!s) return null;
  const x=Number(s);
  return Number.isFinite(x) ? x : null;
}

function positiveCount(v){
  const n=num(v);
  if(n!=null) return Math.max(0,Math.round(n));
  const s=clean(v);
  if(!s || /^(не|няма|0|-|n\/a)$/i.test(s)) return 0;
  const m=s.match(/\d+/);
  if(m) return Math.max(0,Number(m[0]));
  // Non-empty marker such as "x"/"да" means one unit.
  return 1;
}

function coord(obj){
  const keys=Object.keys(obj);
  function find(res){
    for(const k of keys) if(res.some(r=>r.test(k.toLowerCase()))) return k;
    return null;
  }
  const latK=find([/^lat$/, /latitude/, /ширина/]);
  const lngK=find([/^long$/, /^lon$/, /^lng$/, /longitude/, /дължина/]);
  let lat=latK ? num(obj[latK]) : null;
  let lng=lngK ? num(obj[lngK]) : null;
  if(lat!=null && lng!=null && lat>=42.3 && lat<=43.0 && lng>=22.8 && lng<=24.0) return {lat,lng};
  return null;
}

function findField(obj,res){
  for(const [k,v] of Object.entries(obj)){
    if(res.some(r=>r.test(k.toLowerCase()))) return clean(v);
  }
  return "";
}

function typeFromColumn(k){
  const s=k.toLowerCase();
  if(/sin|син|paper|hart|харт|karton|картон/.test(s)) return "Хартия и картон";
  if(/zelen|зелен|glass|stak|стък/.test(s)) return "Стъкло";
  if(/zhalt|жълт|plastic|plast|пласт|metal|метал/.test(s)) return "Пластмаса и метал";
  return null;
}

function resourceKind(name){
  const s=clean(name).toLowerCase();
  if(s.includes("ecobulpack")) return "ecobulpack";
  if(s.includes("bulecopack")) return "bulecopack";
  if(s.includes("ecopack")) return "ecopack";
  return "other";
}

function expandRow(obj, resourceName, sourceRow){
  const c=coord(obj);
  if(!c) return [];
  const address=findField(obj,[/adres/,/address/]);
  const district=findField(obj,[/rajon/,/district/,/район/]);
  const operator=resourceKind(resourceName);
  const out=[];

  const pushUnits=(type,count,model="")=>{
    for(let i=0;i<count;i++){
      out.push({
        lat:c.lat,lng:c.lng,address,type,district,
        operator,source:resourceName||"",sourceRow,
        unitIndex:i,model
      });
    }
  };

  if(operator==="ecopack"){
    // Official schema: sin, zhalt, zelen are counts at the same address.
    for(const [k,v] of Object.entries(obj)){
      const type=typeFromColumn(k);
      if(!type) continue;
      const count=positiveCount(v);
      if(count) pushUnits(type,count,k);
    }
    return out;
  }

  if(operator==="ecobulpack"){
    // Official schema contains separate model/count columns such as:
    // iglu_zhalto_1700l, iglu_zeleno_1400l, bobar_zhalt_1100l,
    // iglu_sinyo_1100l, iglu_zeleno_1100l, etc.
    for(const [k,v] of Object.entries(obj)){
      const type=typeFromColumn(k);
      if(!type) continue;
      const count=positiveCount(v);
      if(count) pushUnits(type,count,k);
    }
    return out;
  }

  if(operator==="bulecopack"){
    // Official schema currently exposes a two-container yellow/green model.
    for(const [k,v] of Object.entries(obj)){
      const low=k.toLowerCase();
      if(/dvukonteyneren.*zhalt.*zelen|двуконтейнер.*жълт.*зелен/.test(low)){
        const sets=positiveCount(v);
        if(sets){
          pushUnits("Пластмаса и метал",sets,k);
          pushUnits("Стъкло",sets,k);
        }
      }else{
        const type=typeFromColumn(k);
        if(type){
          const count=positiveCount(v);
          if(count) pushUnits(type,count,k);
        }
      }
    }
    return out;
  }

  // Generic fallback for future resource schemas.
  for(const [k,v] of Object.entries(obj)){
    const type=typeFromColumn(k);
    if(!type) continue;
    const count=positiveCount(v);
    if(count) pushUnits(type,count,k);
  }
  return out;
}

function csvResourceScore(r){
  const fmt=clean(r.format).toLowerCase(), url=clean(r.url).toLowerCase(), name=clean(r.name).toLowerCase();
  let score=0;
  if(fmt.includes("csv")) score+=100;
  if(url.includes(".csv")) score+=70;
  if(name.includes(".csv")) score+=30;
  if(name.includes("colored") || name.includes("container") || name.includes("контейнер")) score+=10;
  return score;
}

async function fetchText(url){
  const r=await fetch(url,{headers:{"User-Agent":"EdrOgabaritni-Sofia/3.0"}});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

export async function onRequestGet({request}){
  const cache=caches.default;
  const force=new URL(request.url).searchParams.get("refresh")==="1";
  const cacheKey=new Request(new URL("/__cache/separate-containers-expanded-v1",request.url),request);
  if(!force){
    const c=await cache.match(cacheKey);
    if(c) return c;
  }

  try{
    const pr=await fetch(PACKAGE_URL,{headers:{"User-Agent":"EdrOgabaritni-Sofia/3.0"}});
    if(!pr.ok) throw new Error(`CKAN HTTP ${pr.status}`);
    const pj=await pr.json();
    if(!pj.success) throw new Error("CKAN success=false");
    const pkg=pj.result;

    const resources=(pkg.resources||[])
      .map(r=>({r,score:csvResourceScore(r)}))
      .filter(x=>x.score>=100)
      .sort((a,b)=>b.score-a.score)
      .map(x=>x.r);

    const containers=[];
    const sourceStats=[];

    for(const resource of resources){
      try{
        const text=await fetchText(resource.url);
        const rows=parseCSV(text);
        if(rows.length<2) continue;
        const headers=rows[0].map(clean);
        let acceptedRows=0, units=0;

        for(let i=1;i<rows.length;i++){
          const vals=rows[i], obj={};
          headers.forEach((h,idx)=>obj[h]=vals[idx] ?? "");
          const expanded=expandRow(obj,resource.name||"",i);
          if(expanded.length){
            acceptedRows++;
            units+=expanded.length;
            containers.push(...expanded);
          }
        }

        sourceStats.push({
          name:resource.name||"",
          rows:Math.max(0,rows.length-1),
          acceptedRows,
          containers:units,
          headers
        });
      }catch(e){
        sourceStats.push({name:resource.name||"",containers:0,error:String(e)});
      }
    }

    const payload={
      containers,
      meta:{
        dataset_id:DATASET_ID,
        dataset_title:pkg.title||"Контейнери за разделно събиране на територията на София",
        dataset_page:`https://urbandata.sofia.bg/dataset/${DATASET_ID}`,
        dataset_metadata_modified:pkg.metadata_modified||"",
        checked_at:new Date().toISOString(),
        count:containers.length,
        sources:sourceStats,
        semantics:"Each returned record represents one physical container inferred from the official count/model columns."
      }
    };

    const response=Response.json(payload,{
      headers:{
        "Cache-Control":"public, max-age=300, s-maxage=86400",
        "CDN-Cache-Control":"max-age=86400"
      }
    });
    await cache.put(cacheKey,response.clone());
    return response;
  }catch(e){
    return Response.json({error:String(e)},{status:502});
  }
}
