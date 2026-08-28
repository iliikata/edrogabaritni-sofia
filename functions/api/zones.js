
const DATASET_ID = "bulky-waste-collection-zones";
const PACKAGE_URL = `https://urbandata.sofia.bg/api/3/action/package_show?id=${encodeURIComponent(DATASET_ID)}`;
const FALLBACK_URL = "https://urbandata.sofia.bg/dataset/daa5b924-d6f4-4c4d-a3f7-cf17c0baaecb/resource/b6ae247e-2a58-4ccd-bed0-8681d9e5a4ba/download/sofia-construction-waste-districts.geojson";

function chooseResource(pkg) {
  const rs = pkg.resources || [];
  return rs.map(r => {
    const fmt=(r.format||"").toLowerCase(), url=r.url||"", name=(r.name||"").toLowerCase();
    let score=0;
    if(fmt.includes("geojson")) score+=100;
    if(url.toLowerCase().endsWith(".geojson")) score+=80;
    if(name.includes("geojson")) score+=30;
    if(name.includes("zone")||name.includes("waste")||name.includes("его")) score+=10;
    return {score,r};
  }).sort((a,b)=>b.score-a.score)[0]?.r;
}

function currentDate(pkg){
  for(const e of (pkg.extras||[])){
    const k=String(e.key||"").toLowerCase();
    if(k.includes("актуален")||k.includes("current")) return String(e.value||"");
  }
  return pkg.metadata_modified || pkg.metadata_created || "";
}

export async function onRequestGet({request}) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/__cache/official-zones-v1", request.url), request);
  const force = new URL(request.url).searchParams.get("refresh")==="1";
  const cached = force ? null : await cache.match(cacheKey);
  if(cached) return cached;

  let pkg={}, resource={}, sourceMode="ckan", resourceUrl="";
  try{
    const pr=await fetch(PACKAGE_URL,{headers:{"User-Agent":"EdrOgabaritni-Sofia/1.0"}});
    if(!pr.ok) throw new Error(`CKAN HTTP ${pr.status}`);
    const pj=await pr.json();
    if(!pj.success) throw new Error("CKAN success=false");
    pkg=pj.result;
    resource=chooseResource(pkg)||{};
    resourceUrl=resource.url;
    if(!resourceUrl) throw new Error("Няма GeoJSON resource");
  }catch(e){
    sourceMode="fallback";
    resourceUrl=FALLBACK_URL;
  }

  const zr=await fetch(resourceUrl,{headers:{"User-Agent":"EdrOgabaritni-Sofia/1.0"}});
  if(!zr.ok) return Response.json({error:`Общинският източник върна HTTP ${zr.status}`},{status:502});
  const geojson=await zr.json();

  const payload={
    geojson,
    meta:{
      dataset_id:DATASET_ID,
      dataset_title:pkg.title||"Зони за събиране на едрогабаритни отпадъци по райони на София",
      dataset_page:`https://urbandata.sofia.bg/dataset/${DATASET_ID}`,
      resource_url:resourceUrl,
      resource_id:resource.id||"",
      resource_name:resource.name||"",
      resource_last_modified:resource.last_modified||resource.metadata_modified||"",
      dataset_metadata_modified:pkg.metadata_modified||"",
      dataset_current_as_of:currentDate(pkg),
      checked_at:new Date().toISOString(),
      source_mode:sourceMode,
      feature_count:(geojson.features||[]).length,
      stale:false,
      from_cache:false
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
}
