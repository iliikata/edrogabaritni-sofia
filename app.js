
let map, geocoder, zonesGeoJson, zonesMeta = {}, marker, selectedPolygons = [], infoWindow, containerData = [], containerMarkers = [], lastAddressLatLng = null, hazardMarkers = [];
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
    renderResult(best.formatted_address,feature);
    drawZone(feature,loc);
    lastAddressLatLng=loc;
    renderContainerMarkers(loc);
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


function selectedContainerTypes(){
  return [...document.querySelectorAll(".containerFilter:checked")].map(x=>x.value);
}
function clearContainerMarkers(){
  containerMarkers.forEach(m=>m.setMap(null));
  containerMarkers=[];
}
function distanceMeters(a,b){
  const R=6371000, toRad=x=>x*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
  const x=Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function markerSymbol(type){
  const fill = type==="Стъкло" ? "#2f7d45" : type==="Хартия и картон" ? "#2b65b1" : "#e0b000";
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 7,
    fillColor: fill,
    fillOpacity: .95,
    strokeColor: "#ffffff",
    strokeWeight: 2
  };
}
function renderContainerMarkers(center){
  if(!map || !center) return;
  clearContainerMarkers();
  const types=selectedContainerTypes();
  const c={lat:center.lat(),lng:center.lng()};

  const nearby=containerData
    .filter(p=>types.includes(p.type) || p.type==="Разделно събиране")
    .map(p=>({...p,dist:distanceMeters(c,p)}))
    .filter(p=>p.dist<=2500)
    .sort((a,b)=>a.dist-b.dist)
    .slice(0,80);

  for(const p of nearby){
    const m=new google.maps.Marker({
      map,
      position:{lat:p.lat,lng:p.lng},
      icon:markerSymbol(p.type),
      title:p.type
    });
    m.addListener("click",()=>{
      const dist=p.dist<1000?`${Math.round(p.dist)} м`:`${(p.dist/1000).toFixed(1)} км`;
      const safeAddress=String(p.address||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
      infoWindow.setContent(
        `<strong>${p.type}</strong>`+
        `${p.address?`<br>${safeAddress}`:""}`+
        `<br><span style="color:#777">${dist} от търсения адрес</span>`
      );
      infoWindow.open({map,anchor:m});
    });
    containerMarkers.push(m);
  }

  const meta=document.getElementById("containersMeta");
  if(meta) meta.textContent=`Показани ${nearby.length} контейнера в радиус до 2,5 км.`;
}
async function loadContainers(){
  const meta=document.getElementById("containersMeta");
  if(meta) meta.textContent="Зареждам локациите на контейнерите…";
  const r=await fetch("/api/containers?refresh=1",{cache:"no-store"});
  const data=await r.json();
  if(!r.ok || data.error) throw new Error(data.error||"Не успях да заредя контейнерите.");
  containerData=(data.containers||[]).map(p=>{
    let t=String(p.type||"").toLowerCase();
    let type="Разделно събиране";
    if(/стък|glass|зелен/.test(t)) type="Стъкло";
    else if(/харт|картон|paper|cardboard|син/.test(t)) type="Хартия и картон";
    else if(/пласт|метал|plastic|metal|жълт/.test(t)) type="Пластмаса и метал";
    return {...p,type};
  });
  if(meta){
    if(containerData.length){
      meta.textContent=`Заредени ${containerData.length} официални локации на контейнери.`;
    }else{
      meta.textContent="В момента общинският източник не върна разпознаваеми координати за контейнерите.";
    }
  }
}


const hazardousSchedule2026 = [
  {date:"2026-09-24",time:"08:30–16:00",district:"Младост",address:'ж.к. Младост 4, ул. „Самара“, бл. 440, срещу парк „Сухото дере“, София'},
  {date:"2026-09-25",time:"09:00–12:00",district:"Кремиковци",address:'кв. Челопечене, ул. „Ангел Маджаров“, площадът срещу Кметството, София'},
  {date:"2026-09-25",time:"13:00–16:00",district:"Кремиковци",address:'кв. Враждебна, ул. „8-ма“ № 26, паркингът при ул. „57-ма“, София'},
  {date:"2026-09-26",time:"10:00–15:00",district:"Слатина",address:'бул. „Шипченски проход“ № 67, София'},
  {date:"2026-10-02",time:"09:00–16:00",district:"Овча купел",address:'бул. „Цар Борис III“ № 136 В, София'},
  {date:"2026-10-15",time:"09:00–16:00",district:"Лозенец",address:'ул. „Йосиф Петров“, срещу Семинарията, София'},
  {date:"2026-10-28",time:"09:00–16:00",district:"Панчарево",address:'с. Панчарево, ул. „Самоковско шосе“ № 230, София'},
  {date:"2026-11-04",time:"09:30–15:30",district:"Искър",address:'бул. „Кръстю Пастухов“ № 18, София'},
  {date:"2026-11-17",time:"09:30–15:30",district:"Нови Искър",address:'ул. „Искърско дефиле“ № 121, Нови Искър'},
  {date:"2026-12-02",time:"10:00–15:00",district:"Връбница",address:'бул. „Хан Кубрат“, зад бл. 328, София'}
];

function futureHazardEvents(){
  const today=new Date(); today.setHours(0,0,0,0);
  return hazardousSchedule2026.filter(e=>{
    const d=new Date(e.date+"T12:00:00");
    return d>=today;
  });
}
function hazardDateLabel(iso){
  const d=new Date(iso+"T12:00:00");
  return new Intl.DateTimeFormat("bg-BG",{day:"numeric",month:"short"}).format(d);
}
function renderHazardUpcoming(){
  const el=document.getElementById("hazardUpcoming");
  if(!el) return;
  const events=futureHazardEvents();
  el.innerHTML=events.slice(0,5).map(e=>
    `<span class="hazardEvent">${hazardDateLabel(e.date)} · ${escapeHtml(e.district)} · ${escapeHtml(e.time)}</span>`
  ).join("");
}
function hazardIcon(){
  return {
    path: "M 0,-9 9,0 0,9 -9,0 z",
    scale: 1,
    fillColor:"#6f3c92",
    fillOpacity:.95,
    strokeColor:"#ffffff",
    strokeWeight:2
  };
}
function clearHazardMarkers(){
  hazardMarkers.forEach(m=>m.setMap(null));
  hazardMarkers=[];
}
async function geocodeOne(address){
  const r=await geocoder.geocode({address,region:"bg"});
  return r.results?.[0]?.geometry?.location || null;
}
async function renderHazardMarkers(){
  clearHazardMarkers();
  const toggle=document.getElementById("hazardToggle");
  if(toggle && !toggle.checked) return;

  const events=futureHazardEvents();
  for(const e of events){
    try{
      const loc=await geocodeOne(e.address);
      if(!loc) continue;
      const m=new google.maps.Marker({
        map,
        position:loc,
        icon:hazardIcon(),
        title:`Опасни отпадъци · ${e.district}`
      });
      m.addListener("click",()=>{
        const d=new Date(e.date+"T12:00:00");
        const fullDate=new Intl.DateTimeFormat("bg-BG",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(d);
        infoWindow.setContent(
          `<strong>Мобилен пункт за опасни отпадъци</strong>`+
          `<br>${escapeHtml(e.district)} · ${escapeHtml(fullDate)}`+
          `<br>${escapeHtml(e.time)}`+
          `<br>${escapeHtml(e.address)}`+
          `<br><span style="color:#666">Безплатно за домакинства</span>`
        );
        infoWindow.open({map,anchor:m});
      });
      hazardMarkers.push(m);
    }catch(err){
      console.warn("Неуспешно геокодиране на мобилен пункт",e.address,err);
    }
  }
}


async function useCurrentLocation(){
  const btn=document.getElementById("nearMe");
  if(!navigator.geolocation){
    setStatus("Браузърът не поддържа текуща локация.",true);
    return;
  }
  btn.disabled=true;
  setStatus("Определям местоположението ви…");
  navigator.geolocation.getCurrentPosition(async pos=>{
    try{
      const loc=new google.maps.LatLng(pos.coords.latitude,pos.coords.longitude);
      const feature=zoneAt(loc.lng(),loc.lat());
      if(!feature) throw new Error("Текущата локация не попада в публикувана зона за едрогабаритни отпадъци.");
      let label="Текуща локация";
      try{
        const rev=await geocoder.geocode({location:loc});
        if(rev.results?.[0]?.formatted_address) label=rev.results[0].formatted_address;
      }catch(_){}
      renderResult(label,feature);
      drawZone(feature,loc);
      lastAddressLatLng=loc;
      renderContainerMarkers(loc);
      setStatus("Готово.");
    }catch(e){
      setStatus(e.message||String(e),true);
    }finally{
      btn.disabled=false;
    }
  },err=>{
    const msg=err.code===1 ? "Разрешете достъп до местоположението, за да използвате „До мен“." : "Не успях да определя текущата локация.";
    setStatus(msg,true);
    btn.disabled=false;
  },{enableHighAccuracy:true,timeout:10000,maximumAge:120000});
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
  try{ await loadContainers(); }catch(e){ console.warn(e); }
  renderHazardUpcoming();
  renderHazardMarkers().catch(e=>console.warn(e));
  setStatus(`Готово — заредени са ${zonesGeoJson.features.length} общински карета.`);
  $("check").onclick=checkAddress;
  $("address").addEventListener("keydown",e=>{ if(e.key==="Enter") checkAddress(); });
  document.getElementById("nearMe").addEventListener("click",useCurrentLocation);
  document.querySelectorAll(".containerFilter").forEach(el=>{
    el.addEventListener("change",()=>{ if(lastAddressLatLng) renderContainerMarkers(lastAddressLatLng); });
  });
  const hazardToggle=document.getElementById("hazardToggle");
  if(hazardToggle) hazardToggle.addEventListener("change",()=>renderHazardMarkers());
}

init().catch(e=>setStatus(e.message||String(e),true));
