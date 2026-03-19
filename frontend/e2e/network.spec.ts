import { expect, test, type Page } from '@playwright/test';

const NETWORK_FIXTURE = {
  nodes: [
    { id: 'contact_self', type: 'contact', label: '自分', is_self: true, company_node_id: 'company_acme' },
    { id: 'company_acme', type: 'company', label: '株式会社テスト' },
    { id: 'contact_taro', type: 'contact', label: '山田 太郎', company_node_id: 'company_acme' },
  ],
  edges: [
    { source: 'contact_self', target: 'company_acme', type: 'employment' },
    { source: 'contact_taro', target: 'company_acme', type: 'employment' },
  ],
};

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

const readLayoutPositions = async (page: Page) => {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('techcard_network_layout_v1');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { positions?: Record<string, { x: number; y: number }> };
      return parsed.positions || null;
    } catch {
      return null;
    }
  });
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
  });
  await page.route('**/stats/network**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(NETWORK_FIXTURE),
    });
  });
});

test('ノードクリックでContext表示し、Canvasクリックで解除できる', async ({ page }) => {
  await page.goto('/network');

  const canvasArea = page.getByTestId('network-graph-canvas-area');
  await expect(canvasArea).toBeVisible();

  await openQuickSearchAndFocus(page, '株式会社テスト');
  await expect(page.getByTestId('network-context-title')).toHaveText('株式会社テスト');

  await canvasArea.click({ position: { x: 6, y: 6 } });
  await expect(page.getByTestId('network-context-empty')).toBeVisible();

  const box = await canvasArea.boundingBox();
  if (!box) throw new Error('network canvas area is not measurable');
  await canvasArea.click({
    position: {
      x: box.width / 2,
      y: box.height / 2,
    },
  });
  await expect(page.getByTestId('network-context-title')).toHaveText('株式会社テスト');
});

test('ドラッグ中の状態遷移が安定し、接続ノードが追従する', async ({ page }) => {
  await page.goto('/network');

  const canvasArea = page.getByTestId('network-graph-canvas-area');
  await expect(canvasArea).toBeVisible();

  await openQuickSearchAndFocus(page, '株式会社テスト');
  await expect(page.getByTestId('network-context-title')).toHaveText('株式会社テスト');

  await expect
    .poll(async () => {
      const positions = await readLayoutPositions(page);
      if (!positions) return false;
      return Boolean(positions.company_acme && positions.contact_taro);
    })
    .toBeTruthy();

  const before = await readLayoutPositions(page);
  if (!before?.company_acme || !before?.contact_taro) {
    throw new Error('initial layout positions are missing');
  }

  const box = await canvasArea.boundingBox();
  if (!box) throw new Error('network canvas area is not measurable');
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  await page.mouse.move(centerX, centerY);
  await expect(canvasArea).toHaveAttribute('data-hovered-node-id', /.+/);

  await page.mouse.down();
  await page.mouse.move(centerX + 140, centerY + 40, { steps: 14 });
  await expect(canvasArea).toHaveAttribute('data-dragging-node-id', 'company_acme');
  await expect(canvasArea).toHaveAttribute('data-hovered-node-id', '');
  await page.mouse.up();

  await expect(canvasArea).toHaveAttribute('data-dragging-node-id', '');

  await expect
    .poll(async () => {
      const positions = await readLayoutPositions(page);
      if (!positions?.company_acme || !positions?.contact_taro) return null;
      return positions;
    })
    .not.toBeNull();

  const positions = (await readLayoutPositions(page))!;
  const companyMoved = Math.abs((positions.company_acme?.x ?? 0) - before.company_acme.x);
  const contactMoved = Math.abs((positions.contact_taro?.x ?? 0) - before.contact_taro.x);
  expect(companyMoved).toBeGreaterThan(20);
  expect(contactMoved).toBeGreaterThan(10);
});
