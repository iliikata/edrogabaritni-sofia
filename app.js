
let map, geocoder, zonesGeoJson, zonesMeta = {}, marker, selectedPolygons = [], infoWindow;
const $ = id => document.getElementById(id);
const bgDays = ["неделя","понеделник","вторник","сряда","четвъртък","петък","събота"];
const dayPatterns = [
  [1,/понеделник|monday|mon\b/iu],[2,/вторник|tuesday|tue\b/iu],
  [3,/сряда|wednesday|wed\b/iu],[4,/четвъртък|thursday|thu\b/iu],
  [5,/петък|friday|fri\b/iu],[6,/събота|saturday|sat\b/iu],
  [0,/неделя|sunday|sun\b/iu]
];

function setStatus(t, err=false){
  $("status").innerHTML = err ? `<span class="error">${escapeHtml(t)}</span>` : escapeHtml(t);
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}
function addDays(d,n){ const x=new Date(d); x.setHours(12,0,0,0); x.setDate(x.getDate()+n); return x; }
function fmt(d){ return new Intl.DateTimeFormat("bg-BG",{weekday:"long",day:"numeric",month:"long"}).format(d); }
function short(d){ return new Intl.DateTimeFormat("bg-BG",{day:"numeric",month:"short"}).format(d); }

function propsText(p){ return Object.entries(p||{}).map(([k,v])=>`${k}: ${v}`).join(" | "); }
function extractDays(p){
  const t=propsText(p), out=[];
  for(const [n,re] of dayPatterns) if(re.test(t)) out.push(n);
  return [...new Set(out)];
}
function pick(p,res){
  for(const [k,v] of Object.entries(p||{}))
    if(res.some(r=>r.test(k)) && v!=null && String(v).trim()) return String(v);
  return "";
}
function districtOf(p){ return pick(p,[/район/iu,/district/iu,/raion/iu,/region/iu]); }

function pointInRing(point, ring){
  const [x,y]=point; let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i], [xj,yj]=ring[j];
    const hit=((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||Number.EPSILON)+xi);
    if(hit) inside=!inside;
  }
  return inside;
}
function pointInPolygon(point, coords){
  if(!coords?.length || !pointInRing(point,coords[0])) return false;
  for(let i=1;i<coords.length;i++) if(pointInRing(point,coords[i])) return false;
  return true;
}
function pointInGeometry(point, g){
  if(g?.type==="Polygon") return pointInPolygon(point,g.coordinates);
  if(g?.type==="MultiPolygon") return g.coordinates.some(p=>pointInPolygon(point,p));
  return false;
}
function zoneAt(lng,lat){
  const p=[lng,lat];
  return zonesGeoJson.features.find(f=>pointInGeometry(p,f.geometry));
}

function upcoming(days,count=4){
  const now=new Date(), today=new Date(); today.setHours(12,0,0,0);
  const out=[];
  for(let i=0;i<60 && out.length<count;i++){
    const d=addDays(today,i);
    if(days.includes(d.getDay())){
      if(i===0 && now.getHours()>=9) continue;
      out.push(d);
    }
  }
  return out;
}

function clearSelection(){
  selectedPolygons.forEach(p=>p.setMap(null));
  selectedPolygons=[];
  if(marker){ marker.setMap(null); marker=null; }
}

function drawZone(feature, latLng){
  clearSelection();
  const bounds=new google.maps.LatLngBounds();

  const makePoly = rings => {
    const paths=rings.map(ring=>ring.map(([lng,lat])=>{
      const ll={lat,lng}; bounds.extend(ll); return ll;
    }));
    const poly=new google.maps.Polygon({
      paths,
      strokeColor:"#111111", strokeOpacity:1, strokeWeight:3,
      fillColor:"#111111", fillOpacity:.18,
      clickable:true, map
    });
    poly.addListener("click", (ev) => {
      const p = feature.properties || {};
      const days = extractDays(p);
      const district = districtOf(p);
      const label = [
        district ? `Район ${district}` : "София",
        days.length ? `График: ${days.map(d=>bgDays[d]).join(", ")}` : ""
      ].filter(Boolean).join("<br>");
      infoWindow.setContent(`<strong>каре за едрогабаритни отпадъци</strong><br>${label}`);
      infoWindow.setPosition(ev.latLng);
      infoWindow.open({map});
    });
    selectedPolygons.push(poly);
  };

  if(feature.geometry.type==="Polygon") makePoly(feature.geometry.coordinates);
  else if(feature.geometry.type==="MultiPolygon") feature.geometry.coordinates.forEach(makePoly);

  marker=new google.maps.Marker({position:latLng,map});
  bounds.extend(latLng);
  map.fitBounds(bounds,60);
}

function renderResult(address, feature){
  const p=feature.properties||{};
  const days=extractDays(p);
  if(!days.length) throw new Error("Намерих карето, но не разчитам графика му.");
  const dates=upcoming(days,4), collect=dates[0], put=addDays(collect,-1);
  $("resolvedAddress").textContent=address;
  const district=districtOf(p);
  $("district").textContent=district ? `Район ${district}` : "София";
  $("putDate").textContent=fmt(put);
  $("collectDate").textContent=fmt(collect);
  $("collectDow").textContent=`събиране в ${bgDays[collect.getDay()]}`;
  $("nextDates").innerHTML=dates.map(d=>`<span class="nextItem">${short(addDays(d,-1))} → ${short(d)}</span>`).join("");
  $("result").classList.remove("hidden");
}

async function checkAddress(){
  const raw=$("address").value.trim();
  if(!raw){ setStatus("Въведи адрес."); return; }
  $("check").disabled=true;
  $("result").classList.add("hidden");
  setStatus("Търся адреса…");

  try{
    const q=/софия|sofia/iu.test(raw) ? raw : `${raw}, София, България`;
    const result=await geocoder.geocode({address:q, region:"bg"});
    if(!result.results?.length) throw new Error("Не намерих този адрес.");
    const best=result.results[0];
    const loc=best.geometry.location;
    const feature=zoneAt(loc.lng(),loc.lat());
    if(!feature) throw new Error("Адресът е намерен, но не попада в публикувана зона за едрогабаритни отпадъци.");
    drawZone(feature,loc);
    renderResult(best.formatted_address,feature);
    setStatus("Готово.");
  }catch(e){
    console.error(e);
    setStatus(e.message || "Грешка при търсене.", true);
    clearSelection();
  }finally{
    $("check").disabled=false;
  }
}

function formatSourceDate(meta){
  const raw = meta.dataset_current_as_of || meta.resource_last_modified || meta.dataset_metadata_modified || meta.checked_at;
  if(!raw) return "";
  // Preserve explicit Bulgarian date strings like 13.07.2026г.
  if(/^\d{1,2}\.\d{1,2}\.\d{4}/.test(String(raw))) return String(raw).replace(/г\.?$/,"");
  const d=new Date(raw);
  if(Number.isNaN(d.getTime())) return String(raw);
  return new Intl.DateTimeFormat("bg-BG",{day:"2-digit",month:"2-digit",year:"numeric"}).format(d);
}
function renderSourceMeta(){
  const el=document.getElementById("sourceMeta");
  if(!el) return;
  const sourceDate=formatSourceDate(zonesMeta);
  const checked=zonesMeta.checked_at ? new Date(zonesMeta.checked_at) : null;
  const checkedTxt=checked && !Number.isNaN(checked.getTime())
    ? new Intl.DateTimeFormat("bg-BG",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(checked)
    : "";
  const stale=zonesMeta.stale ? " · ⚠ използва се последното успешно копие" : "";
  el.textContent=`Данни на Столична община${sourceDate?` · актуални към ${sourceDate}`:""}${checkedTxt?` · проверени ${checkedTxt}`:""}${stale}`;
}
async function loadZones(force=false){
  let r;
  try {
    r=await fetch(force?"/api/zones?refresh=1":"/api/zones",{cache:"no-store"});
  } catch(e) {
    throw new Error("Не мога да се свържа с локалния сървър. Пусни сайта чрез start.command и отвори http://127.0.0.1:8797");
  }
  const data=await r.json();
  if(!r.ok || data.error) throw new Error(data.error || "Не успях да заредя зоните.");
  zonesGeoJson=data.geojson;
  zonesMeta=data.meta||{};
  renderSourceMeta();
}

async function init(){
  const key=window.EGO_CONFIG?.GOOGLE_MAPS_API_KEY;
  if(!key || key.includes("PASTE_YOUR")){
    setStatus("Липсва Google Maps API key. Отвори config.js и постави ключа.",true);
    return;
  }

  await new Promise((resolve,reject)=>{
    const s=document.createElement("script");
    s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    s.async=true; s.defer=true;
    s.onload=resolve; s.onerror=()=>reject(new Error("Google Maps не се зареди."));
    document.head.appendChild(s);
  });

  map=new google.maps.Map($("map"),{
    center:{lat:42.6977,lng:23.3219},
    zoom:12,
    mapTypeControl:false,
    streetViewControl:false,
    fullscreenControl:true
  });
  geocoder=new google.maps.Geocoder();
  infoWindow=new google.maps.InfoWindow();
  await loadZones();
  setStatus(`Готово — заредени са ${zonesGeoJson.features.length} общински карета.`);
  $("check").onclick=checkAddress;
  $("address").addEventListener("keydown",e=>{ if(e.key==="Enter") checkAddress(); });
}

init().catch(e=>setStatus(e.message||String(e),true));
