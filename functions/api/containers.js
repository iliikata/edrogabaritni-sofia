
const DATASET_ID = "separate-collection";
const PACKAGE_URL = `https://urbandata.sofia.bg/api/3/action/package_show?id=${encodeURIComponent(DATASET_ID)}`;

function clean(v){ return String(v ?? "").replace(/^\uFEFF/,"").trim(); }

function detectDelimiter(text){
  const first=(text.split(/\r?\n/).find(x=>x.trim())||"");
  const counts=[
    [",",(first.match(/,/g)||[]).length],
    [";",(first.match(/;/g)||[]).length],
    ["\t",(first.match(/\t/g)||[]).length]
  ].sort((a,b)=>b[1]-a[1]);
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
  return rows.filter(r=>r.some(c=>String(c).trim()!==""));
}

function keyMatch(keys, patterns){
  for(const k of keys){
    const low=clean(k).toLowerCase();
    if(patterns.some(p=>p.test(low))) return k;
  }
  return null;
}

function detectCols(headers){
  return {
    lat: keyMatch(headers,[/^lat$/, /latitude/, /ширина/, /географска.*шир/, /^y$/, /coord.*y/, /коорд.*y/]),
    lng: keyMatch(headers,[/^lon$/, /^lng$/, /longitude/, /дължина/, /географска.*дъл/, /^x$/, /coord.*x/, /коорд.*x/]),
    coords: keyMatch(headers,[/coord/, /коорд/, /gps/, /location.*point/, /географ.*координ/]),
    address: keyMatch(headers,[/address/, /адрес/, /location/, /местоположение/]),
    type: keyMatch(headers,[/type/, /waste/, /отпад/, /вид/, /fraction/, /материал/, /контейнер/, /цвят/, /color/]),
    district: keyMatch(headers,[/district/, /район/]),
    operator: keyMatch(headers,[/operator/, /organization/, /организац/, /фирма/]),
  };
}

function num(v){
  const s=clean(v).replace(/\s/g,"").replace(",",".");
  const x=Number(s);
  return Number.isFinite(x) ? x : null;
}

function parseCoords(v){
  const nums=String(v??"").replace(",",".").match(/-?\d{2,3}\.\d+/g);
  if(!nums || nums.length<2) return null;
  const a=Number(nums[0]), b=Number(nums[1]);
  if(a>=42 && a<=43 && b>=22 && b<=24) return {lat:a,lng:b};
  if(b>=42 && b<=43 && a>=22 && a<=24) return {lat:b,lng:a};
  return null;
}

function normalizeType(value, rowText, resourceName){
  const s=(clean(value)+" "+rowText+" "+resourceName).toLowerCase();
  if(/стък|glass|зелен/.test(s)) return "Стъкло";
  if(/харт|картон|paper|cardboard|син/.test(s)) return "Хартия и картон";
  if(/пласт|метал|plastic|metal|жълт/.test(s)) return "Пластмаса и метал";
  return "Разделно събиране";
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
  const r=await fetch(url,{headers:{"User-Agent":"EdrOgabaritni-Sofia/2.1"}});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

function plausible(lat,lng){
  return lat!=null && lng!=null && lat>=42.3 && lat<=43.0 && lng>=22.8 && lng<=24.0;
}

export async function onRequestGet({request}){
  const cache=caches.default;
  const urlObj=new URL(request.url);
  const force=urlObj.searchParams.get("refresh")==="1";
  const cacheKey=new Request(new URL("/__cache/separate-containers-v3",request.url),request);

  if(!force){
    const c=await cache.match(cacheKey);
    if(c) return c;
  }

  try{
    const pr=await fetch(PACKAGE_URL,{headers:{"User-Agent":"EdrOgabaritni-Sofia/2.1"}});
    if(!pr.ok) throw new Error(`CKAN HTTP ${pr.status}`);
    const pj=await pr.json();
    if(!pj.success) throw new Error("CKAN success=false");
    const pkg=pj.result;

    const resources=(pkg.resources||[])
      .map(r=>({r,score:csvResourceScore(r)}))
      .filter(x=>x.score>=100)
      .sort((a,b)=>b.score-a.score)
      .map(x=>x.r);

    const points=[], sourceStats=[];

    for(const resource of resources){
      try{
        const text=await fetchText(resource.url);
        const rows=parseCSV(text);
        if(rows.length<2) continue;

        const headers=rows[0].map(clean);
        const cols=detectCols(headers);
        let accepted=0;

        for(let i=1;i<rows.length;i++){
          const vals=rows[i], obj={};
          headers.forEach((h,idx)=>obj[h]=vals[idx] ?? "");

          let lat=cols.lat ? num(obj[cols.lat]) : null;
          let lng=cols.lng ? num(obj[cols.lng]) : null;

          if(!plausible(lat,lng) && cols.coords){
            const c=parseCoords(obj[cols.coords]);
            if(c){ lat=c.lat; lng=c.lng; }
          }

          // Last-resort: inspect every cell for coordinate pairs.
          if(!plausible(lat,lng)){
            for(const v of Object.values(obj)){
              const c=parseCoords(v);
              if(c){ lat=c.lat; lng=c.lng; break; }
            }
          }

          if(!plausible(lat,lng)) continue;

          const rowText=Object.values(obj).join(" ");
          const rawType=cols.type ? obj[cols.type] : "";
          points.push({
            lat,lng,
            address: cols.address ? clean(obj[cols.address]) : "",
            type: normalizeType(rawType,rowText,resource.name||""),
            district: cols.district ? clean(obj[cols.district]) : "",
            operator: cols.operator ? clean(obj[cols.operator]) : "",
            source: resource.name || ""
          });
          accepted++;
        }

        sourceStats.push({
          name:resource.name||"",
          rows:Math.max(0,rows.length-1),
          accepted,
          headers
        });
      }catch(e){
        sourceStats.push({name:resource.name||"",accepted:0,error:String(e)});
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
