import { test, expect, serviceWorker } from '../fixtures/extension';
import { openBubblePage, openPanel } from '../helpers/bubble';
import type { Page } from '@playwright/test';

async function expectCollectionToolbarContained(page: Page): Promise<void> {
  const controls = [
    page.getByRole('combobox', { name: 'Collection scope' }),
    page.getByRole('button', { name: 'Deep scan' }),
    page.getByRole('button', { name: 'Find near-duplicates' }),
    page.getByRole('button', { name: 'Rescan page' }),
  ];
  for (const control of controls) {
    await expect(control).toBeVisible();
    await expect(control).toBeEnabled();
    await control.click({ trial: true });
  }

  const layout = await page.locator('.collection-toolbar').evaluate((toolbar) => {
    const container = toolbar.closest('.mbd-app');
    if (!(container instanceof HTMLElement)) throw new Error('App container not found');
    const panel = container.getBoundingClientRect();
    const controlBounds = [...toolbar.querySelectorAll('select, button')].map((control) => {
      const rect = control.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    return {
      clientWidth: toolbar.clientWidth,
      scrollWidth: toolbar.scrollWidth,
      panelLeft: panel.left,
      panelRight: panel.right,
      controlBounds,
    };
  });

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.controlBounds).toHaveLength(4);
  for (const bounds of layout.controlBounds) {
    expect(bounds.left).toBeGreaterThanOrEqual(layout.panelLeft - 1);
    expect(bounds.right).toBeLessThanOrEqual(layout.panelRight + 1);
  }
}

test.describe('multi-tab collection selector', () => {
  test('the bubble collects all tabs, a selected subset, then returns to this tab', async ({ context }) => {
    const mediaPage = await openBubblePage(context, '/media.html');
    const mixedPage = await context.newPage();
    await mixedPage.goto('/mixed.html');
    await mixedPage.getByRole('button', { name: 'Media Bulk Downloads' }).waitFor();

    await mediaPage.bringToFront();
    await openPanel(mediaPage);
    await expectCollectionToolbarContained(mediaPage);
    const scope = mediaPage.getByRole('combobox', { name: 'Collection scope' });
    await expect(scope).toBeVisible();
    await expect(scope.getByRole('option')).toHaveText(['This tab', 'All tabs', 'Selected tabs…']);

    await scope.selectOption('all-tabs');
    // The two fixtures expose nine items in total, with one canonical duplicate
    // shared across tabs; the multi-tab merge must retain eight distinct items.
    await expect(mediaPage.getByRole('button', { name: 'View Details' })).toHaveCount(8);
    await expect(mediaPage.getByText(/2 tabs/)).toBeVisible();

    await scope.selectOption('selected');
    await mediaPage.getByRole('checkbox', { name: 'Scan tab: MBD e2e — mixed' }).click();
    await mediaPage.getByRole('button', { name: 'Scan selected (1)' }).click();
    await expect(mediaPage.getByRole('button', { name: 'View Details' })).toHaveCount(4);
    await expect(scope).toHaveValue('selected');

    await scope.selectOption('active');
    await expect(mediaPage.getByRole('button', { name: 'View Details' })).toHaveCount(5);
  });

  test('the collection toolbar remains contained at the minimum 320 px bubble width', async ({ context }) => {
    const page = await openBubblePage(context, '/media.html', { bubbleWidth: 320 });
    await openPanel(page);
    await expectCollectionToolbarContained(page);
  });

  test('the standalone popup retains its all-tabs selector and collection path', async ({ context, extensionId }) => {
    const mediaPage = await context.newPage();
    await mediaPage.goto('/media.html');
    const mixedPage = await context.newPage();
    await mixedPage.goto('/mixed.html');

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const scope = popup.getByRole('combobox', { name: 'Collection scope' });
    await expect(scope).toBeVisible();
    await scope.selectOption('all-tabs');

    await expect(popup.getByRole('button', { name: 'View Details' })).toHaveCount(8);
    await expect(popup.getByText(/2 tabs/)).toBeVisible();
  });

  test('the collection toolbar remains contained at the minimum 320 px popup width', async ({ context, extensionId }) => {
    const worker = await serviceWorker(context);
    await worker.evaluate(() => new Promise<void>((resolve) => {
      chrome.storage.sync.set({ settings: { bubbleEnabled: false, popupWidth: 320 } }, () => resolve());
    }));
    const mediaPage = await context.newPage();
    await mediaPage.goto('/media.html');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByRole('combobox', { name: 'Collection scope' }).selectOption('all-tabs');
    await expect(popup.getByRole('button', { name: 'View Details' })).toHaveCount(5);
    await expectCollectionToolbarContained(popup);
  });
});
