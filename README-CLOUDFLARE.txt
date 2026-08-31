Публикуване в Cloudflare Pages

Това е production пакет без Python и без start.command.

Опция A — Direct Upload:
Cloudflare Dashboard → Workers & Pages → Create → Pages → Upload assets.
ВАЖНО: за Pages Functions (/functions/api/zones.js) най-надеждно е deployment през Git integration или Wrangler.

Опция B — Git (препоръчително):
1. Качи съдържанието на тази папка в GitHub repository.
2. Cloudflare → Workers & Pages → Create → Pages → Connect to Git.
3. Framework preset: None
4. Build command: остави празно
5. Build output directory: /
6. Deploy.

Google Maps:
config.js съдържа development browser key. Преди публично пускане го смени и ограничи по HTTP referrer до твоя *.pages.dev адрес и бъдещия домейн.

API:
GET /api/zones
- Cloudflare Function открива текущия GeoJSON през CKAN metadata.
- Cloudflare edge cache: 24 часа.
- ?refresh=1 форсира проверка.


НОВО — контейнери за разделно събиране:
GET /api/containers
- автоматично открива CSV ресурсите на официалния dataset separate-collection;
- извлича координати и тип отпадък;
- кешира на Cloudflare edge за 24 часа;
- картата показва контейнерите до 2.5 км около търсения адрес;
- филтри: пластмаса и метал, стъкло, хартия и картон.


НОВО във v3:
- Ясна секция за БЕЗПЛАТНО вземане на стари електроуреди от дома:
  Елтехресурс: 0800 14 100 / 0885 77 00 41 / order@makmetal.eu
  Красна поляна и Овча купел: Екобултех 02 4666 995 / 0888 602 916.
- Секция за опасни отпадъци и безплатно вземане от адрес при минимум 1 кг:
  0885 401 300.
- На Google Maps се показват предстоящите мобилни пунктове за опасни отпадъци
  по официалния график на Столична община за остатъка от 2026 г.
- Лилав ромб = мобилен пункт за опасни отпадъци.


FINAL SOFIA RELEASE:
- „До мен“
- Контейнери за разделно събиране
- Безплатно вземане на електроуреди
- Опасни отпадъци и мобилни пунктове
- Гуми
- Строителни отпадъци


CONTAINER MAP UPDATE:
- Показват се само контейнери вътре в избраното каре.
- Всеки физически контейнер е отделен marker.
- Контейнери с еднакви координати се разместват визуално с ~7 m, за да могат да се натискат поотделно.


SCHEMA-AWARE CONTAINER EXPANSION:
- ECOPACK: sin / zhalt / zelen are interpreted as per-location container counts.
- ECOBULPACK: each colored/model column is interpreted as an individual count.
- BULECOPACK: dvukonteyneren_model_zhalt_zelen expands each set into one yellow + one green container.
- Returned API records now represent physical containers, not just collection locations.
