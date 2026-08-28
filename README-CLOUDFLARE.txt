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
