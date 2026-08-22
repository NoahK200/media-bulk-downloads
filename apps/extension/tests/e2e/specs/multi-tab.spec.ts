import { test, expect } from '../fixtures/extension';
import { openBubblePage, openPanel } from '../helpers/bubble';

test.describe('multi-tab collection selector', () => {
  test('the bubble collects all tabs, a selected subset, then returns to this tab', async ({ context }) => {
    const mediaPage = await openBubblePage(context, '/media.html');
    const mixedPage = await context.newPage();
    await mixedPage.goto('/mixed.html');
    await mixedPage.getByRole('button', { name: 'Media Bulk Downloads' }).waitFor();

    await mediaPage.bringToFront();
    await openPanel(mediaPage);
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
});
