import { expect, test } from '@playwright/test';

const SUMMARY_FIXTURE = {
  counts: {
    contacts: 2,
    companies: 2,
    prefectures: 2,
    tags: 1,
    meetings: 1,
    connectable_contacts: 1,
    connected_contacts: 1,
    connection_rate: 100,
  },
  lists: {
    contacts: [],
    companies: [{ name: '自社', count: 1 }, { name: '取引先A', count: 1 }],
    prefectures: [{ name: '富山県', count: 1 }, { name: '石川県', count: 1 }],
    tags: [],
    meetings: [],
  },
};

const COMPANY_MAP_FIXTURE = [
  {
    company_id: 1,
    name: '自社',
    count: 1,
    lat: 36.6953,
    lon: 137.2113,
    is_self: true,
    address: '富山県富山市',
    city: '富山市',
  },
  {
    company_id: 2,
    name: '取引先A',
    count: 1,
    lat: 36.5613,
    lon: 136.6562,
    is_self: false,
    address: '石川県金沢市',
    city: '金沢市',
  },
];

const COMPANY_DIAGNOSTICS_FIXTURE = {
  missing_addresses: [],
  invalidated_coords: [],
  short_addresses: [],
};

const COMPANY_ROUTE_FIXTURE = {
  from_company_id: 1,
  from_company_name: '自社',
  to_company_id: 2,
  to_company_name: '取引先A',
  to_company_address: '石川県金沢市',
  policy: 'default',
  effective_mode: 'inter_pref_highway',
  distance_m: 57400,
  distance_km: 57.4,
  duration_s: 3400,
  duration_min: 56.7,
  geometry: {
    type: 'LineString',
    coordinates: [
      [137.2113, 36.6953],
      [136.6562, 36.5613],
    ],
  },
  route_steps: [
    { lon: 137.05, lat: 36.67, kind: 'enter', label: '富山IC' },
    { lon: 136.81, lat: 36.61, kind: 'junction', label: '小矢部JCT' },
    { lon: 136.69, lat: 36.58, kind: 'exit', label: '金沢西IC' },
  ],
  cached: false,
  provider: 'osrm',
  updated_at: null,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/stats/summary**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SUMMARY_FIXTURE),
    });
  });

  await page.route('**/stats/company-map**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(COMPANY_MAP_FIXTURE),
    });
  });

  await page.route('**/stats/company-map/diagnostics**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(COMPANY_DIAGNOSTICS_FIXTURE),
    });
  });

  await page.route('**/stats/company-route**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(COMPANY_ROUTE_FIXTURE),
    });
  });
});

test('会社クリックでルートが表示され、距離とステップが出る', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('会社分布（日本地図）')).toBeVisible();

  const zoomIn = page.locator('.maplibregl-ctrl-zoom-in').first();
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();

  const marker = page.getByTestId('map-company-marker-2');
  await expect(marker).toBeVisible();
  await marker.click();

  await expect(page.getByTestId('map-route-panel')).toBeVisible();
  await expect(page.getByTestId('map-route-distance')).toContainText('距離:');
  await expect(page.getByTestId('map-route-steps')).toContainText('箇所');
});
