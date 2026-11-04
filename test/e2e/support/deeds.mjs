// For specs where district deeds are not under test: when a deed card opens (a district newly unlocked), close it with
// its real Close button before the next action, as a family would. area-cards.spec.mjs tests the deeds explicitly.
export async function closeDeedsWhenTheyAppear(page) {
  await page.addLocatorHandler(page.locator('#deed-dialog[open]'), async () => {
    await page.locator('#deed-close').click();
  });
}
