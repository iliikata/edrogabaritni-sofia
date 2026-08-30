
const DATASET_ID = "separate-collection";
const PACKAGE_URL = `https://urbandata.sofia.bg/api/3/action/package_show?id=${encodeURIComponent(DATASET_ID)}`;

function clean(v){ return String(v ?? "").trim(); }

function parseCSV(text){
  const rows=[]; let row=[], cell="", q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1];
    if(q){
      if(c === '"' && n === '"'){ cell+='"'; i++; }
      else if(c === '"'){ q=false; }
      else cell+=c;
    }else{
      if(c === '"') q=true;
      else if(c === ","){ row.push(cell); cell=""; }
      else if(c === "\n"){ row.push(cell); rows.push(row); row=[]; cell=""; }
      else if(c !== "\r") cell+=c;
    }
  }
  if(cell.length || row.length){ row.push(cell); rows.push(row); }
  return rows;
}

function keyMatch(keys, patterns){
  for(const k of keys){
    const low=k.toLowerCase();
    if(patterns.some(p=>p.test(low))) return k;
  }
  return null;
}

function detectCols(headers){
  return {
    lat: keyMatch(headers,[/^lat$/, /latitude/, /ширина/, /географска.*шир/]),
    lng: keyMatch(headers,[/^lon$/, /^lng$/, /longitude/, /дължина/, /географска.*дъл/]),
    address: keyMatch(headers,[/address/, /адрес/, /location/, /местоположение/]),
    type: keyMatch(headers,[/type/, /waste/, /отпад/, /вид/, /fraction/, /материал/]),
    district: keyMatch(headers,[/district/, /район/]),
    operator: keyMatch(headers,[/operator/, /organization/, /организац/, /фирма/]),
  };
}

function num(v){
  const x=Number(String(v ?? "").replace(",",".").trim());
  return Number.isFinite(x) ? x : null;
}

function inferType(rowText, resourceName){
  const s=(rowText+" "+resourceName).toLowerCase();
  if(/стък|glass/.test(s)) return "Стъкло";
  if(/харт|картон|paper|cardboard/.test(s)) return "Хартия и картон";
  if(/пласт|метал|plastic|metal/.test(s)) return "Пластмаса и метал";
  return "Разделно събиране";
}

function csvResourceScore(r){
  const fmt=clean(r.format).toLowerCase(), url=clean(r.url).toLowerCase(), name=clean(r.name).toLowerCase();
  let score=0;
  if(fmt==="csv" || fmt.includes("csv")) score+=100;
  if(url.includes(".csv")) score+=70;
  if(name.includes(".csv")) score+=30;
  if(name.includes("colored") || name.includes("container") || name.includes("контейнер")) score+=10;
  return score;
}

async function fetchText(url){
  const r=await fetch(url,{headers:{"User-Agent":"EdrOgabaritni-Sofia/2.0"}});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

export async function onRequestGet({request}){
  const cache=caches.default;
  const force=new URL(request.url).searchParams.get("refresh")==="1";
  const cacheKey=new Request(new URL("/__cache/separate-containers-v2",request.url),request);
  if(!force){
    const c=await cache.match(cacheKey);
    if(c) return c;
  }

  try{
    const pr=await fetch(PACKAGE_URL,{headers:{"User-Agent":"EdrOgabaritni-Sofia/2.0"}});
    if(!pr.ok) throw new Error(`CKAN HTTP ${pr.status}`);
    const pj=await pr.json();
    if(!pj.success) throw new Error("CKAN success=false");
    const pkg=pj.result;

    const resources=(pkg.resources||[])
      .map(r=>({r,score:csvResourceScore(r)}))
      .filter(x=>x.score>=100)
      .sort((a,b)=>b.score-a.score)
      .map(x=>x.r);

    const points=[];
    const sourceStats=[];

    for(const resource of resources){
      try{
        const text=await fetchText(resource.url);
        const rows=parseCSV(text);
        if(rows.length<2) continue;
        const headers=rows[0].map(clean);
        const cols=detectCols(headers);
        if(!cols.lat || !cols.lng){
          sourceStats.push({name:resource.name||"", rows:rows.length-1, accepted:0, note:"no coordinate columns"});
          continue;
        }

        let accepted=0;
        for(let i=1;i<rows.length;i++){
          const vals=rows[i], obj={};
          headers.forEach((h,idx)=>obj[h]=vals[idx] ?? "");
          const lat=num(obj[cols.lat]), lng=num(obj[cols.lng]);
          if(lat==null || lng==null || lat<42.3 || lat>43.0 || lng<22.8 || lng>24.0) continue;

          const rowText=Object.values(obj).join(" ");
          points.push({
            lat,lng,
            address: cols.address ? clean(obj[cols.address]) : "",
            type: cols.type && clean(obj[cols.type]) ? clean(obj[cols.type]) : inferType(rowText,resource.name||""),
            district: cols.district ? clean(obj[cols.district]) : "",
            operator: cols.operator ? clean(obj[cols.operator]) : "",
            source: resource.name || ""
          });
          accepted++;
        }
        sourceStats.push({name:resource.name||"", rows:rows.length-1, accepted});
      }catch(e){
        sourceStats.push({name:resource.name||"", accepted:0, error:String(e)});
      }
    }

    const seen=new Set(), dedup=[];
    for(const p of points){
      const k=`${p.lat.toFixed(5)}|${p.lng.toFixed(5)}|${p.type.toLowerCase()}`;
      if(seen.has(k)) continue;
      seen.add(k); dedup.push(p);
    }

    const payload={
      containers:dedup,
      meta:{
        dataset_id:DATASET_ID,
        dataset_title:pkg.title||"Контейнери за разделно събиране на територията на София",
        dataset_page:`https://urbandata.sofia.bg/dataset/${DATASET_ID}`,
        dataset_metadata_modified:pkg.metadata_modified||"",
        checked_at:new Date().toISOString(),
        count:dedup.length,
        sources:sourceStats
      }
    };

    const response=Response.json(payload,{
      headers:{
        "Cache-Control":"public, max-age=3600, s-maxage=86400",
        "CDN-Cache-Control":"max-age=86400"
      }
    });
    await cache.put(cacheKey,response.clone());
    return response;
  }catch(e){
    return Response.json({error:String(e)},{status:502});
  }
}
