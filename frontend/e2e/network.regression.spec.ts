import { expect, test, type Page } from '@playwright/test';

const NETWORK_FIXTURE = {
  nodes: [
    { id: 'contact_self', type: 'contact', label: '自分', is_self: true, company_node_id: 'company_acme' },
    { id: 'company_acme', type: 'company', label: '株式会社テスト' },
    { id: 'contact_taro', type: 'contact', label: '山田 太郎', company_node_id: 'company_acme' },
    { id: 'contact_hanako', type: 'contact', label: '佐藤 花子', company_node_id: 'company_acme' },
  ],
  edges: [
    { source: 'contact_self', target: 'company_acme', type: 'employment' },
    { source: 'contact_taro', target: 'company_acme', type: 'employment' },
    { source: 'contact_hanako', target: 'company_acme', type: 'employment' },
  ],
};

const EMPTY_NETWORK_FIXTURE = {
  nodes: [],
  edges: [],
};

const CONTACTS_FIXTURE = [
  {
    id: 1,
    name: '山田 太郎',
    email: 'yamada@example.com',
    phone: '090-0000-0000',
    role: '営業',
    company: {
      id: 10,
      name: 'テスト株式会社',
      group_id: 1,
      tech_tags: [],
    },
    tags: [],
    first_met_at: '2026-03-19',
    notes: '',
  },
];

const GROUPS_FIXTURE = [
  {
    id: 1,
    name: 'テストグループ',
    tags: [],
  },
];

const TAGS_FIXTURE = [{ id: 101, name: '自動化', type: 'tech' }];

const openQuickSearchAndFocus = async (page: Page, label: string) => {
  await page.keyboard.press('ControlOrMeta+K');
  await expect(page.getByTestId('network-quick-search-dialog')).toBeVisible();
  const input = page.getByTestId('network-quick-search-input');
  await input.fill(label);
  await page
    .getByTestId('network-quick-search-result')
    .filter({ hasText: label })
    .first()
    .click();
};

const getCanvasCenter = async (page: Page) => {
  const canvasArea = page.getByTestId('network-graph-canvas-area');
  const box = await canvasArea.boundingBox();
  if (!box) throw new Error('network canvas area is not measurable');
  return {
    canvasArea,
    centerX: box.x + box.width / 2,
    centerY: box.y + box.height / 2,
  };
};

test.describe('NetworkGraph regression guard', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test('Drag中はhoverが別ノードへ移らない', async ({ page }) => {
    await page.route('**/stats/network**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(NETWORK_FIXTURE),
      });
    });

    await page.goto('/network');

    const { canvasArea, centerX, centerY } = await getCanvasCenter(page);
    await openQuickSearchAndFocus(page, '株式会社テスト');
    await expect(canvasArea).toHaveAttribute('data-selected-node-id', 'company_acme');

    await page.mouse.move(centerX, centerY);
    await expect(canvasArea).toHaveAttribute('data-hovered-node-id', /.+/);

    await page.mouse.down();
    await page.mouse.move(centerX + 120, centerY + 20, { steps: 8 });
    await expect(canvasArea).toHaveAttribute('data-dragging-node-id', 'company_acme');
    await expect(canvasArea).toHaveAttribute('data-hovered-node-id', '');

    await page.mouse.move(centerX + 220, centerY - 30, { steps: 12 });
    await expect(canvasArea).toHaveAttribute('data-hovered-node-id', '');
    await page.mouse.move(centerX + 40, centerY + 110, { steps: 10 });
    await expect(canvasArea).toHaveAttribute('data-hovered-node-id', '');

    await page.mouse.up();
    await expect(canvasArea).toHaveAttribute('data-dragging-node-id', '');
  });

  test('高速連続クリックでもselectedNodeが崩れない', async ({ page }) => {
    await page.route('**/stats/network**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(NETWORK_FIXTURE),
      });
    });

    await page.goto('/network');

    const { canvasArea, centerX, centerY } = await getCanvasCenter(page);
    await openQuickSearchAndFocus(page, '株式会社テスト');
    await expect(canvasArea).toHaveAttribute('data-selected-node-id', 'company_acme');

    await canvasArea.click({ position: { x: 6, y: 6 } });
    await expect(canvasArea).toHaveAttribute('data-selected-node-id', '');

    await page.mouse.click(centerX, centerY);
    await expect(canvasArea).toHaveAttribute('data-selected-node-id', 'company_acme');

    for (let i = 0; i < 10; i += 1) {
      await page.mouse.click(centerX, centerY);
    }

    await expect(canvasArea).toHaveAttribute('data-selected-node-id', 'company_acme');
    await expect(page.getByTestId('network-context-title')).toHaveText('株式会社テスト');
  });

  test('network APIが500ms遅延してもローディング中に操作できる', async ({ page }) => {
    let requestStarted = false;
    let requestResolved = false;

    await page.route('**/stats/network**', async route => {
      requestStarted = true;
      await new Promise(resolve => setTimeout(resolve, 500));
      requestResolved = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(NETWORK_FIXTURE),
      });
    });

    await page.goto('/network', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => requestStarted).toBeTruthy();
    expect(requestResolved).toBeFalsy();

    const searchInput = page.getByTestId('network-toolbar-search-input');
    await searchInput.fill('遅延中入力');
    await expect(searchInput).toHaveValue('遅延中入力');

    await page.getByTestId('network-settings-toggle').click();
    await expect(page.getByText('表示設定')).toBeVisible();
    await expect(page.getByTestId('network-context-empty')).toBeVisible();

    await expect.poll(() => requestResolved).toBeTruthy();

    await openQuickSearchAndFocus(page, '株式会社テスト');
    await expect(page.getByTestId('network-context-title')).toHaveText('株式会社テスト');
  });

  test('ページ遷移でAbortが発火してもエラー表示されない', async ({ page }) => {
    let networkCallCount = 0;
    let firstNetworkRequestStarted = false;
    const pageErrors: string[] = [];

    page.on('pageerror', error => {
      pageErrors.push(error.message);
    });

    await page.route('**/stats/network**', async route => {
      networkCallCount += 1;
      if (networkCallCount === 1) {
        firstNetworkRequestStarted = true;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(networkCallCount === 1 ? NETWORK_FIXTURE : EMPTY_NETWORK_FIXTURE),
        });
      } catch {
        // Aborted request can no longer be fulfilled.
      }
    });

    await page.route('**/contacts/**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CONTACTS_FIXTURE),
      });
    });

    await page.route('**/company-groups**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(GROUPS_FIXTURE),
      });
    });

    await page.route('**/tags**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TAGS_FIXTURE),
      });
    });

    await page.goto('/network', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => firstNetworkRequestStarted).toBeTruthy();

    await page.goto('/contacts');
    await expect(page.getByRole('heading', { name: '連絡先' })).toBeVisible();
    await expect(page.getByText('タグの取得に失敗しました。')).toHaveCount(0);
    await expect(pageErrors).toEqual([]);
  });
});
