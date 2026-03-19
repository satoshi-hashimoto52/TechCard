import { expect, test } from '@playwright/test';

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

const TAGS_FIXTURE = [
  { id: 101, name: '自動化', type: 'tech' },
  { id: 102, name: '#Expo / 国際画像機器展 2025', type: 'event' },
];

const EMPTY_NETWORK_FIXTURE = {
  nodes: [],
  edges: [],
};

test('会社タグ編集で保存後に一覧へ即時反映される', async ({ page }) => {
  let currentCompanyTags: Array<{ id: number; name: string; type?: string }> = [];

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

  await page.route('**/stats/network**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(EMPTY_NETWORK_FIXTURE),
    });
  });

  await page.route('**/companies/10/tags', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(currentCompanyTags),
      });
      return;
    }
    const payload = route.request().postDataJSON() as {
      tag_items?: Array<{ name: string; type?: string }>;
    };
    currentCompanyTags = (payload.tag_items || []).map((item, index) => ({
      id: index + 1000,
      name: item.name,
      type: item.type || 'tech',
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(currentCompanyTags),
    });
  });

  await page.goto('/contacts');

  await page.getByTestId('contacts-group-toggle-1').click();
  await page.getByTestId('contacts-company-toggle-10').click();
  await page.getByTestId('contacts-company-tag-edit-10').click();

  await expect(page.getByTestId('contacts-tag-editor')).toBeVisible();
  await page.getByTestId('contacts-tag-editor-select-existing').selectOption('自動化');
  await page.getByTestId('contacts-tag-editor-add-existing').click();
  await page.getByTestId('contacts-tag-editor-save').click();

  await expect(page.getByTestId('contacts-company-tags-10')).toContainText('自動化');
});
