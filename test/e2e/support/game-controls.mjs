export async function openMenu(page, id) {
  const menu = page.locator(`#${id}`);
  if (!await menu.evaluate((el) => el.open)) await menu.locator(':scope > summary').click();
}

export async function closeMenu(page, id) {
  const menu = page.locator(`#${id}`);
  if (await menu.evaluate((el) => el.open)) await menu.locator(':scope > summary').click();
}

export async function chooseDistrict(page, id) {
  await openMenu(page, 'district-menu');
  await page.locator(`#realm-districts [data-district="${id}"]`).click();
}

export async function clickView(page, name) {
  await openMenu(page, 'camera-menu');
  await page.getByRole('button', { name, exact: true }).click();
  await closeMenu(page, 'camera-menu');
}
